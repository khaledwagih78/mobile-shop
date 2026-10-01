import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { db, nowISO, setApplyingRemote } from './db';

// Must stay in sync with supabase/schema.sql. Previously this list omitted the
// v10–v18 tables (accounting, installments, CRM, pricing, assets, payroll,
// projects, work orders, reps), so that data never reached the cloud — fixed.
const SYNC_TABLES = [
  'items', 'customers', 'suppliers', 'invoices',
  'payments', 'stockMoves', 'expenses', 'recurringExpenses',
  'employees', 'empRecords', 'users', 'branches',
  'lines', 'transactions', 'profiles',
  'auditLog', 'deliveries', 'requests', 'productions',
  'accounts', 'journalEntries', 'installmentPlans', 'leads', 'priceLists',
  'coupons', 'assets', 'payslips', 'projects', 'workOrders', 'repVisits', 'cashCloses',
];

// Newer-wins helper: a record's edit time (falls back to creation time).
const editTime = (r) => (r && (r.updatedAt || r.createdAt)) || '';

let _status = { state: 'idle', at: null, error: null };
const _listeners = new Set();

function setState(s) {
  _status = s;
  for (const cb of _listeners) cb(s);
}

export function useSyncStatus() {
  const [s, setS] = useState(_status);
  useEffect(() => {
    _listeners.add(setS);
    return () => _listeners.delete(setS);
  }, []);
  return s;
}

async function pushAll() {
  const errors = [];

  const deleteOps = await db.syncQueue
    .filter((q) => q.synced === 0 && q.op === 'delete')
    .toArray();

  for (const { table, payload } of deleteOps) {
    if (!SYNC_TABLES.includes(table)) continue;
    const { error } = await supabase.from(table).delete().eq('id', payload.id);
    if (error) {
      console.warn(`[sync] delete ${table}#${payload.id}:`, error.message);
      errors.push(`حذف ${table}: ${error.message}`);
    }
  }

  for (const tableName of SYNC_TABLES) {
    const records = await db[tableName].toArray();
    if (!records.length) continue;
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500).map((r) => ({ id: r.id, data: r, _at: editTime(r) || null }));
      const { error } = await supabase.from(tableName).upsert(batch, { onConflict: 'id' });
      if (error) {
        const msg = `upsert ${tableName}: ${error.message}`;
        console.warn('[sync]', msg);
        errors.push(msg);
      }
    }
  }

  const settings = await db.settings.toArray();
  if (settings.length) {
    const { error } = await supabase
      .from('settings')
      .upsert(settings.map((r) => ({ key: r.key, data: r })), { onConflict: 'key' });
    if (error) {
      const msg = `upsert settings: ${error.message}`;
      console.warn('[sync]', msg);
      errors.push(msg);
    }
  }

  await db.syncQueue.where('synced').equals(0).modify({ synced: 1 });

  return errors;
}

async function pullAll(canDelete) {
  const errors = [];

  for (const tableName of SYNC_TABLES) {
    let serverRecords = [];
    let offset = 0;
    let pageErr = false;
    while (true) {
      const { data, error } = await supabase
        .from(tableName)
        .select('data')
        .range(offset, offset + 999);
      if (error) {
        const msg = `pull ${tableName}: ${error.message}`;
        console.warn('[sync]', msg);
        errors.push(msg);
        pageErr = true;
        break;
      }
      if (!data?.length) break;
      serverRecords.push(...data.map((r) => r.data));
      if (data.length < 1000) break;
      offset += 1000;
    }
    if (pageErr) continue; // don't touch local data for a table we couldn't fully read

    // Merge newer-wins: only overwrite a local row when the server copy is at least
    // as new, so a pull never reverts an edit made more recently on THIS device.
    if (serverRecords.length) {
      const local = await db[tableName].toArray();
      const localMap = new Map(local.map((r) => [r.id, r]));
      const toPut = serverRecords.filter((sr) => {
        const lr = localMap.get(sr.id);
        return !lr || editTime(sr) >= editTime(lr);
      });
      if (toPut.length) {
        setApplyingRemote(true);
        try { await db[tableName].bulkPut(toPut); } finally { setApplyingRemote(false); }
      }
    }

    // Propagate deletions (row gone from the server) — but only on a clean cycle:
    // if the push failed or local changes are still pending, a missing row might be
    // one we simply haven't uploaded yet, so we must NOT delete it.
    if (canDelete) {
      const serverIds = new Set(serverRecords.map((r) => r.id));
      const localIds  = await db[tableName].toCollection().primaryKeys();
      const toDelete  = localIds.filter((id) => !serverIds.has(id));
      if (toDelete.length) {
        setApplyingRemote(true);
        try { await db[tableName].bulkDelete(toDelete); } finally { setApplyingRemote(false); }
      }
    }
  }

  const { data: settRows, error: settErr } = await supabase.from('settings').select('data');
  if (settErr) {
    const msg = `pull settings: ${settErr.message}`;
    console.warn('[sync]', msg);
    errors.push(msg);
  } else if (settRows?.length) {
    await db.settings.bulkPut(settRows.map((r) => r.data));
  }

  return errors;
}

let _syncing = false;

// Never let a hung network request leave the UI stuck on "syncing" forever.
// If push+pull don't finish within the timeout, reject so we surface an error
// and release the lock, allowing the next interval/online/write to retry.
const SYNC_TIMEOUT_MS = 20_000;
function withTimeout(promise, ms, message) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

export async function syncAll() {
  if (_syncing) return;
  if (!navigator.onLine) {
    setState({ state: 'offline', at: _status.at, error: null });
    return;
  }

  _syncing = true;
  setState({ state: 'syncing', at: _status.at, error: null });

  try {
    const allErrors = await withTimeout(
      (async () => {
        const pushErrors = await pushAll();
        // only let a pull delete local rows when the push was fully clean
        const pullErrors = await pullAll(pushErrors.length === 0);
        return [...pushErrors, ...pullErrors];
      })(),
      SYNC_TIMEOUT_MS,
      'انتهت مهلة المزامنة — تأكد من الإنترنت وأن مشروع Supabase غير متوقف (Paused)',
    );

    if (allErrors.length) {
      const summary = allErrors.slice(0, 3).join('\n');
      const more = allErrors.length > 3 ? `\n... و${allErrors.length - 3} أخطاء أخرى` : '';
      setState({ state: 'error', at: _status.at, error: summary + more });
    } else {
      setState({ state: 'ok', at: nowISO(), error: null });
    }
  } catch (err) {
    console.warn('[sync]', err.message);
    setState({ state: 'error', at: _status.at, error: err.message });
  } finally {
    _syncing = false;
  }
}

let _debounce = null;
export function triggerSync() {
  clearTimeout(_debounce);
  _debounce = setTimeout(syncAll, 3000);
}

export function startAutoSync() {
  syncAll();
  window.addEventListener('online', syncAll);
  setInterval(syncAll, 30_000);
}

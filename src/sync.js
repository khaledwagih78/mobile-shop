import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { db, nowISO } from './db';

const SYNC_TABLES = [
  'items', 'customers', 'suppliers', 'invoices',
  'payments', 'stockMoves', 'expenses', 'recurringExpenses',
  'employees', 'empRecords', 'users',
  'lines', 'transactions', 'profiles',
  'auditLog', 'deliveries',
];

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
      const batch = records.slice(i, i + 500).map((r) => ({ id: r.id, data: r }));
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

async function pullAll() {
  const errors = [];

  for (const tableName of SYNC_TABLES) {
    let serverRecords = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from(tableName)
        .select('data')
        .range(offset, offset + 999);
      if (error) {
        const msg = `pull ${tableName}: ${error.message}`;
        console.warn('[sync]', msg);
        errors.push(msg);
        break;
      }
      if (!data?.length) break;
      serverRecords.push(...data.map((r) => r.data));
      if (data.length < 1000) break;
      offset += 1000;
    }

    if (serverRecords.length) {
      await db[tableName].bulkPut(serverRecords);
      const serverIds = new Set(serverRecords.map((r) => r.id));
      const localIds  = await db[tableName].toCollection().primaryKeys();
      const toDelete  = localIds.filter((id) => !serverIds.has(id));
      if (toDelete.length) await db[tableName].bulkDelete(toDelete);
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

export async function syncAll() {
  if (_syncing) return;
  if (!navigator.onLine) {
    setState({ state: 'offline', at: _status.at, error: null });
    return;
  }

  _syncing = true;
  setState({ state: 'syncing', at: _status.at, error: null });

  try {
    const pushErrors = await pushAll();
    const pullErrors = await pullAll();
    const allErrors = [...pushErrors, ...pullErrors];

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

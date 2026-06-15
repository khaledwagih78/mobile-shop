import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { db, nowISO } from './db';

// Tables synced to Supabase (syncQueue and settings handled separately)
const SYNC_TABLES = [
  'items', 'customers', 'suppliers', 'invoices',
  'payments', 'stockMoves', 'expenses', 'recurringExpenses',
  'employees', 'empRecords', 'users',
];

// ── Module-level status (pub/sub so any component can subscribe) ─
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

// ── Push: local IndexedDB → Supabase ────────────────────────────
async function pushAll() {
  // 1. Process explicit delete ops from the syncQueue
  const deleteOps = await db.syncQueue
    .filter((q) => q.synced === 0 && q.op === 'delete')
    .toArray();

  for (const { table, payload } of deleteOps) {
    if (!SYNC_TABLES.includes(table)) continue;
    const { error } = await supabase.from(table).delete().eq('id', payload.id);
    if (error) console.warn(`[sync] delete ${table}#${payload.id}:`, error.message);
  }

  // 2. Upsert full current state of every table (idempotent)
  for (const tableName of SYNC_TABLES) {
    const records = await db[tableName].toArray();
    if (!records.length) continue;

    // Batch 500 rows per request to stay under Supabase size limits
    for (let i = 0; i < records.length; i += 500) {
      const batch = records.slice(i, i + 500).map((r) => ({ id: r.id, data: r }));
      const { error } = await supabase.from(tableName).upsert(batch, { onConflict: 'id' });
      if (error) throw new Error(`upsert ${tableName}: ${error.message}`);
    }
  }

  // 3. Settings table (text primary key — separate handling)
  const settings = await db.settings.toArray();
  if (settings.length) {
    const { error } = await supabase
      .from('settings')
      .upsert(settings.map((r) => ({ key: r.key, data: r })), { onConflict: 'key' });
    if (error) throw new Error(`upsert settings: ${error.message}`);
  }

  // 4. Mark all pending queue entries as synced
  await db.syncQueue.where('synced').equals(0).modify({ synced: 1 });
}

// ── Pull: Supabase → local IndexedDB ────────────────────────────
async function pullAll() {
  for (const tableName of SYNC_TABLES) {
    let serverRecords = [];
    let offset = 0;

    // Paginate — Supabase default cap is 1000 rows per request
    while (true) {
      const { data, error } = await supabase
        .from(tableName)
        .select('data')
        .range(offset, offset + 999);
      if (error) throw new Error(`pull ${tableName}: ${error.message}`);
      if (!data?.length) break;
      serverRecords.push(...data.map((r) => r.data));
      if (data.length < 1000) break;
      offset += 1000;
    }

    if (serverRecords.length) {
      await db[tableName].bulkPut(serverRecords);

      // Remove local records that no longer exist on server (propagate remote deletes).
      // Safety: only do this when server returned data — if server is empty it might be
      // a Supabase issue, not a real empty table, so we leave local data untouched.
      const serverIds = new Set(serverRecords.map((r) => r.id));
      const localIds  = await db[tableName].toCollection().primaryKeys();
      const toDelete  = localIds.filter((id) => !serverIds.has(id));
      if (toDelete.length) await db[tableName].bulkDelete(toDelete);
    }
  }

  // Settings pull (key-based)
  const { data: settRows, error: settErr } = await supabase.from('settings').select('data');
  if (settErr) throw new Error(`pull settings: ${settErr.message}`);
  if (settRows?.length) {
    await db.settings.bulkPut(settRows.map((r) => r.data));
  }
}

// ── Main sync ────────────────────────────────────────────────────
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
    await pushAll();
    await pullAll();
    setState({ state: 'ok', at: nowISO(), error: null });
  } catch (err) {
    console.error('[sync]', err);
    setState({ state: 'error', at: _status.at, error: err.message });
  } finally {
    _syncing = false;
  }
}

// Debounced trigger — call after writes for a near-instant sync
let _debounce = null;
export function triggerSync() {
  clearTimeout(_debounce);
  _debounce = setTimeout(syncAll, 3000);
}

// ── Auto-sync bootstrap — call once at app start ─────────────────
export function startAutoSync() {
  syncAll();                                    // sync immediately on startup
  window.addEventListener('online', syncAll);   // sync when network returns
  setInterval(syncAll, 30_000);                 // background sync every 30 s
}

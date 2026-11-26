import { useState, useEffect } from'react';
import { supabase, ensureCloudAuth, cloudAuthConfigured } from'./supabase';
import { db, nowISO, setApplyingRemote } from'./db';

// Must stay in sync with supabase/schema.sql
export const SYNC_TABLES = ['items','customers','suppliers','invoices','payments','stockMoves','expenses','recurringExpenses','employees','empRecords','users','branches','lines','transactions','profiles','auditLog','deliveries','requests','productions','accounts','journalEntries','installmentPlans','leads','priceLists','coupons','assets','payslips','projects','workOrders','repVisits','cashCloses',
];

// Helper to determine the latest edit timestamp of a record
const editTime = (r) => (r && (r.updatedAt || r.createdAt)) ||'';

// Timestamps stored in localStorage to enable incremental delta syncing
const KEY_LAST_PUSH ='kerp_last_push_at';
const KEY_LAST_PULL ='kerp_last_pull_at';
const KEY_LAST_RECONCILE ='kerp_last_reconcile_at';

// 60-second safety window to absorb potential clock skew across devices
const SKEW_WINDOW_MS = 60_000;

let _status = { state:'idle', at: null, error: null };
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

/**
 * Pushes only newly modified / created local records to Supabase (Delta Push),
 * plus processes pending deletion records from syncQueue.
 */
async function pushIncremental(forceFull = false) {
  const errors = [];
  const pushStart = nowISO();

  // 1. Process deletions queued in syncQueue
  const deleteOps = await db.syncQueue
    .filter((q) => q.synced === 0 && q.op ==='delete')
    .toArray();

  for (const { table, payload } of deleteOps) {
    if (!SYNC_TABLES.includes(table)) continue;
    const { error } = await supabase.from(table).delete().eq('id', payload.id);
    if (error) {
      console.warn(`[sync] delete ${table}#${payload.id}:`, error.message);
      errors.push(`حذف ${table}: ${error.message}`);
    }
  }

  // 2. Determine incremental cutoff
  let lastPush = null;
  try { lastPush = localStorage.getItem(KEY_LAST_PUSH); } catch { /* ignore */ }

  const useIncremental = !forceFull && Boolean(lastPush);
  const cutoff = useIncremental
    ? new Date(new Date(lastPush).getTime() - SKEW_WINDOW_MS).toISOString()
    : null;

  // 3. Upsert modified records per table
  for (const tableName of SYNC_TABLES) {
    let recordsToPush = [];
    if (useIncremental && cutoff) {
      // Delta: read only records edited or created after cutoff
      recordsToPush = await db[tableName]
        .filter((r) => editTime(r) >= cutoff)
        .toArray();
    } else {
      // Full push: read all records
      recordsToPush = await db[tableName].toArray();
    }

    if (!recordsToPush.length) continue;

    for (let i = 0; i < recordsToPush.length; i += 500) {
      const batch = recordsToPush.slice(i, i + 500).map((r) => ({
        id: r.id,
        data: r,
        _at: editTime(r) || nowISO(),
      }));
      const { error } = await supabase.from(tableName).upsert(batch, { onConflict:'id' });
      if (error) {
        const msg =`upsert ${tableName}: ${error.message}`;
        console.warn('[sync]', msg);
        errors.push(msg);
      }
    }
  }

  // 4. Sync Settings
  const settings = await db.settings.toArray();
  if (settings.length) {
    const { error } = await supabase
      .from('settings')
      .upsert(settings.map((r) => ({ key: r.key, data: r, _at: nowISO() })), { onConflict:'key' });
    if (error) {
      const msg =`upsert settings: ${error.message}`;
      console.warn('[sync]', msg);
      errors.push(msg);
    }
  }

  // Mark all processed queued ops as synced
  await db.syncQueue.where('synced').equals(0).modify({ synced: 1 });

  // Update last push time only if there were no push errors
  if (errors.length === 0) {
    try { localStorage.setItem(KEY_LAST_PUSH, pushStart); } catch { /* ignore */ }
  }

  return errors;
}

/**
 * Pulls changes from Supabase.
 * - Incremental by default (only rows with _at >= lastPullAt).
 * - Periodically reconciles deletions (every 15 min or on forceFull) using lightweight ID checks.
 */
async function pullIncremental(canDelete, forceFull = false) {
  const errors = [];
  const pullStart = nowISO();

  let lastPull = null;
  let lastReconcile = 0;
  try {
    lastPull = localStorage.getItem(KEY_LAST_PULL);
    lastReconcile = Number(localStorage.getItem(KEY_LAST_RECONCILE)) || 0;
  } catch { /* ignore */ }

  const useIncremental = !forceFull && Boolean(lastPull);
  const cutoff = useIncremental
    ? new Date(new Date(lastPull).getTime() - SKEW_WINDOW_MS).toISOString()
    : null;

  // Periodic reconcile for deletions: run if forceFull or if 15 minutes elapsed
  const shouldReconcile = canDelete && (forceFull || (Date.now() - lastReconcile > 15 * 60 * 1000));

  for (const tableName of SYNC_TABLES) {
    let serverRecords = [];
    let offset = 0;
    let pageErr = false;

    // 1. Fetch updated rows
    while (true) {
      let query = supabase.from(tableName).select('data, _at');
      if (useIncremental && cutoff) {
        query = query.gte('_at', cutoff);
      }
      query = query.range(offset, offset + 999);

      const { data, error } = await query;
      if (error) {
        const msg =`pull ${tableName}: ${error.message}`;
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

    if (pageErr) continue;

    // 2. Apply newer-wins merge for fetched records with smart branch stock merging
    if (serverRecords.length) {
      const local = await db[tableName].toArray();
      const localMap = new Map(local.map((r) => [r.id, r]));
      const toPut = [];
      for (const sr of serverRecords) {
        const lr = localMap.get(sr.id);
        if (!lr) {
          toPut.push(sr);
          continue;
        }
        if (tableName === 'items' && sr.stocks && lr.stocks) {
          // Merge stocks per branch: preserve newest update for each branch
          const mergedStocks = { ...sr.stocks, ...lr.stocks };
          const srBranchTimes = sr.branchUpdatedAt || {};
          const lrBranchTimes = lr.branchUpdatedAt || {};
          const allBranches = new Set([...Object.keys(sr.stocks), ...Object.keys(lr.stocks)]);
          for (const b of allBranches) {
            const srTime = srBranchTimes[b] || editTime(sr);
            const lrTime = lrBranchTimes[b] || editTime(lr);
            mergedStocks[b] = srTime >= lrTime ? sr.stocks[b] : lr.stocks[b];
          }
          const baseRecord = editTime(sr) >= editTime(lr) ? sr : lr;
          toPut.push({
            ...baseRecord,
            stocks: mergedStocks,
            branchUpdatedAt: { ...lrBranchTimes, ...srBranchTimes },
          });
        } else if (editTime(sr) >= editTime(lr)) {
          toPut.push(sr);
        }
      }
      if (toPut.length) {
        setApplyingRemote(true);
        try {
          await db[tableName].bulkPut(toPut);
        } finally {
          setApplyingRemote(false);
        }
      }
    }

    // 3. Reconcile deletions if scheduled (lightweight ID query, never re-downloads full data)
    if (shouldReconcile) {
      const { data: idRows, error: idErr } = await supabase.from(tableName).select('id');
      if (!idErr && idRows) {
        const serverIds = new Set(idRows.map((r) => Number(r.id)));
        const localIds = await db[tableName].toCollection().primaryKeys();
        const toDelete = localIds.filter((id) => !serverIds.has(Number(id)));
        if (toDelete.length) {
          setApplyingRemote(true);
          try {
            await db[tableName].bulkDelete(toDelete);
          } finally {
            setApplyingRemote(false);
          }
        }
      }
    }
  }

  // Settings pull
  const { data: settRows, error: settErr } = await supabase.from('settings').select('data');
  if (settErr) {
    const msg =`pull settings: ${settErr.message}`;
    console.warn('[sync]', msg);
    errors.push(msg);
  } else if (settRows?.length) {
    await db.settings.bulkPut(settRows.map((r) => r.data));
  }

  if (errors.length === 0) {
    try {
      localStorage.setItem(KEY_LAST_PULL, pullStart);
      if (shouldReconcile) localStorage.setItem(KEY_LAST_RECONCILE, String(Date.now()));
    } catch { /* ignore */ }
  }

  return errors;
}

let _syncing = false;
const SYNC_TIMEOUT_MS = 25_000;

function withTimeout(promise, ms, message) {
  let t;
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

/**
 * Main sync entry point.
 * Options:
 * - forceFull: boolean (if true, bypasses delta timestamps and syncs all records)
 */
export async function syncAll(options = {}) {
  const forceFull = Boolean(options && options.forceFull);
  if (_syncing) return;
  if (!navigator.onLine) {
    setState({ state:'offline', at: _status.at, error: null });
    return;
  }

  _syncing = true;
  setState({ state:'syncing', at: _status.at, error: null });

  try {
    // Sign in as the shop owner first (required by the secured schema).
    // No-op when no owner credentials are configured (legacy open schema).
    const authed = await ensureCloudAuth();
    if (!authed && cloudAuthConfigured) {
      setState({
        state:'error',
        at: _status.at,
        error:'تعذّر تسجيل الدخول للسحابة — تأكد من بيانات حساب المالك (VITE_SUPABASE_OWNER_EMAIL / PASSWORD)',
      });
      _syncing = false;
      return;
    }

    const allErrors = await withTimeout(
      (async () => {
        const pushErrors = await pushIncremental(forceFull);
        // Only allow pulling deletions if the push completed cleanly
        const pullErrors = await pullIncremental(pushErrors.length === 0, forceFull);
        return [...pushErrors, ...pullErrors];
      })(),
      SYNC_TIMEOUT_MS,'انتهت مهلة المزامنة — تأكد من الاتصال بالإنترنت وتوافر خادم Supabase',
    );

    if (allErrors.length) {
      const summary = allErrors.slice(0, 3).join('\n');
      const more = allErrors.length > 3 ?`\n... و${allErrors.length - 3} أخطاء أخرى` :'';
      setState({ state:'error', at: _status.at, error: summary + more });
    } else {
      setState({ state:'ok', at: nowISO(), error: null });
    }
  } catch (err) {
    console.warn('[sync]', err.message);
    setState({ state:'error', at: _status.at, error: err.message });
  } finally {
    _syncing = false;
  }
}

let _debounce = null;
export function triggerSync() {
  clearTimeout(_debounce);
  _debounce = setTimeout(() => syncAll(), 2500);
}

/**
 * Registers PWA Background Sync via Service Worker if supported by the browser.
 */
export function registerBackgroundSync() {
  if (typeof navigator !=='undefined' &&'serviceWorker' in navigator &&'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg) => reg.sync.register('kerp-sync'))
      .catch((e) => console.debug('[sync] BackgroundSync not registered:', e.message));
  }
}

/**
 * Starts auto sync:
 * - Runs immediately
 * - Triggers on'online' event
 * - Triggers on tab focus / phone unlock ('visibilitychange')
 * - Heartbeat interval every 60 seconds
 * - Tries registering Service Worker Background Sync
 */
export function startAutoSync() {
  syncAll();

  if (typeof window !=='undefined') {
    window.addEventListener('online', () => syncAll());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState ==='visible') {
        syncAll();
      }
    });
    setInterval(() => syncAll(), 60_000);
  }

  registerBackgroundSync();
}

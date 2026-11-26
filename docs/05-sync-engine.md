# 05 — Sync Engine Rewrite

**File:** `src/sync.js`

## Why It Was Rewritten

The original sync engine did a **full table scan** on every sync cycle — it fetched and pushed all rows from every table every 30 seconds. This meant:

- Unnecessary bandwidth usage
- Slow on large datasets
- High risk of overwriting newer server data with stale local data

## New Architecture: Incremental (Delta) Sync

The rewrite implements a **delta sync** pattern — only records changed since the last sync are transferred.

### Key Concepts

**Timestamps used:**
- `updatedAt` — local Dexie column, updated whenever a record is changed
- `_at` — Supabase column, same purpose on the server side

**Watermarks stored in `localStorage`:**
- `kerp_last_push_at` — timestamp of last successful push
- `kerp_last_pull_at` — timestamp of last successful pull

---

## `pushIncremental()`

Pushes only local records where `updatedAt >= lastPushAt - 60s`.

The **60-second skew window** protects against clock drift between the device and the server:

```js
const since = lastPushAt - 60_000; // 60s safety buffer
const dirty = await db[table].where('updatedAt').aboveOrEqual(since).toArray();
```

After a successful push, `kerp_last_push_at` is updated to `Date.now()`.

---

## `pullIncremental()`

Fetches only Supabase records where `_at >= lastPullAt`:

```js
const { data } = await supabase
  .from(table)
  .select('*')
  .gte('_at', new Date(lastPullAt).toISOString());
```

Pulled records are **upserted** into local Dexie (insert or update by primary key).  
After a successful pull, `kerp_last_pull_at` is updated.

---

## Delete Reconciliation

Deletes are expensive to sync incrementally (a deleted row leaves no trace).  
The engine handles this with a **lightweight ID-only reconciliation** that runs every **15 minutes**:

1. Fetch all IDs from each Supabase table (no full row data)
2. Compare against local IDs
3. Delete any local records whose ID is no longer on the server

```js
const { data: serverIds } = await supabase.from(table).select('id');
const localIds = await db[table].orderBy('id').primaryKeys();
const toDelete = localIds.filter(id => !serverIdSet.has(id));
await db[table].bulkDelete(toDelete);
```

---

## Sync Triggers

| Trigger | Action |
|---|---|
| App startup | `syncAll()` |
| Every 60 seconds | `syncAll()` (interval, was 30s before rewrite) |
| Tab becomes visible | `syncAll()` (via `visibilitychange` event) |
| PWA background sync | `registerBackgroundSync()` registers a Service Worker background sync event |
| Manual (settings page) | `syncAll({ forceFull: true })` — bypasses watermarks, does a full sync |

---

## `syncAll(options)`

Top-level function that runs push then pull for all tables:

```js
await syncAll();              // incremental
await syncAll({ forceFull: true }); // full sync (ignores watermarks)
```

---

## Error Handling

- Each table's sync is wrapped in try/catch — a failure on one table doesn't block others
- Errors are logged to console with table name for easy debugging
- The watermark is **not updated** if a sync fails (so it retries next cycle)

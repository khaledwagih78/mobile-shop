# 03 — Database (Dexie / IndexedDB)

## Overview

All local data is stored in **IndexedDB** via [Dexie.js](https://dexie.org/).  
The database is defined in `src/db.js`.

Dexie uses a **versioned migration system** — every schema change requires a new version number. You cannot modify an existing version without creating a new one.

## Current Version

**Version 19** — this is the latest schema version as of this session.

> The old `CLAUDE.md` file incorrectly stated the DB stopped at version 6 — it is actually at version 19.

## Schema (31 tables + settings)

The database contains 30+ tables covering:

| Category | Tables |
|---|---|
| Core | `users`, `settings` |
| Inventory | `products`, `categories`, `suppliers`, `stock_movements` |
| Sales | `sales`, `sale_items`, `customers` |
| Purchasing | `purchases`, `purchase_items` |
| Finance | `expenses`, `expense_categories`, `payments` |
| Returns | `returns`, `return_items` |
| Misc | `notes`, `warranties`, `repairs`, `repair_items`, ... |

## Seed Data (`ensureSeed`)

The `ensureSeed()` function in `src/db.js` (around line 365) runs on app startup.  
It creates default data if the database is empty:

- Default admin user: name `المدير`, role `admin`, PIN `1234`
- Default settings: business name, currency, etc.

### Bug Fixed — Duplicate Seed Admin

**Problem:** React 18 StrictMode mounts components twice in development. This caused `ensureSeed()` to run twice on the first load, creating 2–3 duplicate admin users in the database.

**Fix applied to `ensureSeed()`:**
```js
// Before inserting, check if a user with this name+role already exists
const existing = await db.users.where('name').equals('المدير').first();
if (!existing) {
  await db.users.add({ name: 'المدير', role: 'admin', pin: '1234', createdAt: now });
}
```

This makes the seed operation **idempotent** — safe to run multiple times.

## Dexie Version History (high-level)

| Version | Change |
|---|---|
| 1–6 | Initial schema (products, sales, customers, suppliers, users, settings) |
| 7–10 | Added purchasing, expenses, expense categories |
| 11–13 | Added stock movements, payment tracking |
| 14–16 | Added returns, warranties |
| 17–18 | Added repairs module (repairs + repair_items) |
| 19 | Current — added notes, minor index fixes |

> Always increment the version number when changing the schema. Never edit a previous version's definition.

## `getSetting(key, defaultValue)`

A helper exported from `db.js` to read a single setting by key:

```js
const bizName = await getSetting('bizName', 'نظام إدارة المبيعات');
```

Settings are stored as `{ key, value }` rows in the `settings` table.

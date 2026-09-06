# CLAUDE.md

Guidance for AI assistants working in this repository.

## Project Overview

**خالد لقطع غيار المحمول (Khaled Mobile Parts ERP)** — an **offline-first PWA**
sales & inventory management system (ERP) for a mobile-phone spare-parts shop.
It runs entirely in the browser with **no backend required**: every operation is
stored locally in IndexedDB and works fully offline. Cloud sync to Supabase is an
optional layer on top.

- **Language & direction:** The entire UI is **Arabic, RTL**. User-facing strings,
  labels, toasts, and messages are written in Arabic. Keep this convention when
  adding UI.
- **Single codebase, three targets:** installable app on mobile, desktop, and web.
- **Package name:** `khaled-erp` (the `mobile-shop` repo name maps to the Vite
  `base: '/mobile-shop/'` for GitHub Pages).

## Tech Stack

- **React 18** + **Vite 5** (ES modules, `"type": "module"`)
- **React Router 6** via `HashRouter` (hash routing is required for static hosting
  under a subpath / PWA)
- **Dexie 4** (IndexedDB wrapper) + **dexie-react-hooks** (`useLiveQuery`) for
  local-first reactive data — this is the primary data store
- **vite-plugin-pwa** (Workbox) — auto-updating service worker, offline caching,
  installable manifest
- **@supabase/supabase-js** — optional cloud sync (phase 2)
- **Web Crypto (AES-GCM + PBKDF2)** — encrypted backups
- **xlsx** (SheetJS) — Excel import/export
- **@fontsource/cairo** — Arabic font
- No TypeScript, no test framework, no linter configured. Files are `.js` / `.jsx`.

## Commands

```bash
npm install       # install dependencies
npm run dev       # start Vite dev server (local development)
npm run build     # production build -> dist/
npm run preview   # preview the production build locally
```

There are **no test or lint scripts**. Verify changes by running `npm run dev` and
`npm run build`.

## Deployment

- **GitHub Pages** via `.github/workflows/deploy.yml`. It builds and deploys on
  push to the **`source`** branch (the repo's default branch), or via manual
  `workflow_dispatch`. Publish directory is `dist`.
- Because of GitHub Pages subpath hosting, `vite.config.js` sets
  `base: '/mobile-shop/'`. Absolute asset paths (e.g. notification/icon paths)
  must account for this prefix.
- The README also documents Netlify deployment (build command `npm run build`,
  publish dir `dist`).

## Architecture

### Data flow (local-first)

1. All business data lives in **Dexie / IndexedDB** (`src/db.js`, database name
   `khaled_erp`). Components read it reactively with `useLiveQuery`.
2. Every write goes through Dexie. Multi-step operations that must stay consistent
   (invoices, cancellations, payments) run inside `db.transaction('rw', ...)`.
3. Each write is **also queued for cloud sync** via `queueSync(table, op, payload)`
   into the `syncQueue` table.
4. `src/sync.js` pushes all local tables to Supabase and pulls them back on an
   interval / when the network returns. Sync is best-effort and the app is fully
   usable with it failing or disabled.

### Key files

| File | Responsibility |
|---|---|
| `src/main.jsx` | Entry point; mounts React, starts auto-sync, requests notification permission |
| `src/App.jsx` | Router + route table; wraps routes in `<Guard action=...>` for role-based access |
| `src/auth.jsx` | `AuthProvider` / `useAuth`; PIN-based login, persists current user id in `localStorage` (`kerp_user`) |
| `src/db.js` | Dexie schema (versioned), core transactional business ops, helpers, seeding, audit log, low-stock notifications |
| `src/utils.js` | Formatting (`money`, `fmt`, dates), WhatsApp link helpers, `ROLES`, and the `can(role, action)` permission map |
| `src/sync.js` | Supabase push/pull, `useSyncStatus`, `startAutoSync`, `triggerSync` |
| `src/supabase.js` | Supabase client (anon/publishable key — safe to expose; secured by RLS) |
| `src/backup.js` | Encrypted (AES-GCM) export/import of all tables to a `.kerp`/`.json` file |
| `src/components/Layout.jsx` | Sidebar + mobile bottom nav; menu filtered by permissions; sync/low-stock indicators |
| `src/components/InvoiceEditor.jsx` | The POS / purchase invoice editor (search, lines, discount, credit, print, WhatsApp) |
| `src/components/UI.jsx` | Shared `Modal` and `Toast` primitives |
| `src/pages/*` | One page per feature (Dashboard, Items, Parties, Reports, Expenses, Employees, Users, Backup, Import, Insights, AuditLog, Deliveries, Login, InvoiceView, Invoices) |
| `src/styles.css` | Global styles (RTL layout, theme) |
| `supabase/schema.sql` | Supabase table setup (run once in the SQL editor) |

### Database schema (Dexie, `src/db.js`)

The schema is **versioned** — `db.version(N).stores({...})`. Versions 1–6 exist.
**Never edit an existing `db.version(n)` block to change indexes; add a new
`db.version(n+1)` block instead**, so existing users' IndexedDB migrates cleanly.

Core tables: `items`, `customers`, `suppliers`, `invoices`, `payments`,
`stockMoves`, `expenses`, `recurringExpenses`, `employees`, `empRecords`, `users`,
`settings` (key/value), `syncQueue`, `auditLog`, `deliveries`. (`lines`,
`transactions`, `profiles` also exist from v5.)

Only **indexed** fields are declared in `stores()`; full objects carry many more
un-indexed fields (e.g. `costPrice`, `salePrice`, `stock`, `balance`, `points`).

**Globally-unique record IDs (multi-device safety).** Tables are declared `++id`,
but relying on auto-increment breaks multi-device sync: every device restarts ids
at 1, so two devices creating records offline generate the same id and clobber
each other on the next upsert. To prevent this, `db.js` registers a Dexie
`creating` hook on every synced table (`ID_TABLES`) that stamps each **new** record
with a globally-unique id from `nextId()` — a per-device random block (12-bit
`kerp_device_block` in `localStorage`) × `2**40` plus a per-device sequence
(`kerp_id_seq`). Records pulled from the cloud already have an id and pass through
untouched. Consequences to keep in mind:
- **Never** hand-assign integer ids on `add()`; let the hook do it (pass an
  explicit id only when re-inserting a record that already has one, e.g. sync).
- Invoice numbers are likewise device-tagged (`S<dev>-00001`) via
  `nextInvoiceNumber` so they stay unique across devices.
- `settings` (keyed by `key`) and `syncQueue` (device-local) are excluded.
- Ids stay within `2**53`, so they remain valid JS numbers and Postgres `bigint`.

### Core business operations (all in `src/db.js`)

- `saveInvoice(inv)` — transactional: assigns a sequential number
  (`S-00001`/`P-00001` via `nextInvoiceNumber`), records the invoice, adjusts item
  `stock`, writes `stockMoves`, updates purchase `costPrice`, updates customer/
  supplier credit `balance` for the remaining amount, awards loyalty `points`
  (1 pt / 100 EGP), writes an audit log entry, and queues sync.
- `cancelInvoice(invoiceId, userName)` — reverses stock and balances, marks the
  invoice `cancelled` (admin-only, enforced in UI via `can(role, 'cancelInvoice')`).
- `recordPayment({...})` — records a customer/supplier payment and adjusts balance.
- Helpers: `nowISO()`, `dayOf(iso)` (→ `YYYY-MM-DD`), `today()`, `getSetting` /
  `setSetting`, `queueSync`, `logAudit`, `ensureSeed` (seeds the first admin user),
  `loadDemoData`.

### Authentication & permissions

- **PIN-based**, not password/email. First run seeds an admin user named `المدير`
  with PIN `1234`. The logged-in user id is stored in `localStorage`.
- Roles: `admin`, `sales`, `store` (see `ROLES` and `can()` in `src/utils.js`).
- Route access is enforced by the `<Guard action="...">` wrapper in `App.jsx`;
  the sidebar (`Layout.jsx`) hides items the role can't access. When adding a
  feature, **add its action to the `can()` map** and guard its route.
- This is **client-side authorization only** (offline shop context). Supabase RLS
  policies are intentionally open (`USING (true)`) — the app's own PIN system is
  the access boundary. Don't treat Supabase as a security perimeter.

### Cloud sync (Supabase — optional, "phase 2")

- Each Supabase table stores rows as `{ id, data: jsonb, _at }` (a generic
  JSON-blob shape so app fields can change without SQL migrations). `settings`
  uses a `key` text PK. See `supabase/schema.sql`.
- Sync is **last-write-wins, whole-table push + pull** (no field-level merge).
  Keep this in mind — it is not conflict-resolving CRDT sync.
- The anon key in `src/supabase.js` is meant to be public.

### AI Insights (`src/pages/Insights.jsx`)

- Computes analytics locally, then optionally calls the **Anthropic Messages API**
  directly from the browser (`https://api.anthropic.com/v1/messages`, model
  `claude-sonnet-4-20250514`) using a user-supplied key stored in settings
  (`aiKey`). This is an opt-in feature; no key ships in the repo.

## Conventions

- **Arabic-first UI, RTL.** All user-visible text is Arabic. Currency is EGP,
  formatted with `money()` (`... ج.م`). Use the existing `utils.js` formatters
  rather than ad-hoc formatting.
- **Money/quantities** default to `0` defensively (`(x || 0)`) since records may
  lack fields.
- **Dates:** store ISO strings via `nowISO()`; derive day buckets with `dayOf`,
  months with `monthOf` (`YYYY-MM`). Report/filtering keys are string prefixes.
- **Reads:** prefer `useLiveQuery(() => db.table..., deps, initial)` for reactive
  data. Provide a sensible `initial` value (usually `[]` or `0`).
- **Writes:** if a write touches more than one record/table and must be atomic,
  wrap it in `db.transaction('rw', [tables], async () => {...})` and call
  `queueSync(...)` inside it. Add a new table to the `SYNC_TABLES` list in
  `sync.js` (and to `supabase/schema.sql`) if it should sync.
- **New page:** create `src/pages/Foo.jsx`, import it in `App.jsx`, add a guarded
  route, add the permission action to `can()` in `utils.js`, and add a `MENU`
  entry in `Layout.jsx` (with an emoji icon and Arabic label).
- **Shared UI:** reuse `Modal` and `Toast` from `src/components/UI.jsx`.
- **Icons** in the nav are emoji, not an icon library.
- Component style: functional components with hooks; no class components. Keep the
  existing plain-JS, minimal-abstraction style — no state-management library,
  Dexie + hooks is the store.

## Git / Workflow

- Default branch is **`source`** (this is what GitHub Pages deploys from).
- Commit with clear, descriptive messages. Verify with `npm run build` before
  finishing. Do **not** open a pull request unless explicitly asked.

## Roadmap (from README)

Built (v1): sales/purchase invoices, inventory with low-stock alerts, customers/
suppliers with balances & statements, automatic profit tracking, reports,
expenses, users & permissions, admin invoice cancellation, encrypted backup/
restore, full offline PWA. Sync-queue infrastructure is in place for the
Supabase cloud-sync phase. Planned: automatic cloud sync, invoice PDF + direct
WhatsApp send, delivery-rep app, loyalty points, camera barcode scanner.

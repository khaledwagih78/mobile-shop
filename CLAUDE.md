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
`settings` (key/value), `syncQueue`, `auditLog`, `deliveries`, `branches` (v7),
`requests` (v8), `productions` (v9). (`lines`, `transactions`, `profiles` also
exist from v5.) Schema is at **v9**.

Only **indexed** fields are declared in `stores()`; full objects carry many more
un-indexed fields (e.g. `costPrice`, `salePrice`, `stock`, `balance`, `points`).

**Globally-unique record IDs (multi-device safety).** Tables are declared `++id`,but relying on auto-increment breaks multi-device sync: every device restarts ids
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

**Multi-branch.** The shop can have several branches (`branches` table; the default
branch has the FIXED id `DEFAULT_BRANCH_ID = 1` so every device agrees on it). Item
master data (code/name/prices) is shared, but **quantity is per-branch**: each item
carries a `stocks` map `{ [branchId]: qty }`. Read it with `stockOf(item, branchId)`
(or `totalStock(item)` across all branches) — never `item.stock` (removed; the v7
migration moves the old value into `stocks`). Invoices, payments, expenses and stock
moves carry a `branchId`. Users have a `branchId` (null = admin, sees all); the
active branch lives in the auth context (`useAuth().activeBranch`/`setActiveBranch`,
persisted in `localStorage.kerp_active_branch`) and admins switch it from the sidebar.
`saveInvoice`/`cancelInvoice` take `inv.branchId`; `transferStock({fromBranch,
toBranch, lines})` moves quantities between branches. When adding a branch-scoped
feature, filter by `(r.branchId || DEFAULT_BRANCH_ID) === activeBranch`.

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

### Business sectors (`src/sectors.js`, `src/pages/Sector.jsx`)

- The shop picks a **sector** (`bizSector` setting, default `general`) from a
  card picker. `sectors.js` is config-only: each sector lists `mods` (module keys
  it reveals) and a `relabel` map (`{ [route]: 'اسم مخصّص' }`).
- `Layout.jsx` gates the menu: an item with a `mod` key shows **only** when the
  chosen sector's `mods` include it (otherwise hidden), and applies the sector's
  `relabel` overrides to generic items. Switching sector never deletes data — it
  only changes visibility and labels. To add a sector-specific feature: give its
  `MENU` entry a `mod`, add that key to the relevant sector(s), and guard its
  route/permission as usual.

### Manufacturing / production (`src/pages/Production.jsx`)

- Revealed by the `factory` and `restaurant` sectors (`mod: 'production'`).
  `recordProduction({branchId, productId, qty, components, laborCost, otherCost,
  saveRecipe, ...})` (in `db.js`) is transactional: it consumes each raw
  `component`'s per-branch stock, adds `qty` to the finished product's stock,
  computes the unit cost (materials + labor + other) and writes it to the
  product's `costPrice`, records `stockMoves` (out for materials, in for product),
  a `productions` row, an audit entry, and queues sync. `saveRecipe` stores the
  components on the product as `item.bom` so the form prefills next time.

### Accounting (double-entry, `src/pages/Accounting.jsx`)

- Two tables (v10): `accounts` (chart of accounts; system accounts carry a `role`)
  and `journalEntries` (balanced vouchers with embedded `lines`). `ensureSeed`
  seeds a default Arabic chart via `ensureChartOfAccounts` (roles: cash, bank, ar,
  inventory, ap, vat, capital, retained, sales, cogs, expense, discount). System
  accounts use **fixed ids 1–12** (like `DEFAULT_BRANCH_ID`) so every device agrees
  and a concurrent double-seed hits a ConstraintError instead of duplicating.
- **Auto-posting:** `saveInvoice`, `saveReturn`, `cancelInvoice` (reversing),
  `restoreInvoice`, `recordPayment` and `recordExpense` each post a balanced entry
  **inside their own transaction** via the internal `writeJournalEntry` (which is
  defensive — returns null and skips, never throws, if accounts are unseeded or the
  entry doesn't balance, so a sale is never rolled back by posting). Expenses now go
  through the new `db.js` `recordExpense(doc)` (used by `Expenses.jsx` and recurring).
- **Manual entries:** `postJournal({date, description, branchId, lines:[{role|accountId, debit, credit}], ...})`
  opens its own transaction. The Accounting page also has a manual-entry form (must balance).
- Reports computed in JS from entries: `accountBalance(account, entries)` (natural
  sign per type), trial balance, income statement, general ledger. `ACCOUNT_TYPES`
  maps each type to its normal side. Posting starts at adoption — historical
  invoices predating v10 have no entries.

### Treasury — cashboxes & banks (`src/pages/Treasury.jsx`)

- A cashbox/bank **is** a chart-of-accounts asset account flagged `cashbox: true`
  (`cbType: 'cash'|'bank'`), so its balance is exactly its ledger balance — no
  separate cash ledger, no drift. The seeded الصندوق/البنك are cashboxes;
  `ensureCashboxes` backfills the flag for pre-existing databases.
- `createCashbox({name, cbType, openingBalance, ...})` adds the account and posts
  an opening entry (Dr cashbox / Cr capital). `postCashMovement({cashboxId,
  direction:'in'|'out', counterAccountId, amount, ...})` posts a receipt
  (Dr cashbox / Cr counter) or payment (Dr counter / Cr cashbox);
  `postCashTransfer({fromId, toId, amount})` posts Dr destination / Cr source.
  All go through `postJournal`, so treasury and accounting can never disagree.
- The page shows per-cashbox balances, a statement (ledger) per cashbox, and a
  simple bank reconciliation (enter the actual bank balance → shows the difference).

### Tax / VAT (opt-in)

- Settings hold `taxEnabled`, `taxName`, `taxRate` (single configurable rate).
  Items carry a `taxable` flag (default true; uncheck to exempt).
- `InvoiceEditor` computes tax on the taxable lines after allocating the invoice
  discount proportionally (`tax = taxableBase × (subtotal−discount)/subtotal ×
  rate`), so `total` = subtotal − discount + tax. Quotes are never taxed. The
  invoice stores `tax`, `taxRate`, `taxName`; `InvoiceView` (screen/PDF/print/
  WhatsApp) shows the tax line.
- `invoiceJournalLines` splits net vs tax: sales Cr `vat` (output), purchases Dr
  `vat` (input), returns reverse; goods value (revenue/inventory) is `total−tax`.
  With `tax:0` the entries are identical to the pre-tax ones (backward compatible).
- The Accounting page's **الضرائب** tab reports output VAT (sales), input VAT
  (purchases) and net due, from the `vat` account's movement over the period.

### Installments & debt (`src/pages/Installments.jsx`)

- `installmentPlans` (v11) is a monthly schedule over an existing customer debt
  (embedded `installments[]`). `createInstallmentPlan({total, downPayment, count,
  startDate, ...})` splits `total − downPayment` across `count` monthly dues (last
  absorbs rounding); it posts nothing (the underlying credit sale already booked
  the AR). `payInstallment({planId, no, amount})` records a normal customer payment
  (nested `recordPayment` → balance + Dr cash/Cr AR) and marks the installment
  paid/partial — so a plan never double-counts the debt.
- Customers gained a `creditLimit` (Parties form); `InvoiceEditor` shows a soft
  over-limit warning on credit sales, and Parties/aging flag over-limit customers.
- The page's **أعمار الديون** tab buckets each customer's outstanding balance
  (0–30/31–60/61–90/90+) by allocating their payments FIFO to their oldest unpaid
  sale invoices; untracked/opening balances fall in the 0–30 bucket.

### CRM — leads & pipeline (`src/pages/CRM.jsx`)

- `leads` (v12) with stages new/contacted/quoted/negotiation/won/lost; each lead
  carries value, probability, source, `nextFollowUp`, notes and an embedded
  `activities[]` log (call/meeting/note). The page is a horizontal pipeline board
  (a column per stage) with per-card stage move, KPIs (open count, probability-
  weighted value, won-this-month), and a due-follow-ups strip.
- `convertLead(leadId)` (in db.js) creates a customer from the lead once and marks
  it won (idempotent — a second call returns the same customer id). `STAGES` is
  exported for reuse.

### Price lists & coupons (`src/pages/Pricing.jsx`)

- `priceLists` (v13) hold a `prices` map `{ [itemId]: price }`; a customer can be
  assigned a `priceListId` (Parties form). When such a customer is selected in
  `InvoiceEditor`, added lines use the list price and existing lines re-price via
  an effect on the loaded price list (falling back to the item's base salePrice).
- `coupons` (v13): code, type `percent|fixed`, value, minTotal, maxUses, uses,
  expiry, active. `validateCoupon(code, total)` returns `{ok, discount, coupon}`
  or a reason; `redeemCoupon(id)` bumps `uses`. The editor has a coupon field that
  sets the discount and stores `couponCode` on the invoice; the coupon is redeemed
  after a successful save. Item-level quantity pricing still lives on the item
  (`wholesalePrice`/`wholesaleMinQty`).

### Purchase orders & landed cost

- A purchase order is an invoice of `type:'po'` (status `po`) created via
  `InvoiceEditor` (`type="po"`, route `/purchase-order`) → `savePurchaseOrder`
  (number `PO<dev>-…`, no stock/accounting effect, like a quote). It appears in
  the Invoices list and is opened from `InvoiceView`.
- `convertPurchaseOrder(poId, {extraCosts, allocation:'value'|'qty', paid})` runs
  `saveInvoice` for the purchase, then distributes `extraCosts` (shipping/customs)
  across the lines to raise each item's `costPrice` to the real landed unit cost,
  and posts one extra entry (Dr inventory / Cr cash) for the added cost. `InvoiceView`
  drives this from a modal on the PO.

### Fixed assets & depreciation (`src/pages/Assets.jsx`)

- `assets` (v14): name, cost, salvage, usefulYears, straight-line method,
  accumulatedDep, lastDepMonth, status. `ensureAssetAccounts` seeds three system
  accounts (fixed ids 15–17): fixedAsset, accumDep (contra, credit-normal), depExpense.
- `createAsset({..., recordPurchase, cashRole})` adds the asset and (optionally)
  posts Dr fixedAsset / Cr cash|bank. `runDepreciation(month)` posts one month's
  straight-line depreciation (Dr depExpense / Cr accumDep) for every active asset
  not yet depreciated that month, capped at the depreciable base (`lastDepMonth`
  guards against double-posting). `disposeAsset(id, disposalValue)` removes cost +
  accumulated dep, receives cash, and routes the gain/loss to depExpense.
- Helpers `assetMonthlyDep`/`assetBookValue`. The page shows KPIs (cost, accumulated,
  book value, monthly), a "record this month's depreciation" button, and disposal.

### Payroll (`src/pages/Payroll.jsx`)

- `payslips` (v15) per employee per month. `runPayslip({basic, allowances,
  overtime, commission, deductions, advances, cashRole, ...})` computes
  net = basic+allowances+overtime+commission − deductions − advances and posts
  Dr salaries / Cr cash|bank (salaries is system account role `salaries`, id 18).
- The page lists active employees for a chosen month with a paid/unpaid state and
  a payslip editor (prefilled from `employee.baseSalary`); commissions are entered
  as a component. A month summary lists all payslips.

### Projects (`src/pages/Projects.jsx`)

- `projects` (v16): name, optional customer, budget, dates, embedded `tasks[]` and
  `entries[]`. `createProject` adds one; tasks are toggled by updating the record.
  `addProjectEntry({type:'cost'|'income', amount, ...})` appends the entry and posts
  it to the ledger (cost → Dr expense / Cr cash; income → Dr cash / Cr sales), so a
  project's money is real GL activity, and its P&L (income − cost vs budget) shows
  on the page and in an expandable detail modal with tasks + entries.

### Maintenance / work orders (`src/pages/WorkOrders.jsx`)

- `workOrders` (v17): generic repair/service jobs (device type/info, issue,
  technician, parts, laborCost, warranty, status received→in_progress→done→
  delivered). `createWorkOrder` numbers them `WO<dev>-…`.
- `invoiceWorkOrder(id, {paid})` turns a done order into a **sale invoice** via
  `saveInvoice` — parts consume stock + COGS, plus a **non-stock labor line**
  (itemId null). All stock loops now skip `itemId == null` lines, so labor/service
  lines carry revenue without touching inventory.

### Sales reps (`src/pages/Reps.jsx`)

- `repVisits` (v18): a rep's visit log (customer, purpose, order amount, collected
  amount, result). `addRepVisit` records the visit and, when `recordCollection`
  is set, also posts a real customer payment (nested `recordPayment`).
- The page shows per-rep monthly KPIs (visits, orders, collections) with an
  editable monthly target (stored in the `repTargets` setting) and an achievement
  bar, plus the visit log filtered by rep + month.

### WhatsApp auto-send (opt-in)

- Toggle `waAutoSend` (Settings). When on, saving a **sale/quote** invoice for a
  customer with a phone appends `&send=1` to the invoice URL; `InvoiceView`'s
  mount effect opens `wa.me` with the invoice text if online, or shows a
  "ready to send" banner (with a one-tap send button) when offline.

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

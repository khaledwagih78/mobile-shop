import Dexie from 'dexie';

export const db = new Dexie('khaled_erp');

db.version(1).stores({
  items: '++id, code, barcode, name, brand, category, stock',
  customers: '++id, name, phone',
  suppliers: '++id, name, phone',
  invoices: '++id, number, type, partyId, day, createdAt, status',
  payments: '++id, partyType, partyId, day, createdAt',
  stockMoves: '++id, itemId, refType, refId, createdAt',
  expenses: '++id, day, createdAt',
  users: '++id, name, role',
  settings: 'key',
  syncQueue: '++id, synced, createdAt',
});

db.version(2).stores({
  expenses: '++id, day, createdAt, category',
});

db.version(3).stores({
  employees:  '++id, name, status, createdAt',
  empRecords: '++id, employeeId, type, day, createdAt',
});

db.version(4).stores({
  expenses:          '++id, day, createdAt, category, recurringId',
  recurringExpenses: '++id, name, status, createdAt',
});

db.version(5).stores({
  lines:        '++id, number, code, display_name, last_reset_month',
  transactions: '++id, line_id, type, created_at',
  profiles:     'id, email',
});

db.version(6).stores({
  auditLog: '++id, action, entityType, entityId, userId, createdAt',
  deliveries: '++id, invoiceId, status, driverId, createdAt',
});

// ---------- multi-branch support ----------
// A single shop becomes many branches. Each item keeps ONE master record
// (code/name/prices) but its quantity is stored per branch in `item.stocks`
// ({ [branchId]: qty }). Sales, purchases, payments, expenses and stock moves
// each carry a `branchId`. Users may be pinned to one branch (admins see all).
db.version(7).stores({
  branches:   '++id, name, status, createdAt',
  invoices:   '++id, number, type, partyId, branchId, day, createdAt, status',
  payments:   '++id, partyType, partyId, branchId, day, createdAt',
  stockMoves: '++id, itemId, branchId, refType, refId, createdAt',
  expenses:   '++id, day, createdAt, category, recurringId, branchId',
  users:      '++id, name, role, branchId',
  employees:  '++id, name, status, createdAt, branchId',
}).upgrade(async (tx) => {
  const B = DEFAULT_BRANCH_ID; // fixed id, identical on every device
  const iso = new Date().toISOString();
  if (!(await tx.table('branches').get(B))) {
    await tx.table('branches').add({ id: B, name: 'الفرع الرئيسي', status: 'active', createdAt: iso });
  }
  // move each item's single `stock` into a per-branch stocks map
  await tx.table('items').toCollection().modify((it) => {
    if (!it.stocks) it.stocks = { [B]: Number(it.stock || 0) };
  });
  // tag existing transactional records with the default branch
  for (const t of ['invoices', 'payments', 'stockMoves', 'expenses']) {
    await tx.table(t).toCollection().modify((r) => { if (r.branchId == null) r.branchId = B; });
  }
  // admins keep null (= all branches); others default to the main branch
  await tx.table('users').toCollection().modify((u) => {
    if (u.branchId === undefined) u.branchId = u.role === 'admin' ? null : B;
  });
  await tx.table('employees').toCollection().modify((e) => { if (e.branchId == null) e.branchId = B; });
});

// ---------- feature requests / suggestions (any industry) ----------
db.version(8).stores({
  requests: '++id, status, category, createdAt',
});

// ---------- manufacturing / production (factory & restaurant sectors) ----------
// A production run consumes raw-material items and yields a finished product,
// adjusting per-branch stock for both and recording the computed unit cost.
db.version(9).stores({
  productions: '++id, number, productId, branchId, day, createdAt',
});

// ---------- double-entry accounting ----------
// `accounts` is the chart of accounts; `journalEntries` are balanced journal
// vouchers (debits == credits) posted automatically by every business operation
// (sale/purchase/return/payment/expense) and manually by the user. Lines are
// embedded on each entry (like invoices) and totals are computed in JS.
db.version(10).stores({
  accounts:       '++id, code, type, role, parentId, createdAt',
  journalEntries: '++id, number, day, refType, refId, branchId, createdAt',
});

// ---------- installment plans (تقسيط) ----------
// A schedule over an existing customer debt. Paying an installment records a
// normal customer payment (so it flows through balances + accounting) and marks
// the installment paid — the plan never double-counts the debt.
db.version(11).stores({
  installmentPlans: '++id, customerId, invoiceId, status, createdAt',
});

// ---------- CRM: leads & sales pipeline ----------
db.version(12).stores({
  leads: '++id, stage, status, nextFollowUp, createdAt',
});

// ---------- price lists & coupons ----------
// A price list holds per-item price overrides; a customer can be assigned one.
// Coupons are codes that compute a discount at checkout.
db.version(13).stores({
  priceLists: '++id, name, createdAt',
  coupons:    '++id, code, active, createdAt',
});

// ---------- fixed assets & depreciation ----------
db.version(14).stores({
  assets: '++id, name, category, status, branchId, createdAt',
});

// ---------- payroll (payslips) ----------
db.version(15).stores({
  payslips: '++id, employeeId, month, branchId, createdAt',
});


// ---------- globally-unique IDs for multi-device offline sync ----------
// Auto-increment ids restart at 1 on every device, so two devices that create
// records while offline would generate the SAME id and clobber each other on
// the next cloud sync. To prevent that, each device claims its own random block
// of the integer id space and stamps every new record with an id from that
// block, guaranteeing global uniqueness without any schema migration.
// Existing small ids (1..N) sit below every device block, so old data stays valid.
const ID_BLOCK = 2 ** 40; // ~1.1e12 ids reserved per device (well within 2^53)

function deviceBlock() {
  let d = 0;
  try { d = Number(localStorage.getItem('kerp_device_block')); } catch { /* no localStorage */ }
  if (!Number.isInteger(d) || d < 1 || d > 4095) {
    d = 1 + Math.floor(Math.random() * 4095); // 12-bit device id, 1..4095
    try { localStorage.setItem('kerp_device_block', String(d)); } catch { /* ignore */ }
  }
  return d;
}

export function nextId() {
  const base = deviceBlock() * ID_BLOCK;
  let seq = 0;
  try { seq = Number(localStorage.getItem('kerp_id_seq')) || 0; } catch { /* ignore */ }
  seq += 1;
  try { localStorage.setItem('kerp_id_seq', String(seq)); } catch { /* ignore */ }
  return base + seq;
}

// Stamp a globally-unique id on every new record in the synced tables.
// Records arriving from the cloud already carry an id, so they pass through
// untouched (the hook only fills a missing id). 'settings' (keyed by `key`)
// and 'syncQueue' (device-local, never synced) are intentionally excluded.
const ID_TABLES = [
  'items', 'customers', 'suppliers', 'invoices', 'payments', 'stockMoves',
  'expenses', 'recurringExpenses', 'employees', 'empRecords', 'users', 'branches',
  'lines', 'transactions', 'deliveries', 'auditLog', 'requests', 'productions',
  'accounts', 'journalEntries', 'installmentPlans', 'leads', 'priceLists', 'coupons', 'assets', 'payslips',
];
for (const t of ID_TABLES) {
  db[t].hook('creating', (primKey, obj) => {
    if (obj.id == null) obj.id = nextId();
  });
}

// ---------- helpers ----------
export const nowISO = () => new Date().toISOString();
export const dayOf = (iso) => (iso || nowISO()).slice(0, 10); // YYYY-MM-DD
export const today = () => dayOf(nowISO());

// ---------- branches ----------
// The default branch has a FIXED id so every device agrees on it after sync.
export const DEFAULT_BRANCH_ID = 1;
// Quantity of an item at a given branch (stocks is a { branchId: qty } map).
export const stockOf = (item, branchId) =>
  Number((item && item.stocks && item.stocks[branchId]) || 0);
// Total quantity across all branches (for global views).
export const totalStock = (item) =>
  Object.values((item && item.stocks) || {}).reduce((s, q) => s + Number(q || 0), 0);
export async function ensureDefaultBranch() {
  if (await db.branches.get(DEFAULT_BRANCH_ID)) return;
  try {
    await db.branches.add({
      id: DEFAULT_BRANCH_ID, name: 'الفرع الرئيسي', status: 'active', createdAt: nowISO(),
    });
  } catch (e) {
    // A concurrent caller (e.g. StrictMode double-mount) may have created it
    // between the check and the add — that's fine, ignore the key collision.
    if (e.name !== 'ConstraintError') throw e;
  }
}

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// ---------- custom fields (user-defined, per entity: item/customer/supplier) ----------
// Stored as one settings array so it syncs with everything else. Each def:
// { id, entity, label, type: 'text'|'number'|'date' }.
export async function getCustomFields(entity) {
  const all = await getSetting('customFields', []);
  const list = Array.isArray(all) ? all : [];
  return entity ? list.filter((f) => f.entity === entity) : list;
}
export async function saveCustomFields(list) {
  await setSetting('customFields', list);
  import('./sync').then((m) => m.triggerSync()).catch(() => {});
}

// queue every write for cloud sync, then kick off a debounced push/pull
// so changes reach the cloud immediately whenever the internet is available.
export async function queueSync(table, op, payload) {
  await db.syncQueue.add({ table, op, payload, synced: 0, createdAt: nowISO() });
  // Lazy import avoids a static circular dependency (sync.js imports db.js).
  // triggerSync is debounced and is a no-op while offline.
  import('./sync').then((m) => m.triggerSync()).catch(() => {});
}

// ---------- audit log ----------
export async function logAudit(action, entityType, entityId, details = {}) {
  await db.auditLog.add({
    action,
    entityType,
    entityId,
    userId: details.userId || null,
    userName: details.userName || null,
    details: details.extra || null,
    createdAt: nowISO(),
  });
}

// ---------- low stock notifications ----------
let _notifGranted = false;
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') { _notifGranted = true; return true; }
  if (Notification.permission === 'denied') return false;
  const res = await Notification.requestPermission();
  _notifGranted = res === 'granted';
  return _notifGranted;
}
export function checkLowStock(items, branchId = DEFAULT_BRANCH_ID) {
  if (!_notifGranted) return;
  const low = items.filter((it) => stockOf(it, branchId) > 0 && stockOf(it, branchId) <= (it.minStock || 0));
  if (low.length > 0) {
    new Notification('⚠️ تنبيه مخزون', {
      body: `${low.length} أصناف وصلت للحد الأدنى`,
      icon: '/mobile-shop/icon-192.png',
    });
  }
}

// sequential invoice numbers, tagged per device: S<dev>-00001 / P<dev>-00001.
// A per-device sequence (localStorage) plus the device tag keeps numbers unique
// and stable even when several devices issue invoices offline at the same time.
export async function nextInvoiceNumber(type) {
  const dev = deviceBlock();
  const key = `kerp_inv_seq_${type}`;
  let cur = 0;
  try { cur = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
  cur += 1;
  try { localStorage.setItem(key, String(cur)); } catch { /* ignore */ }
  const prefix = type === 'sale' ? 'S' : 'P';
  return `${prefix}${dev}-${String(cur).padStart(5, '0')}`;
}

// ---------- first run: seed admin user + default branch ----------
export async function ensureSeed() {
  await ensureDefaultBranch();
  await ensureChartOfAccounts();
  await ensureAssetAccounts();
  await ensureCashboxes();
  const count = await db.users.count();
  if (count === 0) {
    await db.users.add({
      name: 'المدير',
      pin: '1234',
      role: 'admin',
      branchId: null, // admin sees all branches
      createdAt: nowISO(),
    });
  }
}

// ---------- core business operations (transactional) ----------

// Save a sale or purchase invoice and update stock / balances atomically
export async function saveInvoice(inv) {
  return db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.settings, db.auditLog, db.accounts, db.journalEntries, db.syncQueue],
    async () => {
      const number = await nextInvoiceNumber(inv.type);
      const createdAt = nowISO();
      const b = inv.branchId || DEFAULT_BRANCH_ID;
      const doc = { ...inv, number, createdAt, day: dayOf(createdAt), status: 'active', branchId: b };
      const id = await db.invoices.add(doc);

      for (const line of inv.lines) {
        const item = await db.items.get(line.itemId);
        if (!item) continue;
        const qBase = line.qty * (line.factor || 1); // qty converted to base units
        const stocks = { ...(item.stocks || {}) };
        const cur = Number(stocks[b] || 0);
        if (inv.type === 'sale') {
          stocks[b] = cur - qBase;
          await db.items.update(line.itemId, { stocks });
        } else {
          // purchase: increase this branch's stock and update cost price
          stocks[b] = cur + qBase;
          await db.items.update(line.itemId, { stocks, costPrice: line.factor > 1 ? item.costPrice : line.price });
        }
        await db.stockMoves.add({
          itemId: line.itemId,
          itemName: line.name,
          qty: qBase,
          branchId: b,
          direction: inv.type === 'sale' ? 'out' : 'in',
          refType: inv.type,
          refId: id,
          refNumber: number,
          createdAt,
        });
      }

      // credit balance (آجل)
      if (inv.remaining > 0 && inv.partyId) {
        if (inv.type === 'sale') {
          const c = await db.customers.get(inv.partyId);
          if (c) await db.customers.update(inv.partyId, { balance: (c.balance || 0) + inv.remaining });
        } else {
          const s = await db.suppliers.get(inv.partyId);
          if (s) await db.suppliers.update(inv.partyId, { balance: (s.balance || 0) + inv.remaining });
        }
      }

      // loyalty points: 1 point per 100 EGP spent
      if (inv.type === 'sale' && inv.partyId && inv.total >= 100) {
        const pts = Math.floor(inv.total / 100);
        const c = await db.customers.get(inv.partyId);
        if (c) {
          await db.customers.update(inv.partyId, {
            points: (c.points || 0) + pts,
            totalSpent: (c.totalSpent || 0) + inv.total,
          });
        }
      }

      // audit log
      await logAudit('create', 'invoice', id, {
        userId: inv.userId, userName: inv.userName,
        extra: { number, type: inv.type, total: inv.total, partyName: inv.partyName },
      });

      // double-entry posting (skips silently if accounts unseeded / unbalanced)
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: doc.day, description: `فاتورة ${inv.type === 'sale' ? 'بيع' : 'شراء'} ${number}`,
        refType: 'invoice', refId: id, refNumber: number, branchId: b,
        lines: invoiceJournalLines({ ...inv }), accounts, userId: inv.userId, userName: inv.userName,
      });

      await queueSync('invoices', 'add', { ...doc, id });
      return { id, number };
    }
  );
}

// Cancel an invoice: reverse stock and balances (admin only - enforced in UI)
export async function cancelInvoice(invoiceId, userName) {
  const snapshot = await db.invoices.get(invoiceId);
  const result = await db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.auditLog, db.accounts, db.journalEntries, db.syncQueue],
    async () => {
      const inv = await db.invoices.get(invoiceId);
      if (!inv || inv.status === 'cancelled') return;
      const b = inv.branchId || DEFAULT_BRANCH_ID;
      for (const line of inv.lines) {
        const item = await db.items.get(line.itemId);
        if (!item) continue;
        const qBase = line.qty * (line.factor || 1);
        const stocks = { ...(item.stocks || {}) };
        const delta = inv.type === 'sale' ? qBase : -qBase;
        stocks[b] = Number(stocks[b] || 0) + delta;
        await db.items.update(line.itemId, { stocks });
        await db.stockMoves.add({
          itemId: line.itemId,
          itemName: line.name,
          qty: qBase,
          branchId: b,
          direction: inv.type === 'sale' ? 'in' : 'out',
          refType: 'cancel',
          refId: invoiceId,
          refNumber: inv.number,
          createdAt: nowISO(),
        });
      }
      if (inv.remaining > 0 && inv.partyId) {
        if (inv.type === 'sale') {
          const c = await db.customers.get(inv.partyId);
          if (c) await db.customers.update(inv.partyId, { balance: (c.balance || 0) - inv.remaining });
        } else {
          const s = await db.suppliers.get(inv.partyId);
          if (s) await db.suppliers.update(inv.partyId, { balance: (s.balance || 0) - inv.remaining });
        }
      }
      await db.invoices.update(invoiceId, {
        status: 'cancelled',
        cancelledAt: nowISO(),
        cancelledBy: userName,
      });
      await logAudit('cancel', 'invoice', invoiceId, {
        userName,
        extra: { number: inv.number, type: inv.type, total: inv.total },
      });
      // reverse the original posting
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: today(), description: `إلغاء فاتورة ${inv.number}`,
        refType: 'cancel', refId: invoiceId, refNumber: inv.number, branchId: b,
        lines: reverseJournalLines(invoiceJournalLines(inv)), accounts, userName,
      });
      await queueSync('invoices', 'cancel', { id: invoiceId });
    }
  );
  if (snapshot && snapshot.status !== 'cancelled') {
    import('./notify').then((m) => m.notifyEvent({
      action: 'cancel',
      title: `⛔ إلغاء فاتورة ${snapshot.number}`,
      body: `تم إلغاء فاتورة ${snapshot.type === 'sale' ? 'بيع' : 'شراء'} رقم ${snapshot.number} بإجمالي ${snapshot.total} ج.م — بواسطة ${userName || '—'}.`,
    })).catch(() => {});
  }
  return result;
}

// Restore a cancelled invoice: re-apply its original stock & balance effect.
export async function restoreInvoice(invoiceId, userName) {
  const snapshot = await db.invoices.get(invoiceId);
  const result = await db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.auditLog, db.accounts, db.journalEntries, db.syncQueue],
    async () => {
      const inv = await db.invoices.get(invoiceId);
      if (!inv || inv.status !== 'cancelled') return;
      const b = inv.branchId || DEFAULT_BRANCH_ID;
      for (const line of inv.lines) {
        const item = await db.items.get(line.itemId);
        if (!item) continue;
        const qBase = line.qty * (line.factor || 1);
        const stocks = { ...(item.stocks || {}) };
        // original effect: sale removes stock, purchase adds it
        stocks[b] = Number(stocks[b] || 0) + (inv.type === 'sale' ? -qBase : qBase);
        await db.items.update(line.itemId, { stocks });
        await db.stockMoves.add({
          itemId: line.itemId, itemName: line.name, qty: qBase, branchId: b,
          direction: inv.type === 'sale' ? 'out' : 'in',
          refType: inv.type, refId: invoiceId, refNumber: inv.number, createdAt: nowISO(),
        });
      }
      if (inv.remaining > 0 && inv.partyId) {
        if (inv.type === 'sale') {
          const c = await db.customers.get(inv.partyId);
          if (c) await db.customers.update(inv.partyId, { balance: (c.balance || 0) + inv.remaining });
        } else {
          const s = await db.suppliers.get(inv.partyId);
          if (s) await db.suppliers.update(inv.partyId, { balance: (s.balance || 0) + inv.remaining });
        }
      }
      await db.invoices.update(invoiceId, { status: 'active', cancelledAt: null, cancelledBy: null, restoredAt: nowISO(), restoredBy: userName });
      await logAudit('restore', 'invoice', invoiceId, { userName, extra: { number: inv.number, type: inv.type, total: inv.total } });
      // re-apply the original posting
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: today(), description: `استرجاع فاتورة ${inv.number}`,
        refType: 'restore', refId: invoiceId, refNumber: inv.number, branchId: b,
        lines: invoiceJournalLines(inv), accounts, userName,
      });
      await queueSync('invoices', 'restore', { id: invoiceId });
    }
  );
  if (snapshot && snapshot.status === 'cancelled') {
    import('./notify').then((m) => m.notifyEvent({
      action: 'restore',
      title: `♻️ استرجاع فاتورة ${snapshot.number}`,
      body: `تم استرجاع فاتورة ${snapshot.type === 'sale' ? 'بيع' : 'شراء'} رقم ${snapshot.number} بإجمالي ${snapshot.total} ج.م — بواسطة ${userName || '—'}.`,
    })).catch(() => {});
  }
  return result;
}

// ---------- quotations (عرض سعر) — no stock/balance effect until converted ----------
export async function saveQuote(inv) {
  return db.transaction('rw', [db.invoices, db.syncQueue], async () => {
    const dev = deviceBlock();
    const key = 'kerp_inv_seq_quote';
    let cur = 0; try { cur = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
    cur += 1; try { localStorage.setItem(key, String(cur)); } catch { /* ignore */ }
    const number = `Q${dev}-${String(cur).padStart(5, '0')}`;
    const createdAt = nowISO();
    const doc = { ...inv, type: 'quote', number, createdAt, day: dayOf(createdAt), status: 'quote', branchId: inv.branchId || DEFAULT_BRANCH_ID };
    const id = await db.invoices.add(doc);
    await queueSync('invoices', 'add', { ...doc, id });
    return { id, number };
  });
}

// Turn a quote into a real sale invoice (applies stock & balances via saveInvoice).
export async function convertQuote(quoteId, userName) {
  const q = await db.invoices.get(quoteId);
  if (!q || q.type !== 'quote' || q.status === 'converted') return null;
  const res = await saveInvoice({
    type: 'sale', branchId: q.branchId, partyId: q.partyId, partyName: q.partyName,
    lines: q.lines, subtotal: q.subtotal, discount: q.discount, total: q.total,
    paid: q.paid, remaining: q.remaining, profit: q.profit, userId: q.userId, userName,
  });
  await db.invoices.update(quoteId, { status: 'converted', convertedTo: res.id, convertedAt: nowISO() });
  await queueSync('invoices', 'update', { id: quoteId, status: 'converted' });
  return res;
}

// ---------- purchase orders (طلب شراء) + landed cost ----------
// A PO is a purchase-side draft: no stock/accounting effect until converted.
export async function savePurchaseOrder(inv) {
  return db.transaction('rw', [db.invoices, db.syncQueue], async () => {
    const dev = deviceBlock();
    const key = 'kerp_inv_seq_po';
    let cur = 0; try { cur = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
    cur += 1; try { localStorage.setItem(key, String(cur)); } catch { /* ignore */ }
    const number = `PO${dev}-${String(cur).padStart(5, '0')}`;
    const createdAt = nowISO();
    const doc = { ...inv, type: 'po', number, createdAt, day: dayOf(createdAt), status: 'po', branchId: inv.branchId || DEFAULT_BRANCH_ID };
    const id = await db.invoices.add(doc);
    await queueSync('invoices', 'add', { ...doc, id });
    return { id, number };
  });
}

// Convert a PO to a purchase invoice, optionally distributing extra costs
// (shipping/customs) across the lines to compute the real landed unit cost.
// allocation: 'value' (by line value) | 'qty' (by quantity).
export async function convertPurchaseOrder(poId, { extraCosts = 0, allocation = 'value', paid, userName }) {
  const po = await db.invoices.get(poId);
  if (!po || po.type !== 'po' || po.status === 'converted') return null;
  const extra = Number(extraCosts) || 0;
  const subtotal = Number(po.subtotal) || po.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const discount = Number(po.discount) || 0;
  const total = Math.max(0, subtotal - discount);
  const paidNum = paid != null ? Number(paid) : total;
  const res = await saveInvoice({
    type: 'purchase', branchId: po.branchId, partyId: po.partyId, partyName: po.partyName,
    lines: po.lines, subtotal, discount, tax: 0, total,
    paid: paidNum, remaining: Math.max(0, total - paidNum), profit: 0, userId: po.userId, userName,
  });
  if (extra > 0) {
    await db.transaction('rw', [db.items, db.accounts, db.journalEntries, db.syncQueue], async () => {
      const totalQty = po.lines.reduce((s, l) => s + l.qty, 0);
      for (const l of po.lines) {
        const weight = allocation === 'qty'
          ? (totalQty > 0 ? l.qty / totalQty : 0)
          : (subtotal > 0 ? (l.qty * l.price) / subtotal : 0);
        const perUnit = l.qty > 0 ? (extra * weight) / l.qty : 0;
        const item = await db.items.get(l.itemId);
        if (item) await db.items.update(l.itemId, { costPrice: Math.round((l.price + perUnit) * 100) / 100 });
      }
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: today(), description: `تكاليف إضافية (شحن/جمارك) — ${po.number}`, refType: 'landed',
        refId: res.id, refNumber: po.number, branchId: po.branchId,
        lines: [{ role: 'inventory', debit: extra }, { role: 'cash', credit: extra }], accounts, userName,
      });
    });
  }
  await db.invoices.update(poId, { status: 'converted', convertedTo: res.id, convertedAt: nowISO(), extraCosts: extra });
  await queueSync('invoices', 'update', { id: poId, status: 'converted' });
  return res;
}

// ---------- returns (مرتجعات) — reverse of a sale/purchase ----------
export async function saveReturn(inv) {
  return db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.auditLog, db.accounts, db.journalEntries, db.syncQueue],
    async () => {
      const isSaleRet = inv.type === 'sale_return';
      const dev = deviceBlock();
      const key = isSaleRet ? 'kerp_inv_seq_sret' : 'kerp_inv_seq_pret';
      let cur = 0; try { cur = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
      cur += 1; try { localStorage.setItem(key, String(cur)); } catch { /* ignore */ }
      const number = `${isSaleRet ? 'RS' : 'RP'}${dev}-${String(cur).padStart(5, '0')}`;
      const createdAt = nowISO();
      const b = inv.branchId || DEFAULT_BRANCH_ID;
      const doc = { ...inv, number, createdAt, day: dayOf(createdAt), status: 'active', branchId: b };
      const id = await db.invoices.add(doc);
      for (const line of inv.lines) {
        const item = await db.items.get(line.itemId);
        if (!item) continue;
        const qBase = line.qty * (line.factor || 1);
        const stocks = { ...(item.stocks || {}) };
        // sale return: goods come back (+); purchase return: goods go out (-)
        stocks[b] = Number(stocks[b] || 0) + (isSaleRet ? qBase : -qBase);
        await db.items.update(line.itemId, { stocks });
        await db.stockMoves.add({
          itemId: line.itemId, itemName: line.name, qty: qBase, branchId: b,
          direction: isSaleRet ? 'in' : 'out', refType: inv.type, refId: id, refNumber: number, createdAt,
        });
      }
      // credit the party's balance by the returned value
      if (inv.partyId && inv.total > 0) {
        if (isSaleRet) {
          const c = await db.customers.get(inv.partyId);
          if (c) await db.customers.update(inv.partyId, { balance: (c.balance || 0) - inv.total });
        } else {
          const s = await db.suppliers.get(inv.partyId);
          if (s) await db.suppliers.update(inv.partyId, { balance: (s.balance || 0) - inv.total });
        }
      }
      await logAudit('return', inv.type, id, { userName: inv.userName, extra: { number, total: inv.total } });
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: doc.day, description: `${isSaleRet ? 'مرتجع بيع' : 'مرتجع شراء'} ${number}`,
        refType: 'return', refId: id, refNumber: number, branchId: b,
        lines: invoiceJournalLines({ ...inv }), accounts, userId: inv.userId, userName: inv.userName,
      });
      await queueSync('invoices', 'add', { ...doc, id });
      return { id, number };
    }
  );
}

// Record a payment from customer (in) or to supplier (out)
export async function recordPayment({ partyType, partyId, partyName, amount, note, userName, branchId }) {
  return db.transaction('rw', [db.payments, db.customers, db.suppliers, db.accounts, db.journalEntries, db.syncQueue], async () => {
    const createdAt = nowISO();
    const b = branchId || DEFAULT_BRANCH_ID;
    const doc = { partyType, partyId, partyName, amount, note, userName, branchId: b, createdAt, day: dayOf(createdAt) };
    const id = await db.payments.add(doc);
    if (partyType === 'customer') {
      const c = await db.customers.get(partyId);
      if (c) await db.customers.update(partyId, { balance: (c.balance || 0) - amount });
    } else {
      const s = await db.suppliers.get(partyId);
      if (s) await db.suppliers.update(partyId, { balance: (s.balance || 0) - amount });
    }
    // double-entry: customer pays us → Dr cash / Cr AR ; we pay supplier → Dr AP / Cr cash
    const accounts = await db.accounts.toArray();
    const amt = Number(amount || 0);
    await writeJournalEntry({
      date: doc.day, description: `${partyType === 'customer' ? 'تحصيل من' : 'دفعة إلى'} ${partyName || ''}`.trim(),
      refType: 'payment', refId: id, refNumber: null, branchId: b,
      lines: partyType === 'customer'
        ? [{ role: 'cash', debit: amt }, { role: 'ar', credit: amt }]
        : [{ role: 'ap', debit: amt }, { role: 'cash', credit: amt }],
      accounts, userName,
    });
    await queueSync('payments', 'add', { ...doc, id });
    return id;
  });
}

// Record an expense and post it to accounting (Dr expense / Cr cash) atomically.
export async function recordExpense(doc) {
  return db.transaction('rw', [db.expenses, db.accounts, db.journalEntries, db.syncQueue], async () => {
    const createdAt = doc.createdAt || nowISO();
    const full = { ...doc, createdAt, day: doc.day || today(), branchId: doc.branchId || DEFAULT_BRANCH_ID };
    const id = await db.expenses.add(full);
    const accounts = await db.accounts.toArray();
    const amt = Number(full.amount || 0);
    await writeJournalEntry({
      date: full.day, description: `مصروف: ${full.description || full.category || ''}`.trim(),
      refType: 'expense', refId: id, refNumber: null, branchId: full.branchId,
      lines: [{ role: 'expense', debit: amt }, { role: 'cash', credit: amt }],
      accounts, userName: full.userName,
    });
    await queueSync('expenses', 'add', { ...full, id });
    return id;
  });
}

// ---------- installments (تقسيط) ----------
// Build a monthly schedule over `total − downPayment` across `count` installments.
export async function createInstallmentPlan({ customerId, customerName, invoiceId, invoiceNumber, total, downPayment = 0, count, startDate, branchId, userName }) {
  const t = Number(total) || 0, dp = Number(downPayment) || 0, n = Math.max(1, Number(count) || 1);
  const financed = Math.max(0, Math.round((t - dp) * 100) / 100);
  const per = Math.floor((financed / n) * 100) / 100;
  const start = startDate || today();
  const [sy, sm, sd] = start.split('-').map(Number);
  const installments = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(sy, (sm - 1) + i, sd || 1);
    const amount = i === n - 1 ? Math.round((financed - allocated) * 100) / 100 : per;
    allocated = Math.round((allocated + amount) * 100) / 100;
    installments.push({ no: i + 1, dueDate: d.toISOString().slice(0, 10), amount, paidAmount: 0, status: 'due' });
  }
  return db.transaction('rw', [db.installmentPlans, db.syncQueue], async () => {
    const doc = {
      customerId, customerName, invoiceId: invoiceId || null, invoiceNumber: invoiceNumber || null,
      total: t, downPayment: dp, financed, count: n, startDate: start,
      branchId: branchId || DEFAULT_BRANCH_ID, installments, status: 'active', createdAt: nowISO(), userName,
    };
    const id = await db.installmentPlans.add(doc);
    await queueSync('installmentPlans', 'add', { ...doc, id });
    return { id };
  });
}

// Pay one installment: records a customer payment (balance + ledger) and marks
// the installment paid/partial — all in one transaction.
export async function payInstallment({ planId, no, amount, note, userName }) {
  return db.transaction(
    'rw',
    [db.installmentPlans, db.payments, db.customers, db.suppliers, db.accounts, db.journalEntries, db.syncQueue],
    async () => {
      const plan = await db.installmentPlans.get(planId);
      if (!plan) return null;
      const insts = plan.installments.map((x) => ({ ...x }));
      const inst = insts.find((x) => x.no === no);
      if (!inst) return null;
      const due = Math.round((inst.amount - (inst.paidAmount || 0)) * 100) / 100;
      const pay = Math.min(Number(amount) || 0, due);
      if (pay <= 0) return null;
      // nested recordPayment — its table scope is a subset, so it joins this tx
      await recordPayment({ partyType: 'customer', partyId: plan.customerId, partyName: plan.customerName, amount: pay, note: note || `قسط #${no}`, userName, branchId: plan.branchId });
      inst.paidAmount = Math.round(((inst.paidAmount || 0) + pay) * 100) / 100;
      inst.status = inst.paidAmount >= inst.amount - 0.01 ? 'paid' : 'partial';
      const allPaid = insts.every((x) => x.status === 'paid');
      const status = allPaid ? 'completed' : 'active';
      await db.installmentPlans.update(planId, { installments: insts, status });
      await queueSync('installmentPlans', 'update', { id: planId, installments: insts, status });
      return { pay };
    }
  );
}

// ---------- CRM ----------
// Convert a lead into a real customer (once), marking the lead won.
export async function convertLead(leadId) {
  return db.transaction('rw', [db.leads, db.customers, db.syncQueue], async () => {
    const lead = await db.leads.get(leadId);
    if (!lead) return null;
    if (lead.customerId) return lead.customerId;
    const cdoc = { name: lead.name, phone: lead.phone || '', address: lead.company || '', balance: 0, points: 0, totalSpent: 0, creditLimit: 0, createdAt: nowISO() };
    const cid = await db.customers.add(cdoc);
    await queueSync('customers', 'add', { ...cdoc, id: cid });
    await db.leads.update(leadId, { status: 'won', stage: 'won', customerId: cid });
    await queueSync('leads', 'update', { id: leadId, status: 'won', stage: 'won', customerId: cid });
    return cid;
  });
}

// ---------- coupons ----------
// Validate a coupon code against an order total; returns the computed discount.
export async function validateCoupon(code, total) {
  const key = String(code || '').trim().toLowerCase();
  if (!key) return { ok: false, reason: 'أدخل كود الكوبون' };
  const c = (await db.coupons.toArray()).find((x) => (x.code || '').toLowerCase() === key);
  if (!c) return { ok: false, reason: 'كوبون غير موجود' };
  if (c.active === false) return { ok: false, reason: 'الكوبون غير مفعّل' };
  if (c.expiry && c.expiry < today()) return { ok: false, reason: 'انتهت صلاحية الكوبون' };
  if (c.maxUses && (c.uses || 0) >= c.maxUses) return { ok: false, reason: 'تم استهلاك الكوبون بالكامل' };
  if (c.minTotal && Number(total) < c.minTotal) return { ok: false, reason: `الحد الأدنى للفاتورة ${c.minTotal}` };
  const t = Number(total) || 0;
  const discount = c.type === 'percent'
    ? Math.round(t * (Number(c.value) || 0)) / 100
    : Math.min(Number(c.value) || 0, t);
  return { ok: true, discount, coupon: c };
}

export async function redeemCoupon(couponId) {
  const c = await db.coupons.get(couponId);
  if (!c) return;
  const uses = (c.uses || 0) + 1;
  await db.coupons.update(couponId, { uses });
  await queueSync('coupons', 'update', { id: couponId, uses });
}

// ---------- fixed assets & depreciation (straight-line) ----------
const monthKey = (iso) => (iso || nowISO()).slice(0, 7);
export const assetMonthlyDep = (a) => {
  const base = Math.max(0, (Number(a.cost) || 0) - (Number(a.salvage) || 0));
  const months = Math.max(1, (Number(a.usefulYears) || 1) * 12);
  return Math.round((base / months) * 100) / 100;
};
export const assetBookValue = (a) => Math.round(((Number(a.cost) || 0) - (Number(a.accumulatedDep) || 0)) * 100) / 100;

export async function createAsset({ name, category, cost, salvage = 0, usefulYears, purchaseDate, branchId, recordPurchase, cashRole = 'cash', userName }) {
  return db.transaction('rw', [db.assets, db.accounts, db.journalEntries, db.syncQueue], async () => {
    const doc = {
      name: (name || '').trim(), category: category || '', cost: Number(cost) || 0, salvage: Number(salvage) || 0,
      usefulYears: Number(usefulYears) || 1, purchaseDate: purchaseDate || today(), method: 'straight',
      accumulatedDep: 0, lastDepMonth: null, status: 'active', branchId: branchId || DEFAULT_BRANCH_ID, createdAt: nowISO(),
    };
    const id = await db.assets.add(doc);
    await queueSync('assets', 'add', { ...doc, id });
    if (recordPurchase && doc.cost > 0) {
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: doc.purchaseDate, description: `شراء أصل: ${doc.name}`, refType: 'asset_buy', refId: id,
        branchId: doc.branchId, lines: [{ role: 'fixedAsset', debit: doc.cost }, { role: cashRole, credit: doc.cost }], accounts, userName,
      });
    }
    return { id };
  });
}

// Post one month's depreciation for every active asset that hasn't been
// depreciated in the given month yet (Dr depreciation expense / Cr accum. dep).
export async function runDepreciation(month, userName) {
  const mk = month || monthKey();
  return db.transaction('rw', [db.assets, db.accounts, db.journalEntries, db.syncQueue], async () => {
    const accounts = await db.accounts.toArray();
    const assets = await db.assets.where('status').equals('active').toArray();
    let count = 0, total = 0;
    for (const a of assets) {
      if (a.lastDepMonth === mk) continue;
      const base = Math.max(0, (Number(a.cost) || 0) - (Number(a.salvage) || 0));
      const remaining = Math.round((base - (Number(a.accumulatedDep) || 0)) * 100) / 100;
      if (remaining <= 0) { await db.assets.update(a.id, { lastDepMonth: mk }); continue; }
      const dep = Math.min(assetMonthlyDep(a), remaining);
      if (dep <= 0) continue;
      await writeJournalEntry({
        date: `${mk}-28`, description: `إهلاك ${mk}: ${a.name}`, refType: 'depreciation', refId: a.id,
        branchId: a.branchId, lines: [{ role: 'depExpense', debit: dep }, { role: 'accumDep', credit: dep }], accounts, userName,
      });
      await db.assets.update(a.id, { accumulatedDep: Math.round(((Number(a.accumulatedDep) || 0) + dep) * 100) / 100, lastDepMonth: mk });
      await queueSync('assets', 'update', { id: a.id });
      count++; total = Math.round((total + dep) * 100) / 100;
    }
    return { count, total, month: mk };
  });
}

// Dispose an asset: remove cost + accumulated dep, receive disposalValue in cash,
// route the difference to depreciation expense (loss debit / gain credit).
export async function disposeAsset(assetId, disposalValue, userName) {
  return db.transaction('rw', [db.assets, db.accounts, db.journalEntries, db.syncQueue], async () => {
    const a = await db.assets.get(assetId);
    if (!a || a.status === 'disposed') return null;
    const dv = Number(disposalValue) || 0;
    const cost = Number(a.cost) || 0, accum = Number(a.accumulatedDep) || 0;
    const book = cost - accum;
    const diff = book - dv; // >0 loss, <0 gain
    const lines = [
      { role: 'cash', debit: dv },
      { role: 'accumDep', debit: accum },
      { role: 'fixedAsset', credit: cost },
    ];
    if (diff > 0) lines.push({ role: 'depExpense', debit: diff });
    else if (diff < 0) lines.push({ role: 'depExpense', credit: -diff });
    const accounts = await db.accounts.toArray();
    await writeJournalEntry({ date: today(), description: `استبعاد أصل: ${a.name}`, refType: 'asset_dispose', refId: assetId, branchId: a.branchId, lines, accounts, userName });
    await db.assets.update(assetId, { status: 'disposed', disposedDate: today(), disposalValue: dv });
    await queueSync('assets', 'update', { id: assetId, status: 'disposed' });
    return { book, diff };
  });
}

// ---------- payroll ----------
// Create & pay one payslip: net = basic + allowances + overtime + commission
// − deductions − advances, posting Dr salaries / Cr cash|bank.
export async function runPayslip({ employeeId, employeeName, month, basic = 0, allowances = 0, overtime = 0, commission = 0, deductions = 0, advances = 0, cashRole = 'cash', branchId, userName }) {
  const gross = (Number(basic) || 0) + (Number(allowances) || 0) + (Number(overtime) || 0) + (Number(commission) || 0);
  const net = Math.round((gross - (Number(deductions) || 0) - (Number(advances) || 0)) * 100) / 100;
  return db.transaction('rw', [db.payslips, db.accounts, db.journalEntries, db.syncQueue], async () => {
    const doc = {
      employeeId, employeeName, month, basic: Number(basic) || 0, allowances: Number(allowances) || 0,
      overtime: Number(overtime) || 0, commission: Number(commission) || 0, deductions: Number(deductions) || 0,
      advances: Number(advances) || 0, net, branchId: branchId || DEFAULT_BRANCH_ID, cashRole, status: 'posted',
      createdAt: nowISO(), day: today(), userName,
    };
    const id = await db.payslips.add(doc);
    if (net > 0) {
      const accounts = await db.accounts.toArray();
      await writeJournalEntry({
        date: doc.day, description: `راتب ${month}: ${employeeName}`, refType: 'payroll', refId: id,
        branchId: doc.branchId, lines: [{ role: 'salaries', debit: net }, { role: cashRole, credit: net }], accounts, userName,
      });
    }
    await queueSync('payslips', 'add', { ...doc, id });
    return { id, net };
  });
}

// Transfer stock quantities from one branch to another (atomic).
// `lines` = [{ itemId, name, qty }]. Records two stock moves per item.
export async function transferStock({ fromBranch, toBranch, lines, userName }) {
  if (fromBranch === toBranch) throw new Error('اختر فرعين مختلفين');
  return db.transaction('rw', [db.items, db.stockMoves, db.auditLog, db.syncQueue], async () => {
    const createdAt = nowISO();
    const ref = `TRF-${deviceBlock()}-${String(Date.now()).slice(-6)}`;
    let count = 0;
    for (const line of lines) {
      const qty = Number(line.qty || 0);
      if (qty <= 0) continue;
      const item = await db.items.get(line.itemId);
      if (!item) continue;
      const stocks = { ...(item.stocks || {}) };
      stocks[fromBranch] = Number(stocks[fromBranch] || 0) - qty;
      stocks[toBranch] = Number(stocks[toBranch] || 0) + qty;
      await db.items.update(line.itemId, { stocks });
      await db.stockMoves.add({ itemId: line.itemId, itemName: line.name || item.name, qty, branchId: fromBranch, direction: 'out', refType: 'transfer', refNumber: ref, createdAt });
      await db.stockMoves.add({ itemId: line.itemId, itemName: line.name || item.name, qty, branchId: toBranch, direction: 'in', refType: 'transfer', refNumber: ref, createdAt });
      count++;
    }
    await logAudit('transfer', 'stock', ref, { userName, extra: { ref, fromBranch, toBranch, count } });
    await queueSync('items', 'transfer', { ref, fromBranch, toBranch, count });
    return { ref, count };
  });
}

// ---------- manufacturing / production ----------
// Consume raw-material `components` and produce `qty` of a finished `productId`,
// all within one branch. Adjusts per-branch stock for every item involved,
// writes stock moves, computes the finished unit cost (materials + labor + other)
// and stores it on the product, and records the run. `components` = [{ itemId, qty }].
export async function recordProduction({ branchId, productId, productName, qty, components, laborCost, otherCost, saveRecipe, userId, userName }) {
  const q = Number(qty || 0);
  if (!productId || q <= 0) throw new Error('اختر المنتج النهائي والكمية');
  const comps = (components || []).filter((c) => c.itemId && Number(c.qty) > 0);
  if (comps.length === 0) throw new Error('أضف مادة خام واحدة على الأقل');
  return db.transaction('rw', [db.items, db.stockMoves, db.productions, db.auditLog, db.syncQueue], async () => {
    const b = branchId || DEFAULT_BRANCH_ID;
    const createdAt = nowISO();
    const dev = deviceBlock();
    const key = 'kerp_prod_seq';
    let cur = 0; try { cur = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
    cur += 1; try { localStorage.setItem(key, String(cur)); } catch { /* ignore */ }
    const number = `MFG${dev}-${String(cur).padStart(5, '0')}`;

    let materialsCost = 0;
    for (const c of comps) {
      const cq = Number(c.qty || 0);
      const item = await db.items.get(c.itemId);
      if (!item) continue;
      const stocks = { ...(item.stocks || {}) };
      stocks[b] = Number(stocks[b] || 0) - cq;
      await db.items.update(c.itemId, { stocks });
      materialsCost += cq * Number(item.costPrice || 0);
      await db.stockMoves.add({
        itemId: c.itemId, itemName: item.name, qty: cq, branchId: b,
        direction: 'out', refType: 'production', refId: number, refNumber: number, createdAt,
      });
    }

    const totalCost = materialsCost + Number(laborCost || 0) + Number(otherCost || 0);
    const unitCost = Math.round((totalCost / q) * 100) / 100;

    const product = await db.items.get(productId);
    if (product) {
      const stocks = { ...(product.stocks || {}) };
      stocks[b] = Number(stocks[b] || 0) + q;
      const patch = { stocks, costPrice: unitCost };
      // optionally remember the recipe on the product for next time
      if (saveRecipe) patch.bom = comps.map((c) => ({ itemId: c.itemId, qty: Number(c.qty) || 0 }));
      await db.items.update(productId, patch);
      await db.stockMoves.add({
        itemId: productId, itemName: product.name, qty: q, branchId: b,
        direction: 'in', refType: 'production', refId: number, refNumber: number, createdAt,
      });
    }

    const doc = {
      number, branchId: b, productId, productName: productName || (product && product.name) || '',
      qty: q, components: comps.map((c) => ({ itemId: c.itemId, name: c.name, qty: Number(c.qty) || 0 })),
      laborCost: Number(laborCost || 0), otherCost: Number(otherCost || 0),
      materialsCost, totalCost, unitCost, userId, userName, createdAt, day: dayOf(createdAt),
    };
    const id = await db.productions.add(doc);
    await logAudit('production', 'production', id, { userId, userName, extra: { number, productName: doc.productName, qty: q } });
    await queueSync('productions', 'add', { ...doc, id });
    return { id, number, unitCost };
  });
}

// ---------- double-entry accounting ----------
// Account types and their "normal" balance side. asset/expense are debit-normal
// (balance = debits − credits); liability/equity/revenue are credit-normal.
export const ACCOUNT_TYPES = {
  asset:     { label: 'أصول',        normal: 'debit'  },
  liability: { label: 'خصوم',        normal: 'credit' },
  equity:    { label: 'حقوق ملكية',  normal: 'credit' },
  revenue:   { label: 'إيرادات',     normal: 'credit' },
  expense:   { label: 'مصروفات',     normal: 'debit'  },
};

// Default chart of accounts, seeded once. `role` marks the "system" accounts the
// auto-posting engine targets (resolved by role so renames/re-codes don't break it).
// System accounts use FIXED ids (like DEFAULT_BRANCH_ID) so every device agrees
// on them and a concurrent double-seed (React StrictMode / racing callers) hits a
// ConstraintError on the duplicate id instead of creating a second set.
const DEFAULT_ACCOUNTS = [
  { id: 1,  code: '1100', name: 'الصندوق (النقدية)',        type: 'asset',     role: 'cash', cashbox: true, cbType: 'cash' },
  { id: 2,  code: '1200', name: 'البنك',                    type: 'asset',     role: 'bank', cashbox: true, cbType: 'bank' },
  { id: 3,  code: '1300', name: 'العملاء (المدينون)',       type: 'asset',     role: 'ar' },
  { id: 4,  code: '1400', name: 'المخزون',                  type: 'asset',     role: 'inventory' },
  { id: 5,  code: '2100', name: 'الموردون (الدائنون)',      type: 'liability', role: 'ap' },
  { id: 6,  code: '2200', name: 'ضريبة القيمة المضافة',     type: 'liability', role: 'vat' },
  { id: 7,  code: '3100', name: 'رأس المال',                type: 'equity',    role: 'capital' },
  { id: 8,  code: '3200', name: 'الأرباح المحتجزة',         type: 'equity',    role: 'retained' },
  { id: 9,  code: '4100', name: 'إيرادات المبيعات',         type: 'revenue',   role: 'sales' },
  { id: 10, code: '5100', name: 'تكلفة البضاعة المباعة',    type: 'expense',   role: 'cogs' },
  { id: 11, code: '5200', name: 'مصروفات تشغيلية',          type: 'expense',   role: 'expense' },
  { id: 12, code: '5300', name: 'الخصومات الممنوحة',        type: 'expense',   role: 'discount' },
];

export async function ensureChartOfAccounts() {
  if (await db.accounts.count() > 0) return;
  const iso = nowISO();
  for (const a of DEFAULT_ACCOUNTS) {
    // explicit id → the creating hook leaves it; a racing duplicate is ignored
    try { await db.accounts.add({ ...a, parentId: null, isGroup: false, system: true, createdAt: iso }); }
    catch (e) { if (e.name !== 'ConstraintError') throw e; }
  }
}

// Extra system accounts the later modules need (added by role if missing, fixed ids).
const ASSET_ACCOUNTS = [
  { id: 15, code: '1500', name: 'الأصول الثابتة',       type: 'asset',     role: 'fixedAsset' },
  { id: 16, code: '1600', name: 'مجمع إهلاك الأصول',    type: 'liability', role: 'accumDep' },
  { id: 17, code: '5400', name: 'مصروف الإهلاك',        type: 'expense',   role: 'depExpense' },
  { id: 18, code: '5500', name: 'الرواتب والأجور',      type: 'expense',   role: 'salaries' },
];
export async function ensureAssetAccounts() {
  const iso = nowISO();
  for (const a of ASSET_ACCOUNTS) {
    const exists = await db.accounts.where('role').equals(a.role).first();
    if (exists) continue;
    try { await db.accounts.add({ ...a, parentId: null, isGroup: false, system: true, createdAt: iso }); }
    catch (e) { if (e.name !== 'ConstraintError') throw e; }
  }
}

// Core writer — MUST run inside a transaction whose scope includes
// db.journalEntries and db.syncQueue. `accounts` is the pre-read accounts array.
// `lines` = [{ role|accountId, debit, credit }]. Skips silently (returns null)
// if it can't resolve ≥2 lines or the entry doesn't balance — never throws, so a
// business operation is never rolled back just because posting couldn't complete.
async function writeJournalEntry({ date, description, refType, refId, refNumber, branchId, lines, accounts, userId, userName }) {
  const byRole = {};
  for (const a of accounts) if (a.role) byRole[a.role] = a;
  const resolved = [];
  for (const l of (lines || [])) {
    const a = l.accountId ? accounts.find((x) => x.id === l.accountId) : byRole[l.role];
    if (!a) continue;
    const debit = Math.round(Number(l.debit || 0) * 100) / 100;
    const credit = Math.round(Number(l.credit || 0) * 100) / 100;
    if (!debit && !credit) continue;
    resolved.push({ accountId: a.id, code: a.code, name: a.name, debit, credit });
  }
  if (resolved.length < 2) return null;
  const totalDebit = Math.round(resolved.reduce((s, l) => s + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(resolved.reduce((s, l) => s + l.credit, 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    console.warn('[accounting] unbalanced entry skipped', refType, refId, totalDebit, totalCredit);
    return null;
  }
  const dev = deviceBlock();
  const key = 'kerp_jv_seq';
  let cur = 0; try { cur = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
  cur += 1; try { localStorage.setItem(key, String(cur)); } catch { /* ignore */ }
  const number = `JV${dev}-${String(cur).padStart(5, '0')}`;
  const day = date || today();
  const doc = {
    number, date: day, day, description: description || '', refType: refType || 'manual',
    refId: refId ?? null, refNumber: refNumber ?? null, branchId: branchId || DEFAULT_BRANCH_ID,
    lines: resolved, totalDebit, totalCredit, userId: userId || null, userName: userName || null,
    createdAt: nowISO(), status: 'posted',
  };
  const id = await db.journalEntries.add(doc);
  await queueSync('journalEntries', 'add', { ...doc, id });
  return { id, number };
}

// The journal lines an invoice-type document generates (double-entry).
// `inv.total` is the grand total INCLUDING tax; `inv.tax` is the VAT amount, so
// the taxable-goods value (revenue / inventory) is the net = total − tax.
function invoiceJournalLines(inv) {
  const total = Number(inv.total || 0), paid = Number(inv.paid || 0);
  const remaining = Number(inv.remaining || 0), discount = Number(inv.discount || 0);
  const subtotal = Number(inv.subtotal || 0), tax = Number(inv.tax || 0);
  const cogs = Math.round((inv.lines || []).reduce((s, l) => s + Number(l.qty || 0) * Number(l.cost || 0), 0) * 100) / 100;
  const hasParty = !!inv.partyId;
  if (inv.type === 'sale') {
    const lines = [
      { role: 'cash', debit: paid },
      { role: 'ar', debit: remaining },
      { role: 'discount', debit: discount },
      { role: 'sales', credit: subtotal },
      { role: 'vat', credit: tax }, // VAT collected on behalf of the tax authority
    ];
    if (cogs > 0) { lines.push({ role: 'cogs', debit: cogs }, { role: 'inventory', credit: cogs }); }
    return lines;
  }
  if (inv.type === 'purchase') {
    return [
      { role: 'inventory', debit: total - tax }, // goods at net cost
      { role: 'vat', debit: tax },               // recoverable input VAT
      { role: 'cash', credit: paid },
      { role: 'ap', credit: remaining },
    ];
  }
  if (inv.type === 'sale_return') {
    const lines = [
      { role: 'sales', debit: total - tax },
      { role: 'vat', debit: tax },
      { role: hasParty ? 'ar' : 'cash', credit: total },
    ];
    if (cogs > 0) { lines.push({ role: 'inventory', debit: cogs }, { role: 'cogs', credit: cogs }); }
    return lines;
  }
  if (inv.type === 'purchase_return') {
    return [
      { role: hasParty ? 'ap' : 'cash', debit: total },
      { role: 'inventory', credit: total - tax },
      { role: 'vat', credit: tax },
    ];
  }
  return [];
}
const reverseJournalLines = (lines) => lines.map((l) => ({ ...l, debit: l.credit || 0, credit: l.debit || 0 }));

// Public: post a manual (or standalone) journal entry in its own transaction.
export async function postJournal(args) {
  return db.transaction('rw', [db.accounts, db.journalEntries, db.syncQueue], async () => {
    const accounts = await db.accounts.toArray();
    return writeJournalEntry({ ...args, accounts });
  });
}

// ---------- treasury: cashboxes & banks ----------
// A cashbox/bank IS a chart-of-accounts asset account flagged `cashbox: true`,
// so its balance is exactly its ledger balance — one source of truth, no drift.
// Backfill flags on the seeded cash/bank accounts for databases created before this.
export async function ensureCashboxes() {
  const cash = await db.accounts.where('role').equals('cash').first();
  if (cash && !cash.cashbox) await db.accounts.update(cash.id, { cashbox: true, cbType: 'cash' });
  const bank = await db.accounts.where('role').equals('bank').first();
  if (bank && !bank.cashbox) await db.accounts.update(bank.id, { cashbox: true, cbType: 'bank' });
}

function nextAssetCode(accounts) {
  const nums = accounts
    .filter((a) => /^\d+$/.test(a.code)).map((a) => Number(a.code))
    .filter((n) => n >= 1100 && n < 2000);
  return String((nums.length ? Math.max(...nums) : 1400) + 10);
}

// Create a new cashbox/bank (an asset account); an opening balance posts
// Dr cashbox / Cr capital.
export async function createCashbox({ name, cbType = 'cash', openingBalance = 0, branchId, userName }) {
  return db.transaction('rw', [db.accounts, db.journalEntries, db.syncQueue], async () => {
    const accounts = await db.accounts.toArray();
    const code = nextAssetCode(accounts);
    const doc = { code, name: (name || '').trim(), type: 'asset', role: null, cashbox: true, cbType, parentId: null, isGroup: false, system: false, createdAt: nowISO() };
    const id = await db.accounts.add(doc);
    await queueSync('accounts', 'add', { ...doc, id });
    const opening = Number(openingBalance || 0);
    if (opening > 0) {
      const capital = accounts.find((a) => a.role === 'capital');
      await writeJournalEntry({
        date: today(), description: `رصيد افتتاحي — ${doc.name}`, refType: 'opening', refId: id,
        branchId: branchId || DEFAULT_BRANCH_ID,
        lines: [{ accountId: id, debit: opening }, capital && { accountId: capital.id, credit: opening }].filter(Boolean),
        accounts: [...accounts, { ...doc, id }], userName,
      });
    }
    return { id, code };
  });
}

// Cash receipt (Dr cashbox / Cr counter) or payment (Dr counter / Cr cashbox).
export async function postCashMovement({ cashboxId, direction, counterAccountId, amount, description, day, branchId, userName }) {
  const amt = Number(amount || 0);
  if (amt <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  if (!counterAccountId) throw new Error('اختر الحساب المقابل');
  const lines = direction === 'in'
    ? [{ accountId: Number(cashboxId), debit: amt }, { accountId: Number(counterAccountId), credit: amt }]
    : [{ accountId: Number(counterAccountId), debit: amt }, { accountId: Number(cashboxId), credit: amt }];
  return postJournal({
    date: day || today(), description: description || (direction === 'in' ? 'سند قبض' : 'سند صرف'),
    refType: direction === 'in' ? 'receipt' : 'payment', branchId, lines, userName,
  });
}

// Transfer between two cashboxes (Dr destination / Cr source).
export async function postCashTransfer({ fromId, toId, amount, description, day, branchId, userName }) {
  const amt = Number(amount || 0);
  if (amt <= 0) throw new Error('أدخل مبلغاً صحيحاً');
  if (Number(fromId) === Number(toId)) throw new Error('اختر خزينتين مختلفتين');
  return postJournal({
    date: day || today(), description: description || 'تحويل بين الخزائن', refType: 'cash_transfer', branchId,
    lines: [{ accountId: Number(toId), debit: amt }, { accountId: Number(fromId), credit: amt }], userName,
  });
}

// Balance of a single account across a set of journal-entry docs (natural sign
// for the account's type: debit-normal → debits − credits, credit-normal flipped).
export function accountBalance(account, entries) {
  let debit = 0, credit = 0;
  for (const e of entries) {
    for (const l of (e.lines || [])) {
      if (l.accountId === account.id) { debit += Number(l.debit || 0); credit += Number(l.credit || 0); }
    }
  }
  const net = debit - credit;
  return (ACCOUNT_TYPES[account.type]?.normal === 'credit') ? -net : net;
}

// ---------- demo data ----------
export async function loadDemoData() {
  const items = [
    { code: 'SCR-A10', barcode: '6221001001', name: 'شاشة سامسونج A10', brand: 'Samsung', category: 'شاشات', costPrice: 320, salePrice: 420, minStock: 3, stock: 12 },
    { code: 'SCR-IP11', barcode: '6221001002', name: 'شاشة ايفون 11 OLED', brand: 'Apple', category: 'شاشات', costPrice: 950, salePrice: 1250, minStock: 2, stock: 5 },
    { code: 'BAT-OPA54', barcode: '6221001003', name: 'بطارية اوبو A54', brand: 'Oppo', category: 'بطاريات', costPrice: 110, salePrice: 170, minStock: 5, stock: 20 },
    { code: 'BAT-RN10', barcode: '6221001004', name: 'بطارية ريدمي نوت 10', brand: 'Xiaomi', category: 'بطاريات', costPrice: 95, salePrice: 150, minStock: 5, stock: 4 },
    { code: 'FLX-SHN', barcode: '6221001005', name: 'فلاتة شحن سامسونج A12', brand: 'Samsung', category: 'فلات', costPrice: 25, salePrice: 50, minStock: 10, stock: 35 },
    { code: 'GLS-9D', barcode: '6221001006', name: 'اسكرينة 9D حماية', brand: 'عام', category: 'اكسسوارات', costPrice: 8, salePrice: 25, minStock: 20, stock: 150 },
    { code: 'CBL-TYPC', barcode: '6221001007', name: 'كابل Type-C اصلي', brand: 'عام', category: 'اكسسوارات', costPrice: 18, salePrice: 40, minStock: 15, stock: 60 },
    { code: 'TCH-OPA15', barcode: '6221001008', name: 'تاتش اوبو A15', brand: 'Oppo', category: 'شاشات', costPrice: 140, salePrice: 200, minStock: 3, stock: 2 },
  ];
  const customers = [
    { name: 'محل النور للموبايلات', phone: '01001234567', address: 'المنيا - شارع الحسيني', balance: 0 },
    { name: 'عيد ابو سعد', phone: '01112345678', address: 'بني مزار', balance: 0 },
    { name: 'محل الامانة', phone: '01223456789', address: 'مغاغة - السوق', balance: 0 },
  ];
  const suppliers = [
    { name: 'شركة التوحيد لقطع الغيار', phone: '01099887766', balance: 0 },
    { name: 'مكتب الصين للاستيراد', phone: '01155443322', balance: 0 },
  ];
  await db.transaction('rw', [db.items, db.customers, db.suppliers, db.branches], async () => {
    await ensureDefaultBranch();
    for (const it of items) {
      const { stock, ...rest } = it;
      await db.items.add({ ...rest, stocks: { [DEFAULT_BRANCH_ID]: stock }, createdAt: nowISO() });
    }
    for (const c of customers) await db.customers.add({ ...c, createdAt: nowISO() });
    for (const s of suppliers) await db.suppliers.add({ ...s, createdAt: nowISO() });
  });
}

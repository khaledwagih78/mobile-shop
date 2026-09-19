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
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.settings, db.auditLog, db.syncQueue],
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
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.auditLog, db.syncQueue],
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
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.auditLog, db.syncQueue],
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

// ---------- returns (مرتجعات) — reverse of a sale/purchase ----------
export async function saveReturn(inv) {
  return db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.auditLog, db.syncQueue],
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
      await queueSync('invoices', 'add', { ...doc, id });
      return { id, number };
    }
  );
}

// Record a payment from customer (in) or to supplier (out)
export async function recordPayment({ partyType, partyId, partyName, amount, note, userName, branchId }) {
  return db.transaction('rw', [db.payments, db.customers, db.suppliers, db.syncQueue], async () => {
    const createdAt = nowISO();
    const doc = { partyType, partyId, partyName, amount, note, userName, branchId: branchId || DEFAULT_BRANCH_ID, createdAt, day: dayOf(createdAt) };
    const id = await db.payments.add(doc);
    if (partyType === 'customer') {
      const c = await db.customers.get(partyId);
      if (c) await db.customers.update(partyId, { balance: (c.balance || 0) - amount });
    } else {
      const s = await db.suppliers.get(partyId);
      if (s) await db.suppliers.update(partyId, { balance: (s.balance || 0) - amount });
    }
    await queueSync('payments', 'add', { ...doc, id });
    return id;
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

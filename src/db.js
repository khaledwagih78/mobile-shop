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

// ---------- helpers ----------
export const nowISO = () => new Date().toISOString();
export const dayOf = (iso) => (iso || nowISO()).slice(0, 10); // YYYY-MM-DD
export const today = () => dayOf(nowISO());

export async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// queue every write for future cloud sync (Supabase - phase 2)
export async function queueSync(table, op, payload) {
  await db.syncQueue.add({ table, op, payload, synced: 0, createdAt: nowISO() });
}

// sequential invoice numbers: S-00001 / P-00001
export async function nextInvoiceNumber(type) {
  const key = type === 'sale' ? 'seq_sale' : 'seq_purchase';
  const cur = (await getSetting(key, 0)) + 1;
  await setSetting(key, cur);
  const prefix = type === 'sale' ? 'S' : 'P';
  return `${prefix}-${String(cur).padStart(5, '0')}`;
}

// ---------- first run: seed admin user ----------
export async function ensureSeed() {
  const count = await db.users.count();
  if (count === 0) {
    await db.users.add({
      name: 'المدير',
      pin: '1234',
      role: 'admin',
      createdAt: nowISO(),
    });
  }
}

// ---------- core business operations (transactional) ----------

// Save a sale or purchase invoice and update stock / balances atomically
export async function saveInvoice(inv) {
  return db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.settings, db.syncQueue],
    async () => {
      const number = await nextInvoiceNumber(inv.type);
      const createdAt = nowISO();
      const doc = { ...inv, number, createdAt, day: dayOf(createdAt), status: 'active' };
      const id = await db.invoices.add(doc);

      for (const line of inv.lines) {
        const item = await db.items.get(line.itemId);
        if (!item) continue;
        if (inv.type === 'sale') {
          await db.items.update(line.itemId, { stock: (item.stock || 0) - line.qty });
        } else {
          // purchase: increase stock and update cost price (last purchase cost)
          await db.items.update(line.itemId, {
            stock: (item.stock || 0) + line.qty,
            costPrice: line.price,
          });
        }
        await db.stockMoves.add({
          itemId: line.itemId,
          itemName: line.name,
          qty: line.qty,
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

      await queueSync('invoices', 'add', { ...doc, id });
      return { id, number };
    }
  );
}

// Cancel an invoice: reverse stock and balances (admin only - enforced in UI)
export async function cancelInvoice(invoiceId, userName) {
  return db.transaction(
    'rw',
    [db.invoices, db.items, db.customers, db.suppliers, db.stockMoves, db.syncQueue],
    async () => {
      const inv = await db.invoices.get(invoiceId);
      if (!inv || inv.status === 'cancelled') return;
      for (const line of inv.lines) {
        const item = await db.items.get(line.itemId);
        if (!item) continue;
        const delta = inv.type === 'sale' ? line.qty : -line.qty;
        await db.items.update(line.itemId, { stock: (item.stock || 0) + delta });
        await db.stockMoves.add({
          itemId: line.itemId,
          itemName: line.name,
          qty: line.qty,
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
      await queueSync('invoices', 'cancel', { id: invoiceId });
    }
  );
}

// Record a payment from customer (in) or to supplier (out)
export async function recordPayment({ partyType, partyId, partyName, amount, note, userName }) {
  return db.transaction('rw', [db.payments, db.customers, db.suppliers, db.syncQueue], async () => {
    const createdAt = nowISO();
    const doc = { partyType, partyId, partyName, amount, note, userName, createdAt, day: dayOf(createdAt) };
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
  await db.transaction('rw', [db.items, db.customers, db.suppliers], async () => {
    for (const it of items) await db.items.add({ ...it, createdAt: nowISO() });
    for (const c of customers) await db.customers.add({ ...c, createdAt: nowISO() });
    for (const s of suppliers) await db.suppliers.add({ ...s, createdAt: nowISO() });
  });
}

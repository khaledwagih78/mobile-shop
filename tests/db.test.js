import { beforeEach, describe, it, expect } from 'vitest';
import {
  db, ensureChartOfAccounts, saveInvoice, recordPayment, cancelInvoice,
  setPartyOpening, computeDayCash, stockOf, today,
} from '../src/db.js';

// Fresh state before each test (db is a module singleton on in-memory IndexedDB).
async function reset() {
  await Promise.all(db.tables.map((t) => t.clear()));
  try { localStorage.clear(); } catch { /* ignore */ }
}

const journalsBalance = async () => {
  const entries = await db.journalEntries.toArray();
  for (const e of entries) {
    const dr = (e.lines || []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = (e.lines || []).reduce((s, l) => s + (Number(l.credit) || 0), 0);
    expect(Math.round((dr - cr) * 100) / 100).toBe(0);
  }
  return entries;
};

const addItem = (over = {}) => db.items.add({ name: 'شاشة', costPrice: 100, salePrice: 150, stocks: { 1: 10 }, taxable: true, createdAt: today(), ...over });
const addCustomer = (over = {}) => db.customers.add({ name: 'أحمد', balance: 0, points: 0, createdAt: today(), ...over });

const saleOf = (itemId, partyId, over = {}) => saveInvoice({
  type: 'sale', branchId: 1, partyId, partyName: 'أحمد',
  lines: [{ itemId, name: 'شاشة', qty: 2, price: 150, cost: 100, factor: 1, unit: 'قطعة', taxable: true }],
  subtotal: 300, discount: 0, tax: 0, total: 300, paid: 100, remaining: 200, profit: 100,
  userName: 'ت', ...over,
});

beforeEach(async () => { await reset(); await ensureChartOfAccounts(); });

describe('saveInvoice (sale)', () => {
  it('reduces stock, adds credit balance, awards points, posts a balanced entry', async () => {
    const itemId = await addItem();
    const custId = await addCustomer();
    await saleOf(itemId, custId);

    expect(stockOf(await db.items.get(itemId), 1)).toBe(8); // 10 − 2
    const cust = await db.customers.get(custId);
    expect(cust.balance).toBe(200);     // remaining
    expect(cust.points).toBe(3);        // floor(300/100)
    await journalsBalance();
  });

  it('nets loyalty points when redeeming (earned − redeemed)', async () => {
    const itemId = await addItem();
    const custId = await addCustomer({ points: 10 });
    await saleOf(itemId, custId, { pointsRedeemed: 5, pointsValue: 5 });
    expect((await db.customers.get(custId)).points).toBe(8); // 10 + 3 − 5
  });
});

describe('cancelInvoice', () => {
  it('reverses stock, balance and points', async () => {
    const itemId = await addItem();
    const custId = await addCustomer();
    const res = await saleOf(itemId, custId);
    await cancelInvoice(res.id, 'ت');

    expect(stockOf(await db.items.get(itemId), 1)).toBe(10); // restored
    const cust = await db.customers.get(custId);
    expect(cust.balance).toBe(0);  // credit reversed
    expect(cust.points).toBe(0);   // awarded points removed
    expect((await db.invoices.get(res.id)).status).toBe('cancelled');
  });
});

describe('recordPayment', () => {
  it('reduces the customer balance', async () => {
    const custId = await addCustomer({ balance: 200 });
    await recordPayment({ partyType: 'customer', partyId: custId, partyName: 'أحمد', amount: 50, userName: 'ت', branchId: 1 });
    expect((await db.customers.get(custId)).balance).toBe(150);
  });
});

describe('setPartyOpening', () => {
  it('is idempotent and editable (posts only the delta)', async () => {
    const custId = await addCustomer();
    await setPartyOpening({ partyType: 'customer', partyId: custId, amount: 500, userName: 'ت' });
    expect((await db.customers.get(custId)).balance).toBe(500);

    await setPartyOpening({ partyType: 'customer', partyId: custId, amount: 500, userName: 'ت' });
    expect((await db.customers.get(custId)).balance).toBe(500); // no double-count

    await setPartyOpening({ partyType: 'customer', partyId: custId, amount: 300, userName: 'ت' });
    expect((await db.customers.get(custId)).balance).toBe(300); // delta −200

    await journalsBalance();
  });
});

describe('computeDayCash', () => {
  it('counts a fully-paid cash sale as drawer cash-in', async () => {
    const itemId = await addItem();
    await saleOf(itemId, null, { partyName: null, paid: 300, remaining: 0 });
    const c = await computeDayCash(today(), 1);
    expect(c.salesCash).toBe(300);
    expect(c.cashIn).toBe(300);
    expect(c.expected).toBe(300); // opening 0 + 300 in − 0 out
  });
});

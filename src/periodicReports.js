import { db, getSetting, setSetting, today, dayOf, DEFAULT_BRANCH_ID } from './db';
import { notifyEvent } from './notify';
import { money, fmt } from './utils';

const daysAgoStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Compute a sales/purchases/profit report for a period ('daily'|'weekly'|'monthly').
export async function buildPeriodReport(period) {
  const to = today();
  const from = period === 'daily' ? to : period === 'weekly' ? daysAgoStr(6) : to.slice(0, 7) + '-01';
  const label = period === 'daily' ? 'اليومي' : period === 'weekly' ? 'الأسبوعي' : 'الشهري';

  const [invoices, expenses, bizName] = await Promise.all([
    db.invoices.toArray(),
    db.expenses.toArray(),
    getSetting('bizName', 'النشاط'),
  ]);
  const inRange = (d) => d >= from && d <= to;
  const sales = invoices.filter((i) => i.type === 'sale' && i.status === 'active' && inRange(i.day || ''));
  const purchases = invoices.filter((i) => i.type === 'purchase' && i.status === 'active' && inRange(i.day || ''));
  const salesTotal = sales.reduce((s, i) => s + (i.total || 0), 0);
  const purchasesTotal = purchases.reduce((s, i) => s + (i.total || 0), 0);
  const profit = sales.reduce((s, i) => s + (i.profit || 0), 0);
  const expTotal = expenses.filter((e) => inRange(e.day || '')).reduce((s, e) => s + (e.amount || 0), 0);
  const net = profit - expTotal;
  const collected = sales.reduce((s, i) => s + (i.paid || 0), 0);
  const credit = sales.reduce((s, i) => s + (i.remaining || 0), 0);

  const title = `📊 التقرير ${label} — ${bizName}`;
  const body =
    `التقرير ${label} (${from} إلى ${to})\n` +
    `------------------------------\n` +
    `عدد فواتير البيع: ${fmt(sales.length)}\n` +
    `إجمالي المبيعات: ${money(salesTotal)}\n` +
    `المحصّل نقداً: ${money(collected)}\n` +
    `مبيعات آجلة: ${money(credit)}\n` +
    `إجمالي المشتريات: ${money(purchasesTotal)}\n` +
    `المصروفات: ${money(expTotal)}\n` +
    `مجمل الربح: ${money(profit)}\n` +
    `------------------------------\n` +
    `صافي الربح بعد المصروفات: ${money(net)}\n`;
  return { title, body, from, to };
}

async function sendAndMark(period, lastSent) {
  const { title, body } = await buildPeriodReport(period);
  await notifyEvent({ action: 'report', title, body });
  const next = { ...lastSent };
  next[period] = period === 'monthly' ? today().slice(0, 7) : today();
  await setSetting('reportLastSent', next);
}

// Send a period report immediately (manual button).
export async function sendReportNow(period) {
  const lastSent = (await getSetting('reportLastSent', {})) || {};
  await sendAndMark(period, lastSent);
}

// Called on app start / interval: sends any enabled+due periodic reports.
export async function maybeSendPeriodicReports() {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const to = await getSetting('emailTo', '');
    if (!to) return; // email not configured
    const [daily, weekly, monthly, lastSentRaw] = await Promise.all([
      getSetting('reportDaily', false), getSetting('reportWeekly', false),
      getSetting('reportMonthly', false), getSetting('reportLastSent', {}),
    ]);
    const lastSent = lastSentRaw || {};
    const t = today();
    const jobs = [];
    if (daily === true && lastSent.daily !== t) jobs.push('daily');
    if (weekly === true) {
      const last = lastSent.weekly;
      if (!last || (new Date(t) - new Date(last)) / 86400000 >= 7) jobs.push('weekly');
    }
    if (monthly === true && lastSent.monthly !== t.slice(0, 7)) jobs.push('monthly');
    let cur = lastSent;
    for (const p of jobs) {
      await sendAndMark(p, cur);
      cur = (await getSetting('reportLastSent', {})) || cur;
    }
  } catch { /* best-effort */ }
}

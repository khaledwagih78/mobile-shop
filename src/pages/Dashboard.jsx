import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, getSetting, stockOf, computeDayCash } from '../db';
import { money, fmt, fmtDate, fmtDay, monthOf, can, waLink } from '../utils';
import { getSector } from '../sectors';
import { useAuth } from '../auth';
import { useState } from 'react';

export default function Dashboard() {
  const nav = useNavigate();
  const { user, activeBranch } = useAuth();
  const day = today();
  const inBranch = (r) => (r.branchId || 1) === activeBranch;

  const todaySales = useLiveQuery(
    () => db.invoices.where('day').equals(day).and((i) => i.type === 'sale' && i.status === 'active' && (i.branchId || 1) === activeBranch).toArray(),
    [day, activeBranch], []
  );
  const customersCount = useLiveQuery(() => db.customers.count(), [], 0);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const recent = useLiveQuery(
    () => db.invoices.orderBy('createdAt').reverse().filter((i) => (i.branchId || 1) === activeBranch).limit(8).toArray(),
    [activeBranch], []
  );
  const todayExpenses = useLiveQuery(() => db.expenses.where('day').equals(day).and((e) => (e.branchId || 1) === activeBranch).toArray(), [day, activeBranch], []);
  const debts = useLiveQuery(() => db.customers.filter((c) => (c.balance || 0) > 0).toArray(), [], []);
  const usdRate = useLiveQuery(() => getSetting('usdRate', 0), [], 0);

  // backup reminder: warn if never backed up or overdue
  const lastBackupAt = useLiveQuery(() => getSetting('lastBackupAt', null), [], undefined);
  const backupDays = useLiveQuery(() => getSetting('backupReminderDays', 7), [], 7);
  const backupOverdue = lastBackupAt !== undefined && (
    !lastBackupAt || (Date.now() - new Date(lastBackupAt).getTime()) > (Number(backupDays) || 7) * 86400000
  );

  // ---- sector-aware KPIs ----
  const sectorId = useLiveQuery(() => getSetting('bizSector', 'general'), [], 'general');
  const sector = getSector(sectorId);
  const nearExpiryDays = useLiveQuery(() => getSetting('nearExpiryDays', 60), [], 60);
  const woOpen = useLiveQuery(() => db.workOrders.filter((w) => inBranch(w) && w.status !== 'delivered' && w.status !== 'cancelled').count(), [activeBranch], 0);
  const projOpen = useLiveQuery(() => db.projects.filter((p) => inBranch(p) && p.status !== 'done' && p.status !== 'closed').count(), [activeBranch], 0);
  const prodMonth = useLiveQuery(() => db.productions.filter((p) => inBranch(p) && (p.day || p.createdAt || '').slice(0, 7) === monthOf(day)).count(), [activeBranch, day], 0);
  const instActive = useLiveQuery(() => db.installmentPlans.filter((p) => p.status === 'active').count(), [], 0);
  const repsMonth = useLiveQuery(() => db.repVisits.filter((v) => (v.day || '').slice(0, 7) === monthOf(day)).count(), [day], 0);
  const leadsOpen = useLiveQuery(() => db.leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').count(), [], 0);
  const nearExp = items.filter((it) => { if (!it.expiry) return false; const d = Math.floor((new Date(it.expiry) - new Date(day)) / 86400000); return d >= 0 && d <= (Number(nearExpiryDays) || 60); }).length;
  const expired = items.filter((it) => it.expiry && it.expiry < day).length;

  const hasMod = (k) => sector.allMods || (sector.mods || []).includes(k);
  const sectorCards = [
    { k: 'repair', show: hasMod('repair') && (!sector.allMods || woOpen > 0), ico: '🔧', label: 'أوامر صيانة مفتوحة', value: fmt(woOpen), to: '/maintenance', tone: 'kpi tone-accent' },
    { k: 'projects', show: hasMod('projects') && (!sector.allMods || projOpen > 0), ico: '📁', label: 'مشاريع جارية', value: fmt(projOpen), to: '/projects', tone: 'kpi' },
    { k: 'production', show: hasMod('production') && (!sector.allMods || prodMonth > 0), ico: '🏭', label: 'إنتاج هذا الشهر', value: fmt(prodMonth), to: '/production', tone: 'kpi' },
    { k: 'installments', show: hasMod('installments') && (!sector.allMods || instActive > 0), ico: '💳', label: 'خطط أقساط نشطة', value: fmt(instActive), to: '/installments', tone: 'kpi' },
    { k: 'reps', show: hasMod('reps') && (!sector.allMods || repsMonth > 0), ico: '🚶', label: 'زيارات مندوبين (الشهر)', value: fmt(repsMonth), to: '/reps', tone: 'kpi' },
    { k: 'crm', show: hasMod('crm') && (!sector.allMods || leadsOpen > 0), ico: '🤝', label: 'عملاء محتملون مفتوحون', value: fmt(leadsOpen), to: '/crm', tone: 'kpi' },
    { k: 'expiry', show: (sectorId === 'pharmacy' || nearExp > 0 || expired > 0) && (nearExp > 0 || expired > 0), ico: '📅', label: expired > 0 ? `قرب/انتهاء صلاحية (${expired} منتهي)` : 'أصناف قرب الصلاحية', value: fmt(nearExp + expired), to: '/inventory-ops', tone: 'kpi tone-amber' },
  ].filter((c) => c.show);

  const salesTotal = todaySales.reduce((s, i) => s + i.total, 0);
  const profitTotal = todaySales.reduce((s, i) => s + (i.profit || 0), 0);
  const expTotal = todayExpenses.reduce((s, e) => s + e.amount, 0);
  const stockValue = items.reduce((s, it) => s + stockOf(it, activeBranch) * (it.costPrice || 0), 0);
  const lowStock = items.filter((it) => stockOf(it, activeBranch) <= (it.minStock || 0));
  const debtsTotal = debts.reduce((s, c) => s + c.balance, 0);

  const bizName = useLiveQuery(() => getSetting('bizName', ''), [], '');
  // compose and share today's summary to WhatsApp (owner picks the recipient)
  const shareDaySummary = async () => {
    let cashLine = '';
    try {
      const c = await computeDayCash(day, activeBranch);
      cashLine = `\n💵 كاش الدرج المتوقع: ${money(c.expected)}`;
    } catch { /* ignore */ }
    // top-selling item today (by base qty)
    const qty = {};
    for (const inv of todaySales) for (const l of (inv.lines || [])) {
      if (l.itemId == null) continue;
      qty[l.name] = (qty[l.name] || 0) + (Number(l.qty) || 0) * (Number(l.factor) || 1);
    }
    const top = Object.entries(qty).sort((a, b) => b[1] - a[1])[0];
    const lines = [
      `📊 ملخص يوم ${fmtDay(day)}`,
      bizName ? `🏪 ${bizName}` : '',
      `———————————`,
      `🧾 مبيعات: ${money(salesTotal)} (${todaySales.length} فاتورة)`,
      `📈 أرباح اليوم: ${money(profitTotal - expTotal)}`,
      `💸 مصروفات: ${money(expTotal)}`,
      top ? `🏆 الأكثر مبيعاً: ${top[0]} (${fmt(top[1])})` : '',
      cashLine.trim(),
      `👥 إجمالي ديون العملاء: ${money(debtsTotal)}`,
      lowStock.length ? `⚠️ أصناف قاربت على النفاد: ${lowStock.length}` : '',
    ].filter(Boolean);
    window.open(waLink('', lines.join('\n')), '_blank');
  };

  // customizable dashboard: per-device hidden KPI widgets
  const [customize, setCustomize] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem('kerp_dash_hidden') || '[]'); } catch { return []; } });
  const toggleWidget = (k) => setHidden((h) => {
    const next = h.includes(k) ? h.filter((x) => x !== k) : [...h, k];
    try { localStorage.setItem('kerp_dash_hidden', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const KPIS = [
    { key: 'sales', cls: 'kpi', label: 'مبيعات اليوم', content: <><div className="label">مبيعات اليوم</div><div className="value">{money(salesTotal)}</div><div className="sub">{todaySales.length} فاتورة</div></> },
    { key: 'profit', cls: 'kpi tone-green', label: 'أرباح اليوم', content: <><div className="label">أرباح اليوم</div><div className="value">{money(profitTotal - expTotal)}</div><div className="sub">بعد خصم مصروفات {money(expTotal)}</div></> },
    { key: 'customers', cls: 'kpi', label: 'العملاء', content: <><div className="label">العملاء</div><div className="value">{fmt(customersCount)}</div><div className="sub">ديون آجلة: {money(debtsTotal)}</div></> },
    { key: 'stock', cls: 'kpi', label: 'قيمة المخزون', content: <><div className="label">قيمة المخزون</div><div className="value">{money(stockValue)}</div><div className="sub">{items.length} صنف</div></> },
    ...(Number(usdRate) > 0 ? [{ key: 'usd', cls: 'kpi tone-accent', label: 'سعر الدولار', content: <><div className="label">💵 سعر الدولار</div><div className="value">{fmt(usdRate)}</div><div className="sub">يُعدّل من الإعدادات</div></> }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <h1>الرئيسية</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {can(user.role, 'reports') && (
            <button className="btn ghost" onClick={shareDaySummary} title="إرسال ملخص اليوم على واتساب">📱 ملخص اليوم</button>
          )}
          <button className="btn ghost" onClick={() => setCustomize((v) => !v)} title="تخصيص المؤشرات">⚙️</button>
          {can(user.role, 'pos') && (
            <button className="btn accent big" onClick={() => nav('/pos')}>＋ بيع جديد</button>
          )}
        </div>
      </div>

      {backupOverdue && can(user.role, 'backup') && (
        <div className="card" style={{ borderColor: 'var(--red)', background: 'rgba(220,40,30,0.06)', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--red)' }}>
            <b>🛡️ احمِ بياناتك!</b>{' '}
            {lastBackupAt
              ? `آخر نسخة احتياطية من ${fmtDate(lastBackupAt)} — يُفضّل تعمل نسخة جديدة.`
              : 'لم تقم بأي نسخة احتياطية بعد. بيانات المحل كلها على هذا الجهاز فقط.'}
          </div>
          <Link to="/backup" className="btn accent">نسخة احتياطية الآن</Link>
        </div>
      )}

      {(() => {
        const acts = [
          { to: '/pos', ico: '🧾', label: 'بيع', action: 'pos' },
          { to: '/purchase', ico: '🛒', label: 'شراء', action: 'purchase' },
          { to: '/customers', ico: '💵', label: 'تحصيل', action: 'customers' },
          { to: '/expenses', ico: '💸', label: 'مصروف', action: 'expenses' },
          { to: '/items', ico: '📦', label: 'صنف جديد', action: 'items' },
          { to: '/cash-close', ico: '🧮', label: 'تقفيل اليومية', action: 'cashclose' },
        ].filter((a) => can(user.role, a.action));
        if (!acts.length) return null;
        return (
          <div className="quick-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {acts.map((a) => (
              <Link key={a.to} to={a.to} className="btn ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18 }}>{a.ico}</span> {a.label}
              </Link>
            ))}
          </div>
        );
      })()}

      {customize && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>تخصيص مؤشرات الرئيسية</b>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
            {KPIS.map((k) => (
              <label key={k.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={!hidden.includes(k.key)} onChange={() => toggleWidget(k.key)} /> {k.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="kpis">
        {KPIS.filter((k) => !hidden.includes(k.key)).map((k) => (
          <div className={k.cls} key={k.key}>{k.content}</div>
        ))}
      </div>

      {sectorCards.length > 0 && (
        <>
          <div className="section-title">مؤشرات {sector.name || 'المجال'}</div>
          <div className="kpis">
            {sectorCards.map((c) => (
              <Link key={c.k} to={c.to} className={c.cls || c.tone} style={{ textDecoration: 'none' }}>
                <div className="label">{c.ico} {c.label}</div>
                <div className="value">{c.value}</div>
                <div className="sub">اضغط للتفاصيل</div>
              </Link>
            ))}
          </div>
        </>
      )}

      {lowStock.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--amber)', marginBottom: 16 }}>
          <b style={{ color: 'var(--amber)' }}>⚠️ أصناف قاربت على النفاد ({lowStock.length})</b>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {lowStock.slice(0, 10).map((it) => (
              <Link key={it.id} to="/items" className="badge amber">
                {it.name} — متبقي {fmt(stockOf(it, activeBranch))}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">آخر الفواتير</div>
      {recent.length === 0 ? (
        <div className="card empty">
          <div className="big-ico">🧾</div>
          <p>لا توجد فواتير بعد. ابدأ بأول عملية بيع!</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>رقم</th><th>النوع</th><th>الطرف</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {recent.map((inv) => (
                <tr key={inv.id} className="clickable" onClick={() => nav(`/invoices/${inv.id}`)}>
                  <td className="num">{inv.number}</td>
                  <td>{inv.type === 'sale' ? <span className="badge primary">بيع</span> : <span className="badge gray">شراء</span>}</td>
                  <td>{inv.partyName || 'نقدي'}</td>
                  <td className="num">{money(inv.total)}</td>
                  <td>{inv.status === 'cancelled' ? <span className="badge red">ملغاة</span> : inv.remaining > 0 ? <span className="badge amber">آجل {money(inv.remaining)}</span> : <span className="badge green">مدفوعة</span>}</td>
                  <td className="muted">{fmtDate(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

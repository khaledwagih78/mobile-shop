import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, getSetting, stockOf, computeDayCash } from '../db';
import { money, fmt, fmtDate, fmtDay, monthOf, can, waLink } from '../utils';
import { getSector } from '../sectors';
import { useAuth } from '../auth';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/UI';
import {
  Receipt,
  Plus,
  Share2,
  SlidersHorizontal,
  ShieldAlert,
  ShoppingBag,
  HandCoins,
  Wallet,
  Boxes,
  Calculator,
  AlertTriangle,
  DollarSign,
  ReceiptText,
  Sparkles,
  Copy,
  Check,
  Send,
  FileText,
} from 'lucide-react';

export default function Dashboard() {
  const nav = useNavigate();
  const { user, activeBranch } = useAuth();
  const day = today();
  const inBranch = (r) => (r.branchId || 1) === activeBranch;

  const todaySales = useLiveQuery(
    () => db.invoices.where('day').equals(day).and((i) => i.type ==='sale' && i.status ==='active' && (i.branchId || 1) === activeBranch).toArray(),
    [day, activeBranch], []
  );
  const customersCount = useLiveQuery(() => db.customers.count(), [], 0);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const recent = useLiveQuery(
    () => db.invoices.orderBy('createdAt').reverse().filter((i) => (i.branchId || 1) === activeBranch).limit(8).toArray(),
    [activeBranch], []
  );
  const todayExpenses = useLiveQuery(() => db.expenses.where('day').equals(day).and((e) => (e.branchId || 1) === activeBranch).toArray(), [day, activeBranch], []);
  const payslipsAll = useLiveQuery(() => db.payslips.toArray(), [], []);
  const debts = useLiveQuery(() => db.customers.filter((c) => (c.balance || 0) > 0).toArray(), [], []);
  const usdRate = useLiveQuery(() => getSetting('usdRate', 0), [], 0);

  // backup reminder: warn if never backed up or overdue
  const lastBackupAt = useLiveQuery(() => getSetting('lastBackupAt', null), [], undefined);
  const backupDays = useLiveQuery(() => getSetting('backupReminderDays', 7), [], 7);
  const backupOverdue = lastBackupAt !== undefined && (
    !lastBackupAt || (Date.now() - new Date(lastBackupAt).getTime()) > (Number(backupDays) || 7) * 86400000
  );

  // ---- sector-aware KPIs ----
  const sectorId = useLiveQuery(() => getSetting('bizSector','general'), [],'general');
  const sector = getSector(sectorId);
  const nearExpiryDays = useLiveQuery(() => getSetting('nearExpiryDays', 60), [], 60);
  const woOpen = useLiveQuery(() => db.workOrders.filter((w) => inBranch(w) && w.status !=='delivered' && w.status !=='cancelled').count(), [activeBranch], 0);
  const projOpen = useLiveQuery(() => db.projects.filter((p) => inBranch(p) && p.status !=='done' && p.status !=='closed').count(), [activeBranch], 0);
  const prodMonth = useLiveQuery(() => db.productions.filter((p) => inBranch(p) && (p.day || p.createdAt ||'').slice(0, 7) === monthOf(day)).count(), [activeBranch, day], 0);
  const instActive = useLiveQuery(() => db.installmentPlans.filter((p) => p.status ==='active').count(), [], 0);
  const repsMonth = useLiveQuery(() => db.repVisits.filter((v) => (v.day ||'').slice(0, 7) === monthOf(day)).count(), [day], 0);
  const leadsOpen = useLiveQuery(() => db.leads.filter((l) => l.stage !=='won' && l.stage !=='lost').count(), [], 0);
  const nearExp = items.filter((it) => { if (!it.expiry) return false; const d = Math.floor((new Date(it.expiry) - new Date(day)) / 86400000); return d >= 0 && d <= (Number(nearExpiryDays) || 60); }).length;
  const expired = items.filter((it) => it.expiry && it.expiry < day).length;

  const hasMod = (k) => sector.allMods || (sector.mods || []).includes(k);
  const sectorCards = [
    { k:'repair', show: hasMod('repair') && (!sector.allMods || woOpen > 0), icon:'Wrench', label:'أوامر صيانة مفتوحة', value: fmt(woOpen), to:'/maintenance', tone:'kpi tone-accent' },
    { k:'projects', show: hasMod('projects') && (!sector.allMods || projOpen > 0), icon:'FolderKanban', label:'مشاريع جارية', value: fmt(projOpen), to:'/projects', tone:'kpi' },
    { k:'production', show: hasMod('production') && (!sector.allMods || prodMonth > 0), icon:'Factory', label:'إنتاج هذا الشهر', value: fmt(prodMonth), to:'/production', tone:'kpi' },
    { k:'installments', show: hasMod('installments') && (!sector.allMods || instActive > 0), icon:'CreditCard', label:'خطط أقساط نشطة', value: fmt(instActive), to:'/installments', tone:'kpi' },
    { k:'reps', show: hasMod('reps') && (!sector.allMods || repsMonth > 0), icon:'Footprints', label:'زيارات مندوبين (الشهر)', value: fmt(repsMonth), to:'/reps', tone:'kpi' },
    { k:'crm', show: hasMod('crm') && (!sector.allMods || leadsOpen > 0), icon:'Handshake', label:'عملاء محتملون مفتوحون', value: fmt(leadsOpen), to:'/crm', tone:'kpi' },
    { k:'expiry', show: (sectorId ==='pharmacy' || nearExp > 0 || expired > 0) && (nearExp > 0 || expired > 0), icon:'CalendarClock', label: expired > 0 ?`قرب/انتهاء صلاحية (${expired} منتهي)` :'أصناف قرب الصلاحية', value: fmt(nearExp + expired), to:'/inventory-ops', tone:'kpi tone-amber' },
  ].filter((c) => c.show);

  const salesTotal = todaySales.reduce((s, i) => s + i.total, 0);
  const profitTotal = todaySales.reduce((s, i) => s + (i.profit || 0), 0);
  // المرتبات المصروفة اليوم تُحتسب ضمن مصروفات اليوم
  const todaySalaries = payslipsAll.filter((p) => (p.day || p.createdAt?.slice(0, 10)) === day && (p.branchId || 1) === activeBranch).reduce((s, p) => s + (Number(p.net) || 0), 0);
  const expTotal = todayExpenses.reduce((s, e) => s + e.amount, 0) + todaySalaries;
  const stockValue = items.reduce((s, it) => s + stockOf(it, activeBranch) * (it.costPrice || 0), 0);
  const lowStock = items.filter((it) => stockOf(it, activeBranch) <= (it.minStock || 0));
  const debtsTotal = debts.reduce((s, c) => s + c.balance, 0);

  const bizName = useLiveQuery(() => getSetting('bizName',''), [],'');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [cashExpected, setCashExpected] = useState(null);
  const [copied, setCopied] = useState(false);

  // top-selling item today (by base qty)
  const todayTopItem = () => {
    const qty = {};
    for (const inv of todaySales) for (const l of (inv.lines || [])) {
      if (l.itemId == null) continue;
      qty[l.name] = (qty[l.name] || 0) + (Number(l.qty) || 0) * (Number(l.factor) || 1);
    }
    return Object.entries(qty).sort((a, b) => b[1] - a[1])[0];
  };

  const getSummaryText = (cash) => {
    const top = todayTopItem();
    const netProfit = profitTotal - expTotal;
    const lines = [
      `ملخص إقفال يوم ${fmtDay(day)}`,
      bizName ? `${bizName}` : '',
      `———————————`,
      `مبيعات اليوم: ${money(salesTotal)} (${todaySales.length} فاتورة)`,
      `أرباح اليوم: ${money(netProfit)}`,
      `مصروفات اليوم: ${money(expTotal)}`,
      top ? `الأكثر مبيعاً: ${top[0]} (${fmt(top[1])})` : '',
      cash != null ? `كاش الدرج المتوقع: ${money(cash)}` : '',
      `إجمالي ديون العملاء: ${money(debtsTotal)}`,
      lowStock.length ? `أصناف قاربت على النفاد: ${lowStock.length}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  };

  const openSummaryModal = async () => {
    setSummaryOpen(true);
    setCopied(false);
    try {
      const c = await computeDayCash(day, activeBranch);
      setCashExpected(c.expected);
    } catch {
      setCashExpected(0);
    }
  };

  const shareToWhatsApp = () => {
    const text = getSummaryText(cashExpected);
    window.open(waLink('', text), '_blank');
  };

  const copySummaryText = async () => {
    try {
      await navigator.clipboard.writeText(getSummaryText(cashExpected));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  // customizable dashboard: per-device hidden KPI widgets
  const [customize, setCustomize] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem('kerp_dash_hidden') ||'[]'); } catch { return []; } });
  const toggleWidget = (k) => setHidden((h) => {
    const next = h.includes(k) ? h.filter((x) => x !== k) : [...h, k];
    try { localStorage.setItem('kerp_dash_hidden', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  const KPIS = [
    { key:'sales', cls:'kpi', label:'مبيعات اليوم', content: <><div className="label">مبيعات اليوم</div><div className="value num">{money(salesTotal)}</div><div className="sub">{todaySales.length} فاتورة</div></> },
    { key:'profit', cls:'kpi tone-green', label:'أرباح اليوم', content: <><div className="label">أرباح اليوم</div><div className="value num">{money(profitTotal - expTotal)}</div><div className="sub">بعد خصم مصروفات {money(expTotal)}</div></> },
    { key:'customers', cls:'kpi', label:'العملاء', content: <><div className="label">العملاء</div><div className="value num">{fmt(customersCount)}</div><div className="sub">ديون آجلة: {money(debtsTotal)}</div></> },
    { key:'stock', cls:'kpi', label:'قيمة المخزون', content: <><div className="label">قيمة المخزون</div><div className="value num">{money(stockValue)}</div><div className="sub">{items.length} صنف</div></> },
    ...(Number(usdRate) > 0 ? [{ key:'usd', cls:'kpi tone-accent', label:'سعر الدولار', content: <><div className="label" style={{ display:'flex', alignItems:'center', gap: 4 }}><DollarSign size={13} /> سعر الدولار</div><div className="value num">{fmt(usdRate)}</div><div className="sub">يُعدّل من الإعدادات</div></> }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <h1>الرئيسية</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can(user.role, 'reports') && (
            <button className="btn ghost" onClick={openSummaryModal} title="معاينة وإرسال ملخص إقفال اليوم">
              <FileText size={15} /> ملخص اليومية
            </button>
          )}
          {can(user.role, 'insights') && (
            <button
              className="btn ghost"
              onClick={() => nav('/insights')}
              title="المستشار الذكي وروبوت الدردشة لتحليل نشاط المتجر"
              style={{ borderColor: 'var(--primary)', color: 'var(--primary)', fontWeight: 600 }}
            >
              <Sparkles size={15} /> المستشار الذكي (AI)
            </button>
          )}
          <button className="btn ghost" onClick={() => setCustomize((v) => !v)} title="تخصيص المؤشرات">
            <SlidersHorizontal size={15} />
          </button>
          {can(user.role, 'pos') && (
            <button className="btn accent big" onClick={() => nav('/pos')}>
              <Plus size={16} /> بيع جديد
            </button>
          )}
        </div>
      </div>

      {backupOverdue && can(user.role,'backup') && (
        <div className="card" style={{ borderColor:'var(--red)', background:'rgba(220,40,30,0.06)', marginBottom: 14, display:'flex', alignItems:'center', justifyContent:'space-between', gap: 10, flexWrap:'wrap' }}>
          <div style={{ color:'var(--red)', display:'flex', alignItems:'center', gap: 8 }}>
            <ShieldAlert size={20} style={{ flexShrink: 0 }} />
            <div>
              <b>تنبيه: احمِ بياناتك!</b>{''}
              {lastBackupAt
                ?`آخر نسخة احتياطية من ${fmtDate(lastBackupAt)} — يُفضّل إجراء نسخة جديدة الآن.`
                :'لم تقم بأي نسخة احتياطية بعد. بيانات المحل محفوظة محلياً فقط.'}
            </div>
          </div>
          <Link to="/backup" className="btn accent">نسخة احتياطية الآن</Link>
        </div>
      )}

      {(() => {
        const acts = [
          { to:'/pos', icon:'Receipt', label:'بيع', action:'pos' },
          { to:'/purchase', icon:'ShoppingBag', label:'شراء', action:'purchase' },
          { to:'/customers', icon:'HandCoins', label:'تحصيل', action:'customers' },
          { to:'/expenses', icon:'Wallet', label:'مصروف', action:'expenses' },
          { to:'/items', icon:'Boxes', label:'صنف جديد', action:'items' },
          { to:'/cash-close', icon:'Calculator', label:'تقفيل اليومية', action:'cashclose' },
        ].filter((a) => can(user.role, a.action));
        if (!acts.length) return null;
        return (
          <div className="quick-actions" style={{ display:'flex', gap: 8, flexWrap:'wrap', marginBottom: 14 }}>
            {acts.map((a) => (
              <Link key={a.to} to={a.to} className="btn ghost" style={{ display:'flex', alignItems:'center', gap: 6 }}>
                <Icon name={a.icon} size={16} />
                <span>{a.label}</span>
              </Link>
            ))}
          </div>
        );
      })()}

      {customize && (
        <div className="card" style={{ marginBottom: 12 }}>
          <b>تخصيص مؤشرات الرئيسية</b>
          <div style={{ display:'flex', gap: 14, flexWrap:'wrap', marginTop: 8 }}>
            {KPIS.map((k) => (
              <label key={k.key} style={{ display:'flex', alignItems:'center', gap: 6, fontSize: 13, cursor:'pointer' }}>
                <input type="checkbox" checked={!hidden.includes(k.key)} onChange={() => toggleWidget(k.key)} style={{ accentColor:'var(--primary)' }} />
                <span>{k.label}</span>
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
          <div className="section-title">مؤشرات {sector.name ||'المجال'}</div>
          <div className="kpis">
            {sectorCards.map((c) => (
              <Link key={c.k} to={c.to} className={c.cls || c.tone} style={{ textDecoration:'none' }}>
                <div className="label" style={{ display:'flex', alignItems:'center', gap: 6 }}>
                  <Icon name={c.icon} size={15} />
                  <span>{c.label}</span>
                </div>
                <div className="value num">{c.value}</div>
                <div className="sub">اضغط للتفاصيل</div>
              </Link>
            ))}
          </div>
        </>
      )}

      {lowStock.length > 0 && (
        <div className="card" style={{ borderColor:'var(--amber)', marginBottom: 16 }}>
          <b style={{ color:'var(--amber)', display:'flex', alignItems:'center', gap: 6 }}>
            <AlertTriangle size={16} />
            <span>أصناف قاربت على النفاد ({lowStock.length})</span>
          </b>
          <div style={{ marginTop: 8, display:'flex', gap: 8, flexWrap:'wrap' }}>
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
          <div className="big-ico" style={{ display:'flex', justifyContent:'center' }}>
            <ReceiptText size={44} strokeWidth={1.5} color="var(--ink-soft)" />
          </div>
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
                  <td>{inv.type ==='sale' ? <span className="badge primary">بيع</span> : <span className="badge gray">شراء</span>}</td>
                  <td>{inv.partyName ||'نقدي'}</td>
                  <td className="num">{money(inv.total)}</td>
                  <td>{inv.status ==='cancelled' ? <span className="badge red">ملغاة</span> : inv.remaining > 0 ? <span className="badge amber">آجل {money(inv.remaining)}</span> : <span className="badge green">مدفوعة</span>}</td>
                  <td className="muted">{fmtDate(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Daily Closing Summary Preview & WhatsApp Share */}
      {summaryOpen && (
        <Modal title={`ملخص إقفال اليومية (${fmtDay(day)})`} onClose={() => setSummaryOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                <div className="muted" style={{ fontSize: 12 }}>مبيعات اليوم</div>
                <b style={{ fontSize: 16, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>{money(salesTotal)}</b>
                <div className="muted" style={{ fontSize: 11 }}>{todaySales.length} فاتورة</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                <div className="muted" style={{ fontSize: 12 }}>صافي أرباح اليوم</div>
                <b style={{ fontSize: 16, color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>{money(profitTotal - expTotal)}</b>
                <div className="muted" style={{ fontSize: 11 }}>بعد خصم المصروفات</div>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                <div className="muted" style={{ fontSize: 12 }}>مصروفات اليوم</div>
                <b style={{ fontSize: 15, color: 'var(--red)', fontVariantNumeric: 'tabular-nums' }}>{money(expTotal)}</b>
              </div>
              <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                <div className="muted" style={{ fontSize: 12 }}>كاش الدرج المتوقع</div>
                <b style={{ fontSize: 15, color: '#0f4c5c', fontVariantNumeric: 'tabular-nums' }}>
                  {cashExpected != null ? money(cashExpected) : 'جاري الاحتساب...'}
                </b>
              </div>
            </div>

            <div style={{ background: '#f8fafc', padding: 12, borderRadius: 10, border: '1px solid var(--line)', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                <span className="muted">الأكثر مبيعاً:</span>
                <b>{todayTopItem() ? `${todayTopItem()[0]} (${fmt(todayTopItem()[1])})` : 'لا يوجد مبيعات اليوم'}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #e2e8f0' }}>
                <span className="muted">إجمالي ديون العملاء:</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(debtsTotal)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span className="muted">أصناف قاربت على النفاد:</span>
                <b style={{ fontVariantNumeric: 'tabular-nums' }}>{lowStock.length} صنف</b>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                className="btn accent"
                onClick={shareToWhatsApp}
                style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Send size={15} /> إرسال عبر واتساب
              </button>
              <button className="btn" onClick={copySummaryText} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                <span>{copied ? 'تم النسخ!' : 'نسخ التقرير'}</span>
              </button>
              <button className="btn ghost" onClick={() => setSummaryOpen(false)}>
                إغلاق
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

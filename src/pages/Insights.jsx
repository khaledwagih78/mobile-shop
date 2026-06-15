import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, dayOf } from '../db';
import { money, fmt } from '../utils';

const daysAgo = (n) => dayOf(new Date(Date.now() - n * 86400000).toISOString());

export default function Insights() {
  const invoices = useLiveQuery(() => db.invoices.toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const [ai, setAi] = useState({ status: 'idle', text: '' });

  const A = useMemo(() => analyze(invoices, items, customers), [invoices, items, customers]);

  const runAI = async () => {
    const key = await getSetting('aiKey', '');
    if (!key) {
      setAi({ status: 'nokey', text: '' });
      return;
    }
    setAi({ status: 'loading', text: '' });
    try {
      const summary = {
        'مبيعات آخر 7 أيام': A.sales7, 'مبيعات الـ7 أيام السابقة': A.salesPrev7,
        'ربح آخر 30 يوم': A.profit30, 'نسبة الربح الإجمالية %': A.marginPct,
        'أصناف تحتاج إعادة طلب': A.restock.slice(0, 10).map((r) => `${r.name} (يكفي ${r.cover} يوم)`),
        'أصناف راكدة': A.dead.slice(0, 10).map((d) => `${d.name} (رصيد ${d.stock})`),
        'أعلى الأصناف ربحاً': A.topProfit.slice(0, 5).map((t) => `${t.name}: ${Math.round(t.profit)} ج.م (هامش ${t.margin}%)`),
        'أكبر المديونيات': A.topDebts.slice(0, 5).map((c) => `${c.name}: ${Math.round(c.balance)} ج.م`),
        'أصناف هامش ربحها ضعيف': A.lowMargin.slice(0, 8).map((l) => `${l.name}: ${l.margin}%`),
      };
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: `أنت مستشار تجاري خبير لمحلات قطع غيار الموبايل في مصر. هذه بيانات المحل:\n${JSON.stringify(summary, null, 1)}\n\nاكتب بالعربية المصرية البسيطة: 1) تقييم سريع للوضع في سطرين 2) أهم 5 توصيات عملية مرتبة بالأولوية 3) أكبر فرصة لزيادة الربح. بدون مقدمات طويلة.`,
          }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      setAi({ status: 'done', text });
    } catch (e) {
      setAi({ status: 'error', text: e.message });
    }
  };

  return (
    <>
      <div className="page-head"><h1>🤖 المساعد الذكي</h1></div>

      <div className="kpis">
        <div className={`kpi ${A.trend >= 0 ? 'tone-green' : 'tone-red'}`}>
          <div className="label">اتجاه المبيعات (7 أيام)</div>
          <div className="value">{A.trend >= 0 ? '⬆' : '⬇'} {Math.abs(A.trend)}%</div>
          <div className="sub">{money(A.sales7)} مقابل {money(A.salesPrev7)} قبلها</div>
        </div>
        <div className="kpi tone-green">
          <div className="label">نسبة الربح الإجمالية (30 يوم)</div>
          <div className="value">{A.marginPct}%</div>
          <div className="sub">ربح {money(A.profit30)}</div>
        </div>
        <div className="kpi tone-accent">
          <div className="label">أصناف تحتاج إعادة طلب</div>
          <div className="value">{A.restock.length}</div>
        </div>
        <div className="kpi tone-red">
          <div className="label">أصناف راكدة (٣٠+ يوم)</div>
          <div className="value">{A.dead.length}</div>
          <div className="sub">رأس مال محبوس {money(A.deadValue)}</div>
        </div>
      </div>

      {/* AI section */}
      <div className="card" style={{ marginBottom: 16, borderColor: 'var(--primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <b>🧠 تحليل بالذكاء الاصطناعي</b>
          <button className="btn" onClick={runAI} disabled={ai.status === 'loading'}>
            {ai.status === 'loading' ? '...جاري التحليل' : '✨ حلّل بياناتي الآن'}
          </button>
        </div>
        {ai.status === 'nokey' && (
          <p className="muted" style={{ marginTop: 10 }}>
            لتفعيل هذه الميزة: أدخلي مفتاح Claude API في صفحة <b>الإعدادات</b>.
            التحليلات المحلية بالأسفل تعمل دائماً بدون إنترنت ✅
          </p>
        )}
        {ai.status === 'error' && <p style={{ color: 'var(--red)', marginTop: 10 }}>❌ {ai.text}</p>}
        {ai.status === 'done' && (
          <div style={{ marginTop: 12, whiteSpace: 'pre-wrap', lineHeight: 1.9, background: 'var(--primary-soft)', borderRadius: 12, padding: 14 }}>
            {ai.text}
          </div>
        )}
      </div>

      <div className="grid-2">
        <InsightCard title="🛒 إعادة الطلب — اطلبي قبل ما يخلص" tone="amber"
          empty="لا توجد أصناف قريبة من النفاد"
          rows={A.restock.map((r) => [r.name, `رصيد ${fmt(r.stock)} — يكفي ${r.cover} يوم`])} />
        <InsightCard title="💰 الأعلى ربحاً (30 يوم)" tone="green"
          empty="لا توجد مبيعات بعد"
          rows={A.topProfit.map((t) => [t.name, `${money(t.profit)} · هامش ${t.margin}%`])} />
        <InsightCard title="🐌 أصناف راكدة — فكري في عرض عليها" tone="red"
          empty="لا توجد أصناف راكدة 👌"
          rows={A.dead.map((d) => [d.name, `رصيد ${fmt(d.stock)} بقيمة ${money(d.stock * d.costPrice)}`])} />
        <InsightCard title="⚠️ هامش ربح ضعيف — راجعي التسعير" tone="amber"
          empty="كل الأصناف هامشها جيد"
          rows={A.lowMargin.map((l) => [l.name, `هامش ${l.margin}% فقط`])} />
        <InsightCard title="🧾 أكبر المديونيات — للمتابعة" tone="red"
          empty="لا توجد ديون 🎉"
          rows={A.topDebts.map((c) => [c.name, money(c.balance)])} />
        <InsightCard title="⭐ أفضل العملاء (30 يوم)" tone="green"
          empty="لا توجد مبيعات بعد"
          rows={A.topCustomers.map((c) => [c.name, `${money(c.sales)} في ${c.count} فاتورة`])} />
      </div>
    </>
  );
}

function InsightCard({ title, rows, empty, tone }) {
  return (
    <div className="card">
      <b>{title}</b>
      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>{empty}</p>
      ) : (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.slice(0, 8).map(([a, b], i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid #eef2f3', paddingBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{a}</span>
              <span className={`badge ${tone}`}>{b}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function analyze(invoices, items, customers) {
  const d7 = daysAgo(7), d14 = daysAgo(14), d30 = daysAgo(30);
  const sales = invoices.filter((i) => i.type === 'sale' && i.status === 'active');
  const s7 = sales.filter((i) => i.day >= d7);
  const sPrev7 = sales.filter((i) => i.day >= d14 && i.day < d7);
  const s30 = sales.filter((i) => i.day >= d30);

  const sales7 = s7.reduce((s, i) => s + i.total, 0);
  const salesPrev7 = sPrev7.reduce((s, i) => s + i.total, 0);
  const trend = salesPrev7 > 0 ? Math.round(((sales7 - salesPrev7) / salesPrev7) * 100) : sales7 > 0 ? 100 : 0;

  const profit30 = s30.reduce((s, i) => s + (i.profit || 0), 0);
  const cost30 = s30.reduce((s, i) => s + i.lines.reduce((x, l) => x + l.qty * l.cost, 0), 0);
  const marginPct = cost30 > 0 ? Math.round((profit30 / cost30) * 100) : 0;

  // per-item 30-day stats
  const stat = new Map();
  for (const inv of s30) for (const l of inv.lines) {
    const c = stat.get(l.itemId) || { qty: 0, profit: 0, lastDay: '' };
    c.qty += l.qty; c.profit += l.qty * (l.price - l.cost);
    if (inv.day > c.lastDay) c.lastDay = inv.day;
    stat.set(l.itemId, c);
  }
  const soldEver = new Set();
  for (const inv of sales) for (const l of inv.lines) if (inv.day >= d30) soldEver.add(l.itemId);

  const restock = items
    .map((it) => {
      const st = stat.get(it.id);
      const daily = st ? st.qty / 30 : 0;
      const cover = daily > 0 ? Math.round((it.stock || 0) / daily) : 999;
      return { ...it, cover };
    })
    .filter((it) => (it.stock || 0) <= (it.minStock || 0) || it.cover <= 7)
    .sort((a, b) => a.cover - b.cover);

  const dead = items
    .filter((it) => (it.stock || 0) > 0 && !soldEver.has(it.id))
    .sort((a, b) => b.stock * b.costPrice - a.stock * a.costPrice);
  const deadValue = dead.reduce((s, it) => s + (it.stock || 0) * (it.costPrice || 0), 0);

  const topProfit = items
    .map((it) => {
      const st = stat.get(it.id);
      const margin = it.costPrice > 0 ? Math.round(((it.salePrice - it.costPrice) / it.costPrice) * 100) : 0;
      return { name: it.name, profit: st?.profit || 0, margin };
    })
    .filter((t) => t.profit > 0)
    .sort((a, b) => b.profit - a.profit);

  const lowMargin = items
    .map((it) => ({
      name: it.name,
      margin: it.costPrice > 0 ? Math.round(((it.salePrice - it.costPrice) / it.costPrice) * 100) : 0,
    }))
    .filter((l) => l.margin < 15 && l.margin >= 0)
    .sort((a, b) => a.margin - b.margin);

  const topDebts = customers.filter((c) => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance);

  const custStat = new Map();
  for (const inv of s30) {
    const k = inv.partyName || 'نقدي';
    const c = custStat.get(k) || { name: k, sales: 0, count: 0 };
    c.sales += inv.total; c.count++;
    custStat.set(k, c);
  }
  const topCustomers = [...custStat.values()].sort((a, b) => b.sales - a.sales);

  return { sales7, salesPrev7, trend, profit30, marginPct, restock, dead, deadValue, topProfit, lowMargin, topDebts, topCustomers };
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, dayOf, stockOf } from '../db';
import { money, fmt } from '../utils';
import { useAuth } from '../auth';

// normalize Egyptian/Arabic text for keyword matching
const norm = (s) => (s || '')
  .replace(/[ً-ْٰ]/g, '')      // drop tashkeel
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ').trim().toLowerCase();

const has = (t, ...words) => words.some((w) => t.includes(norm(w)));

const SUGGESTIONS = [
  'مبيعات النهارده كام',
  'أرباح النهارده',
  'اشتريت بكام النهارده',
  'مصروفات اليوم',
  'مبيعات الشهر',
  'عليا كام للموردين',
  'ليا كام عند العملاء',
  'الأصناف الناقصة',
  'أكتر صنف مبيعاً',
  'قيمة المخزون',
];

export default function Voice() {
  const { activeBranch, branches } = useAuth();
  const invoices = useLiveQuery(() => db.invoices.toArray(), [], []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const items = useLiveQuery(() => db.items.toArray(), [], []);

  const [text, setText] = useState('');
  const [answer, setAnswer] = useState(null); // { title, lines[] }
  const [listening, setListening] = useState(false);
  const [log, setLog] = useState([]); // {q, a}
  const recRef = useRef(null);
  const branchName = branches.find((b) => b.id === activeBranch)?.name || 'الفرع';

  const supported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const ttsOk = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speak = (s) => {
    if (!ttsOk || !s) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(s);
      u.lang = 'ar-EG'; u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };

  const run = (raw) => {
    const res = analyze(raw, { invoices, expenses, customers, suppliers, items, branchId: activeBranch, branchName });
    setAnswer(res);
    setLog((l) => [{ q: raw, a: res.speak }, ...l].slice(0, 8));
    speak(res.speak);
  };

  const startListening = () => {
    if (!supported) return;
    try {
      const R = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new R();
      rec.lang = 'ar-EG'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onstart = () => setListening(true);
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.onresult = (e) => {
        const said = e.results[0][0].transcript;
        setText(said);
        run(said);
      };
      recRef.current = rec;
      rec.start();
    } catch { setListening(false); }
  };
  const stopListening = () => { try { recRef.current?.stop(); } catch { /* ignore */ } };

  useEffect(() => () => { try { window.speechSynthesis?.cancel(); recRef.current?.stop(); } catch { /* ignore */ } }, []);

  const submit = () => { if (text.trim()) run(text.trim()); };

  return (
    <>
      <div className="page-head">
        <h1>🎤 تحليل بالصوت <span className="muted" style={{ fontSize: 14 }}>· {branchName}</span></h1>
      </div>

      <div className="card" style={{ padding: 20, textAlign: 'center', marginBottom: 16 }}>
        <button
          onClick={listening ? stopListening : startListening}
          disabled={!supported}
          style={{
            width: 110, height: 110, borderRadius: '50%', border: 'none', cursor: 'pointer',
            fontSize: 44, color: '#fff',
            background: listening ? 'var(--red, #d64545)' : 'var(--primary, #0F4C5C)',
            boxShadow: listening ? '0 0 0 8px rgba(214,69,69,.2)' : '0 4px 14px rgba(0,0,0,.2)',
            transition: 'all .2s',
          }}
        >🎤</button>
        <div style={{ marginTop: 12, fontWeight: 700 }}>
          {listening ? 'بتكلم... قول سؤالك' : supported ? 'اضغط وقول سؤالك' : 'المتصفح لا يدعم الصوت — اكتب سؤالك'}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, maxWidth: 520, marginInline: 'auto' }}>
          <input
            className="input lg" style={{ flex: 1 }} value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="أو اكتب سؤالك هنا... مثال: مبيعات النهارده كام" />
          <button className="btn" onClick={submit}>تحليل</button>
        </div>
      </div>

      {answer && (
        <div className="card" style={{ padding: 20, marginBottom: 16, borderInlineStart: '4px solid var(--primary, #0F4C5C)' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>🗣️ {answer.title}</div>
          {answer.lines.map((ln, i) => (
            <div key={i} style={{ fontSize: i === 0 ? 26 : 15, fontWeight: i === 0 ? 800 : 500, marginTop: i === 0 ? 0 : 6, color: i === 0 ? 'var(--primary, #0F4C5C)' : 'inherit' }}>{ln}</div>
          ))}
          {ttsOk && <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => speak(answer.speak)}>🔊 اسمع تاني</button>}
        </div>
      )}

      <div className="section-title">جرّب تسأل</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {SUGGESTIONS.map((s) => (
          <button key={s} className="badge" style={{ cursor: 'pointer', padding: '8px 12px', fontSize: 13 }}
            onClick={() => { setText(s); run(s); }}>{s}</button>
        ))}
      </div>

      {log.length > 0 && (
        <>
          <div className="section-title">آخر الأسئلة</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>السؤال</th><th>الإجابة</th></tr></thead>
              <tbody>{log.map((r, i) => <tr key={i}><td className="muted">{r.q}</td><td>{r.a}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ---- local, offline query analysis (respects the active branch) ----
function analyze(raw, { invoices, expenses, customers, suppliers, items, branchId, branchName }) {
  const t = norm(raw);
  const inBranch = (r) => (r.branchId || 1) === branchId;

  // period
  const d = today();
  const yesterday = dayOf(new Date(Date.now() - 86400000).toISOString());
  const month = d.slice(0, 7);
  let period = 'today', periodLabel = 'النهارده';
  if (has(t, 'امبارح', 'البارحه')) { period = 'yday'; periodLabel = 'امبارح'; }
  else if (has(t, 'الشهر', 'شهري', 'الشهر ده')) { period = 'month'; periodLabel = 'الشهر ده'; }
  else if (has(t, 'كله', 'الكل', 'اجمالي كلي', 'من الاول')) { period = 'all'; periodLabel = 'إجمالي'; }
  else if (has(t, 'النهارده', 'اليوم', 'انهارده')) { period = 'today'; periodLabel = 'النهارده'; }

  const inPeriod = (day) => period === 'all' ? true
    : period === 'today' ? day === d
    : period === 'yday' ? day === yesterday
    : day && day.startsWith(month);

  const sales = invoices.filter((i) => i.type === 'sale' && i.status === 'active' && inBranch(i) && inPeriod(i.day));
  const purch = invoices.filter((i) => i.type === 'purchase' && i.status === 'active' && inBranch(i) && inPeriod(i.day));
  const exps = expenses.filter((e) => inBranch(e) && inPeriod(e.day));
  const salesTotal = sales.reduce((s, i) => s + (i.total || 0), 0);
  const purchTotal = purch.reduce((s, i) => s + (i.total || 0), 0);
  const profit = sales.reduce((s, i) => s + (i.profit || 0), 0);
  const expTotal = exps.reduce((s, e) => s + (e.amount || 0), 0);
  const suffix = branchName ? ` — ${branchName}` : '';

  // supplier debts = عليا (what I owe) ; customer debts = ليا (what they owe me)
  const owe = suppliers.filter((s) => (s.balance || 0) > 0).reduce((s, x) => s + x.balance, 0);
  const owed = customers.filter((c) => (c.balance || 0) > 0).reduce((s, c) => s + c.balance, 0);

  const A = (title, big, extra = []) => ({ title, lines: [big, ...extra], speak: `${title}: ${big}` });

  // intent routing (order matters)
  if (has(t, 'عليا', 'مديوني', 'لازم ادفع') || (has(t, 'الموردين') && has(t, 'ديون', 'فلوس', 'كام'))) {
    const names = suppliers.filter((s) => (s.balance || 0) > 0).sort((a, b) => b.balance - a.balance).slice(0, 3).map((s) => `${s.name}: ${money(s.balance)}`);
    return A('اللي عليك للموردين', money(owe), names);
  }
  if (has(t, 'ليا', 'الزباين عليهم', 'العملاء عليهم', 'ديون العملاء') || (has(t, 'العملاء', 'الزباين') && has(t, 'كام', 'فلوس', 'ديون'))) {
    const names = customers.filter((c) => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance).slice(0, 3).map((c) => `${c.name}: ${money(c.balance)}`);
    return A('اللي ليك عند العملاء', money(owed), names);
  }
  if (has(t, 'نواقص', 'ناقص', 'خلص', 'خلصان', 'قرب يخلص')) {
    const low = items.filter((it) => stockOf(it, branchId) <= (it.minStock || 0));
    const names = low.slice(0, 6).map((it) => `${it.name} (${fmt(stockOf(it, branchId))})`);
    return A(`أصناف ناقصة${suffix}`, `${low.length} صنف`, names.length ? names : ['لا يوجد نواقص 👍']);
  }
  if (has(t, 'قيمه المخزون', 'قيمة المخزون', 'المخزون كام', 'رأس المال', 'راس المال')) {
    const val = items.reduce((s, it) => s + stockOf(it, branchId) * (it.costPrice || 0), 0);
    const units = items.reduce((s, it) => s + stockOf(it, branchId), 0);
    return A(`قيمة المخزون${suffix}`, money(val), [`${fmt(units)} قطعة في ${items.length} صنف`]);
  }
  if (has(t, 'اكتر صنف', 'الاكثر مبيعا', 'افضل صنف', 'اكثر مبيعا', 'الاكتر')) {
    const m = new Map();
    for (const inv of sales) for (const l of inv.lines || []) m.set(l.name, (m.get(l.name) || 0) + l.qty);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) return A(`الأكثر مبيعاً (${periodLabel})`, 'لا توجد مبيعات', []);
    return A(`الأكثر مبيعاً (${periodLabel})${suffix}`, `${top[0][0]} — ${fmt(top[0][1])} قطعة`, top.slice(1).map(([n, q]) => `${n}: ${fmt(q)}`));
  }
  if (has(t, 'مصروف', 'مصاريف', 'صرفت')) {
    return A(`مصروفات ${periodLabel}${suffix}`, money(expTotal), [`${exps.length} عملية`]);
  }
  if (has(t, 'مشتريات', 'اشتريت', 'شريت', 'شراء')) {
    return A(`مشتريات ${periodLabel}${suffix}`, money(purchTotal), [`${purch.length} فاتورة شراء`]);
  }
  if (has(t, 'ربح', 'ارباح', 'مكسب', 'كسبت', 'صافي')) {
    return A(`أرباح ${periodLabel}${suffix}`, money(profit - expTotal), [`ربح البيع ${money(profit)} − مصروفات ${money(expTotal)}`]);
  }
  if (has(t, 'عدد', 'كام فاتوره', 'كام فاتورة', 'فواتير')) {
    return A(`عدد فواتير البيع ${periodLabel}${suffix}`, `${sales.length} فاتورة`, [`بإجمالي ${money(salesTotal)}`]);
  }
  if (has(t, 'مبيعات', 'بعت', 'بيع', 'اجمالي', 'كام')) {
    return A(`مبيعات ${periodLabel}${suffix}`, money(salesTotal), [`${sales.length} فاتورة · ربح ${money(profit)}`]);
  }

  // fallback: full snapshot
  return {
    title: `ملخص ${periodLabel}${suffix}`,
    lines: [
      `مبيعات: ${money(salesTotal)}`,
      `مشتريات: ${money(purchTotal)}`,
      `أرباح بعد المصروفات: ${money(profit - expTotal)}`,
      `عليك للموردين: ${money(owe)} · ليك عند العملاء: ${money(owed)}`,
    ],
    speak: `ملخص ${periodLabel}: مبيعات ${money(salesTotal)}، مشتريات ${money(purchTotal)}، صافي الربح ${money(profit - expTotal)}`,
  };
}

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, saveInvoice, getSetting } from '../db';
import { money, fmt, matchItem, parseInvoiceLines } from '../utils';
import { Toast } from '../components/UI';
import { useAuth } from '../auth';
import { isAiAllowed } from '../plans';
import { getGeminiApiKey } from '../services/gemini';

const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export default function SmartImport() {
  const { user, activeBranch } = useAuth();
  const nav = useNavigate();
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const parties = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const plan = useLiveQuery(() => getSetting('plan', 'pro'), [], 'pro');

  const [type, setType] = useState('purchase');
  const [rows, setRows] = useState([]); // { raw, name, qty, price, itemId, score }
  const [partyId, setPartyId] = useState('');
  const [paidFull, setPaidFull] = useState(true);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 3200); };
  const partyList = type ==='purchase' ? parties : customers;

  // run smart matching over extracted rows
  const matchRows = (extracted) => extracted.map((r) => {
    const mm = matchItem(r.name, items);
    const itemId = mm && mm.score >= 0.6 ? mm.item.id :'';
    let price = Number(r.price) || 0;
    if (!price && itemId) { const it = items.find((x) => x.id === itemId); price = (type ==='purchase' ? it.costPrice : it.salePrice) || 0; }
    return { raw: r.name || r.raw, name: r.name || r.raw, qty: Number(r.qty) || 1, price, itemId, score: mm ? mm.score : 0 };
  });

  const loadText = () => {
    const parsed = parseInvoiceLines(pasteText);
    if (!parsed.length) { notify(' لا يوجد بنود في النص'); return; }
    setRows(matchRows(parsed));
    notify(` تم استخراج ${parsed.length} بند — راجعها`);
  };

  const loadExcel = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy('excel');
    try {
      const XLSX = await import('xlsx');
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval:'' });
      const keyOf = (obj, cands) => Object.keys(obj).find((k) => cands.some((c) => String(k).toLowerCase().includes(c)));
      let extracted = [];
      if (json.length) {
        const s = json[0];
        const nk = keyOf(s, ['اسم','صنف','بيان','name','product','item']);
        const qk = keyOf(s, ['كمي','عدد','qty','quantity']);
        const pk = keyOf(s, ['سعر','price','تكلف','cost','قيمة']);
        if (nk) extracted = json.map((r) => ({ name: String(r[nk] ||''), qty: qk ? Number(r[qk]) || 1 : 1, price: pk ? Number(r[pk]) || 0 : 0 })).filter((r) => r.name.trim());
      }
      if (!extracted.length) {
        const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        extracted = aoa.filter((row) => row && row[0] && isNaN(Number(row[0]))).map((row) => ({ name: String(row[0]), qty: Number(row[1]) || 1, price: Number(row[2]) || 0 }));
      }
      if (!extracted.length) notify(' لم أتعرّف على أعمدة الفاتورة في الملف');
      else { setRows(matchRows(extracted)); notify(` تم استخراج ${extracted.length} بند من Excel`); }
    } catch (err) { notify(' تعذّر قراءة الملف:' + (err.message ||'')); }
    finally { setBusy(''); e.target.value =''; }
  };

  const loadImage = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!isAiAllowed(plan)) {
      notify('ميزة استخراج بنود الفواتير بالذكاء الاصطناعي متاحة حصرياً في باقة Pro');
      e.target.value = '';
      return;
    }
    const key = await getGeminiApiKey();
    if (!key) {
      notify('مفتاح Google Gemini غير مهيأ في بيئة النظام (.env)');
      e.target.value = '';
      return;
    }
    setBusy('ai');
    try {
      const b64 = await fileToBase64(f);
      const mimeType = f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const prompt = 'استخرج بنود الفاتورة من هذا الملف بدقة. أعد فقط مصفوفة JSON صالحة بالشكل التالي: [{"name":"اسم الصنف","qty":الكمية,"price":السعر}] بدون أي نصوص أو markdown إضافي.';

      // Attempt primary model gemini-3.5-flash-lite, fallback to gemini-3.8-flash and 2.0-flash
      const models = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
      let extracted = [];
      let lastErr = null;

      for (const model of models) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: b64
                    }
                  },
                  { text: prompt }
                ]
              }],
              generationConfig: { temperature: 0.1 }
            })
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            lastErr = new Error(data.error?.message || `HTTP ${res.status}`);
            continue;
          }
          const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const m = txt.match(/\[[\s\S]*\]/);
          extracted = m ? JSON.parse(m[0]) : [];
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!extracted.length) {
        if (lastErr) throw lastErr;
        notify('لم يتم التعرف على بنود داخل الملف');
      } else {
        setRows(matchRows(extracted));
        notify(`تم استخراج ${extracted.length} بند بنجاح (للمعاينة والتحليل قبل الحفظ)`);
      }
    } catch (err) {
      notify('تعذّر التحليل: ' + (err.message || 'تأكد من الاتصال وصلاحية المفتاح'));
    } finally {
      setBusy('');
      e.target.value = '';
    }
  };

  const setRow = (i, patch) => setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const matched = rows.filter((r) => r.itemId);
  const subtotal = useMemo(() => matched.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.price) || 0), 0), [matched]);

  const save = async () => {
    if (!matched.length) { notify(' لا توجد بنود مطابقة لأصناف'); return; }
    const party = partyList.find((p) => p.id === Number(partyId));
    const lines = matched.map((r) => {
      const it = items.find((x) => x.id === Number(r.itemId));
      return { itemId: it.id, name: it.name, code: it.code, qty: Number(r.qty) || 1, price: Number(r.price) || 0, cost: it.costPrice || 0, factor: 1 };
    });
    const total = subtotal;
    const paid = paidFull ? total : 0;
    if (!paidFull && !party) { notify('الفاتورة الآجلة تحتاج اختيار طرف'); return; }
    setBusy('save');
    try {
      const res = await saveInvoice({
        type, branchId: activeBranch, partyId: party ? party.id : null, partyName: party ? party.name : null,
        lines, subtotal, discount: 0, tax: 0, total, paid, remaining: Math.max(0, total - paid),
        profit: type ==='sale' ? lines.reduce((s, l) => s + l.qty * (l.price - l.cost), 0) : 0,
        userId: user.id, userName: user.name,
      });
      nav(`/invoices/${res.id}?new=1`);
    } catch (err) { notify('' + (err.message ||'تعذّر الحفظ')); setBusy(''); }
  };

  return (
    <>
      <div className="page-head"><h1>الإضافة الذكية للفواتير</h1></div>

      <div className="card" style={{ maxWidth: 820 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          حوّل فاتورة من <b>Excel</b> أو <b>نص</b> أو <b>صورة/PDF</b> إلى فاتورة في النظام. التطبيق يطابق كل بند
          تلقائياً بأقرب صنف عندك (بالاسم/الرقم/السعر)، وتراجعها قبل الحفظ.
        </p>
        <div className="row">
          <div className="field"><label>نوع الفاتورة</label>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value); setPartyId(''); }}>
              <option value="purchase">فاتورة شراء</option>
              <option value="sale">فاتورة بيع</option>
            </select></div>
          <div className="field"><label>{type ==='purchase' ?'المورد (اختياري)' :'العميل (اختياري)'}</label>
            <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">— بدون —</option>
              {partyList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        </div>

        <div style={{ display:'flex', gap: 10, flexWrap:'wrap', marginTop: 6 }}>
          <label className="btn ghost" style={{ cursor:'pointer' }}>
            استيراد Excel<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={loadExcel} />
          </label>
          <label className="btn ghost" style={{ cursor:'pointer' }}>
            صورة / PDF (ذكاء اصطناعي){busy ==='ai' ?' ...' :''}
            <input type="file" accept="image/*,application/pdf" hidden onChange={loadImage} />
          </label>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label>أو الصق بنود الفاتورة (كل بند في سطر: الاسم — الكمية — السعر)</label>
          <textarea className="input" rows="4" value={pasteText} onChange={(e) => setPasteText(e.target.value)}
            placeholder={'شاشة سامسونج A10\tعدد 5\t320\nبطارية اوبو A54\t10\t110'} />
          <button className="btn" style={{ marginTop: 6 }} onClick={loadText} disabled={!pasteText.trim()}>استخراج البنود</button>
        </div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="page-head" style={{ marginTop: 18 }}>
            <h2>مراجعة البنود ({matched.length}/{rows.length} مطابقة)</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>النص الأصلي</th><th>الصنف المطابق</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th></th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ background: r.itemId ?'' :'rgba(230,126,34,.08)' }}>
                    <td>{r.raw}{!r.itemId && <div className="meta" style={{ color:'var(--amber)' }}>لم يُطابَق — اختر صنفاً</div>}{r.itemId && r.score < 1 && <div className="meta muted">ثقة {Math.round(r.score * 100)}%</div>}</td>
                    <td>
                      <select className="input" value={r.itemId} onChange={(e) => { const id = e.target.value; const it = items.find((x) => x.id === Number(id)); setRow(i, { itemId: id, price: r.price || (it ? (type ==='purchase' ? it.costPrice : it.salePrice) || 0 : 0) }); }}>
                        <option value="">— تجاهل —</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.code})</option>)}
                      </select>
                    </td>
                    <td style={{ maxWidth: 80 }}><input className="input" type="number" min="0" value={r.qty} onChange={(e) => setRow(i, { qty: Number(e.target.value) })} /></td>
                    <td style={{ maxWidth: 100 }}><input className="input" type="number" min="0" value={r.price} onChange={(e) => setRow(i, { price: Number(e.target.value) })} /></td>
                    <td className="num">{money((Number(r.qty) || 0) * (Number(r.price) || 0))}</td>
                    <td><button className="x" onClick={() => removeRow(i)}></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ maxWidth: 400, marginTop: 12 }}>
            <div className="totals">
              <div className="trow grand"><span>إجمالي الفاتورة</span><span className="num">{money(subtotal)}</span></div>
            </div>
            <label style={{ display:'flex', alignItems:'center', gap: 8, margin:'6px 0', cursor:'pointer' }}>
              <input type="checkbox" checked={paidFull} onChange={(e) => setPaidFull(e.target.checked)} /> مدفوعة بالكامل (نقدي)
            </label>
            <button className="btn accent big block" onClick={save} disabled={!matched.length || busy ==='save'}> {busy ==='save' ?'...جاري الحفظ' :' اعتماد وحفظ الفاتورة'} </button>
          </div>
        </>
      )}

      <Toast msg={toast} />
    </>
  );
}

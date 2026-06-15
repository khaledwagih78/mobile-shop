import { useState } from 'react';
import * as XLSX from 'xlsx';
import { db, nowISO, queueSync } from '../db';
import { fmt, money } from '../utils';
import { Toast } from '../components/UI';

// ---- column header synonyms (Arabic + English) ----
const FIELDS = {
  items: [
    { key: 'name', label: 'اسم الصنف', required: true, syn: ['اسم الصنف', 'الصنف', 'اسم المنتج', 'المنتج', 'الاسم', 'اسم', 'name', 'item', 'product'] },
    { key: 'code', label: 'الكود', syn: ['كود الصنف', 'الكود', 'كود', 'code', 'sku'] },
    { key: 'barcode', label: 'الباركود', syn: ['الباركود', 'باركود', 'barcode'] },
    { key: 'brand', label: 'الماركة', syn: ['الماركة', 'ماركة', 'البراند', 'براند', 'brand'] },
    { key: 'category', label: 'النوع', syn: ['النوع', 'نوع', 'التصنيف', 'تصنيف', 'الفئة', 'فئة', 'category', 'type'] },
    { key: 'costPrice', label: 'سعر الشراء', num: true, syn: ['سعر الشراء', 'التكلفة', 'تكلفة', 'شراء', 'cost'] },
    { key: 'salePrice', label: 'سعر البيع', num: true, syn: ['سعر البيع', 'البيع', 'السعر', 'سعر', 'sale', 'price'] },
    { key: 'stock', label: 'الكمية', num: true, syn: ['الكمية', 'كمية', 'الرصيد', 'رصيد', 'المخزون', 'مخزون', 'stock', 'qty', 'quantity'] },
    { key: 'minStock', label: 'الحد الأدنى', num: true, syn: ['الحد الأدنى', 'حد أدنى', 'الحد الادنى', 'حد ادنى', 'min'] },
  ],
  customers: [
    { key: 'name', label: 'اسم العميل', required: true, syn: ['اسم العميل', 'العميل', 'الاسم', 'اسم', 'name', 'customer'] },
    { key: 'phone', label: 'الهاتف', syn: ['رقم الهاتف', 'الهاتف', 'هاتف', 'التليفون', 'تليفون', 'الموبايل', 'موبايل', 'phone', 'mobile', 'tel'] },
    { key: 'address', label: 'العنوان', syn: ['العنوان', 'عنوان', 'المنطقة', 'البلد', 'address'] },
    { key: 'balance', label: 'المديونية (عليه)', num: true, syn: ['المديونية', 'مديونية', 'الرصيد', 'رصيد', 'عليه', 'الدين', 'دين', 'المبلغ', 'balance', 'debt'] },
  ],
  suppliers: [
    { key: 'name', label: 'اسم المورد', required: true, syn: ['اسم المورد', 'المورد', 'الاسم', 'اسم', 'name', 'supplier'] },
    { key: 'phone', label: 'الهاتف', syn: ['رقم الهاتف', 'الهاتف', 'هاتف', 'التليفون', 'تليفون', 'الموبايل', 'موبايل', 'phone', 'mobile', 'tel'] },
    { key: 'address', label: 'العنوان', syn: ['العنوان', 'عنوان', 'address'] },
    { key: 'balance', label: 'المستحق له', num: true, syn: ['المستحق', 'الرصيد', 'رصيد', 'له', 'الدين', 'دين', 'balance'] },
  ],
};

const TYPE_LABEL = { items: 'الأصناف', customers: 'العملاء', suppliers: 'الموردين' };

const norm = (s) => String(s ?? '').trim().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();

function mapHeaders(headers, type) {
  const fields = FIELDS[type];
  const mapping = {}; // colIndex -> fieldKey
  const used = new Set();
  // pass 1: exact match — pass 2: contains
  for (const exact of [true, false]) {
    fields.forEach((f) => {
      if (used.has(f.key)) return;
      headers.forEach((h, i) => {
        if (mapping[i] || used.has(f.key)) return;
        const nh = norm(h);
        if (!nh) return;
        const hit = f.syn.some((s) => (exact ? nh === norm(s) : nh.includes(norm(s))));
        if (hit) { mapping[i] = f.key; used.add(f.key); }
      });
    });
  }
  return mapping;
}

export default function Import() {
  const [type, setType] = useState('items');
  const [parsed, setParsed] = useState(null); // {headers, mapping, rows}
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState('');
  const show = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const onFile = async (file) => {
    if (!file) return;
    setResult(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const hi = aoa.findIndex((r) => r.some((c) => String(c).trim() !== ''));
      if (hi === -1) return show('❌ الملف فارغ');
      const headers = aoa[hi].map((h) => String(h).trim());
      const mapping = mapHeaders(headers, type);
      if (!Object.values(mapping).includes('name')) {
        return show('❌ لم أتعرف على عمود الاسم — تأكدي أن أول صف فيه عناوين الأعمدة');
      }
      const fields = FIELDS[type];
      const rows = aoa.slice(hi + 1)
        .map((r) => {
          const obj = {};
          Object.entries(mapping).forEach(([i, key]) => {
            const f = fields.find((x) => x.key === key);
            const v = r[i];
            obj[key] = f.num ? Number(String(v).replace(/[,٬]/g, '')) || 0 : String(v ?? '').trim();
          });
          return obj;
        })
        .filter((o) => o.name);
      if (rows.length === 0) return show('❌ لا توجد صفوف فيها أسماء');
      setParsed({ headers, mapping, rows, fileName: file.name });
    } catch (e) {
      show('❌ تعذر قراءة الملف: ' + e.message);
    }
  };

  const doImport = async () => {
    setBusy(true);
    const { rows } = parsed;
    let added = 0, updated = 0;
    const table = db[type];
    const existing = await table.toArray();
    const byName = new Map(existing.map((x) => [norm(x.name), x]));
    const byCode = new Map(existing.filter((x) => x.code).map((x) => [norm(x.code), x]));

    await db.transaction('rw', [table, db.syncQueue], async () => {
      for (const r of rows) {
        const match = (type === 'items' && r.code && byCode.get(norm(r.code))) || byName.get(norm(r.name));
        if (match) {
          const patch = {};
          Object.entries(r).forEach(([k, v]) => {
            if (v !== '' && v !== undefined && !(typeof v === 'number' && v === 0 && match[k])) patch[k] = v;
          });
          await table.update(match.id, patch);
          updated++;
        } else {
          const doc = { ...r, createdAt: nowISO() };
          if (type !== 'items' && doc.balance === undefined) doc.balance = 0;
          const id = await table.add(doc);
          byName.set(norm(r.name), { ...doc, id });
          if (type === 'items' && r.code) byCode.set(norm(r.code), { ...doc, id });
          added++;
        }
      }
      await queueSync(type, 'import', { count: rows.length });
    });
    setBusy(false);
    setResult({ added, updated });
    setParsed(null);
  };

  const downloadTemplate = () => {
    const fields = FIELDS[type];
    const headers = fields.map((f) => f.label);
    const example = type === 'items'
      ? ['شاشة سامسونج A10', 'SCR-A10', '6221001001', 'Samsung', 'شاشات', 320, 420, 10, 3]
      : type === 'customers'
        ? ['محل النور للموبايلات', '01001234567', 'المنيا', 500]
        : ['شركة التوحيد لقطع الغيار', '01099887766', 'القاهرة', 0];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, TYPE_LABEL[type]);
    XLSX.writeFile(wb, `نموذج-${TYPE_LABEL[type]}.xlsx`);
  };

  const fields = FIELDS[type];
  const mappedKeys = parsed ? Object.values(parsed.mapping) : [];

  return (
    <>
      <div className="page-head"><h1>📑 استيراد من Excel</h1></div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div className="field">
            <label>ماذا تستورد؟</label>
            <select className="input lg" value={type} onChange={(e) => { setType(e.target.value); setParsed(null); setResult(null); }}>
              <option value="items">📦 أصناف المخزون</option>
              <option value="customers">👥 العملاء (مع المديونيات)</option>
              <option value="suppliers">🚚 الموردين</option>
            </select>
          </div>
          <div className="field">
            <label>ملف Excel (.xlsx / .xls / .csv)</label>
            <input className="input lg" type="file" accept=".xlsx,.xls,.csv"
              onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
          </div>
        </div>
        <p className="muted">
          أول صف في الملف لازم يكون عناوين الأعمدة. البرنامج يتعرف تلقائياً على الأسماء العربية مثل:{' '}
          {fields.map((f) => f.label).join('، ')}.
          {' '}<button className="btn ghost sm" onClick={downloadTemplate}>⬇️ تحميل نموذج جاهز</button>
        </p>
      </div>

      {result && (
        <div className="card" style={{ borderColor: 'var(--green)', marginBottom: 14 }}>
          <b style={{ color: 'var(--green)' }}>✅ تم الاستيراد بنجاح:</b>{' '}
          {result.added > 0 && <>أُضيف {fmt(result.added)} جديد</>}
          {result.added > 0 && result.updated > 0 && ' — '}
          {result.updated > 0 && <>تم تحديث {fmt(result.updated)} موجود</>}
        </div>
      )}

      {parsed && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <b>📄 {parsed.fileName}</b> — تم التعرف على <b>{fmt(parsed.rows.length)}</b> صف
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {fields.map((f) => (
                <span key={f.key} className={`badge ${mappedKeys.includes(f.key) ? 'green' : f.required ? 'red' : 'gray'}`}>
                  {f.label}: {mappedKeys.includes(f.key) ? '✓ موجود' : 'غير موجود'}
                </span>
              ))}
            </div>
          </div>

          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>{fields.filter((f) => mappedKeys.includes(f.key)).map((f) => <th key={f.key}>{f.label}</th>)}</tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    {fields.filter((f) => mappedKeys.includes(f.key)).map((f) => (
                      <td key={f.key} className={f.num ? 'num' : ''}>
                        {f.num ? (f.key === 'balance' ? money(r[f.key]) : fmt(r[f.key])) : r[f.key] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.rows.length > 10 && <p className="muted" style={{ padding: '8px 14px' }}>... و {fmt(parsed.rows.length - 10)} صف آخر</p>}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn accent big" onClick={doImport} disabled={busy}>
              {busy ? '...جاري الاستيراد' : `✅ استيراد ${fmt(parsed.rows.length)} ${TYPE_LABEL[type]}`}
            </button>
            <button className="btn ghost big" onClick={() => setParsed(null)}>إلغاء</button>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            ملاحظة: لو في صنف/عميل موجود بنفس الاسم أو الكود، سيتم <b>تحديث بياناته</b> بدل تكراره.
          </p>
        </>
      )}

      <Toast msg={toast} />
    </>
  );
}

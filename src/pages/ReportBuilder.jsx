import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today } from '../db';
import { money, fmt, fmtDate } from '../utils';
import { Toast } from '../components/UI';

// dataset definitions: table, whether it has a `day` field, and columns
const DATASETS = {
  invoices: {
    label: 'الفواتير', table: 'invoices', dated: true,
    cols: [
      { key: 'number', label: 'رقم' },
      { key: 'type', label: 'النوع' },
      { key: 'partyName', label: 'الطرف' },
      { key: 'total', label: 'الإجمالي', num: true },
      { key: 'paid', label: 'المدفوع', num: true },
      { key: 'remaining', label: 'المتبقي', num: true },
      { key: 'profit', label: 'الربح', num: true },
      { key: 'status', label: 'الحالة' },
      { key: 'day', label: 'التاريخ' },
    ],
  },
  payments: {
    label: 'المدفوعات', table: 'payments', dated: true,
    cols: [
      { key: 'partyName', label: 'الطرف' },
      { key: 'partyType', label: 'النوع' },
      { key: 'amount', label: 'المبلغ', num: true },
      { key: 'note', label: 'ملاحظة' },
      { key: 'day', label: 'التاريخ' },
    ],
  },
  expenses: {
    label: 'المصروفات', table: 'expenses', dated: true,
    cols: [
      { key: 'category', label: 'الفئة' },
      { key: 'description', label: 'الوصف' },
      { key: 'amount', label: 'المبلغ', num: true },
      { key: 'day', label: 'التاريخ' },
    ],
  },
  items: {
    label: 'الأصناف', table: 'items', dated: false,
    cols: [
      { key: 'code', label: 'الكود' },
      { key: 'name', label: 'الاسم' },
      { key: 'brand', label: 'الماركة' },
      { key: 'category', label: 'النوع' },
      { key: 'costPrice', label: 'الشراء', num: true },
      { key: 'salePrice', label: 'البيع', num: true },
    ],
  },
  customers: {
    label: 'العملاء', table: 'customers', dated: false,
    cols: [
      { key: 'name', label: 'الاسم' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'balance', label: 'الرصيد', num: true },
      { key: 'points', label: 'النقاط', num: true },
    ],
  },
  suppliers: {
    label: 'الموردين', table: 'suppliers', dated: false,
    cols: [
      { key: 'name', label: 'الاسم' },
      { key: 'phone', label: 'الهاتف' },
      { key: 'balance', label: 'الرصيد', num: true },
    ],
  },
};

export default function ReportBuilder() {
  const [dsKey, setDsKey] = useState('invoices');
  const ds = DATASETS[dsKey];
  const [cols, setCols] = useState(() => Object.fromEntries(DATASETS.invoices.cols.map((c) => [c.key, true])));
  const [from, setFrom] = useState(today().slice(0, 7) + '-01');
  const [to, setTo] = useState(today());
  const [q, setQ] = useState('');
  const [toast, setToast] = useState('');

  const raw = useLiveQuery(() => db[ds.table].toArray(), [ds.table], []);

  const pickDataset = (k) => {
    setDsKey(k);
    setCols(Object.fromEntries(DATASETS[k].cols.map((c) => [c.key, true])));
  };

  const rows = useMemo(() => {
    let list = raw || [];
    if (ds.dated) list = list.filter((r) => (r.day || '') >= from && (r.day || '') <= to);
    const t = q.trim().toLowerCase();
    if (t) list = list.filter((r) => ds.cols.some((c) => String(r[c.key] ?? '').toLowerCase().includes(t)));
    return list;
  }, [raw, ds, from, to, q]);

  const activeCols = ds.cols.filter((c) => cols[c.key]);
  const totals = useMemo(() => {
    const tt = {};
    for (const c of activeCols) if (c.num) tt[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return tt;
  }, [rows, activeCols]);

  const cell = (r, c) => (c.num ? money(Number(r[c.key]) || 0) : (r[c.key] ?? '—'));

  const exportCSV = () => {
    const header = activeCols.map((c) => c.label);
    const lines = rows.map((r) => activeCols.map((c) => {
      const v = c.num ? (Number(r[c.key]) || 0) : String(r[c.key] ?? '');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
    const csv = '﻿' + [header.join(','), ...lines].join('\n'); // BOM for Excel Arabic
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${ds.label}-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setToast('✅ تم تصدير الملف');
    setTimeout(() => setToast(''), 2500);
  };

  return (
    <>
      <div className="page-head">
        <h1>🧱 منشئ التقارير</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => window.print()}>🖨️ طباعة</button>
          <button className="btn accent" onClick={exportCSV}>⬇️ تصدير Excel/CSV</button>
        </div>
      </div>

      <div className="list-tools" style={{ flexWrap: 'wrap' }}>
        <select className="input" style={{ maxWidth: 160 }} value={dsKey} onChange={(e) => pickDataset(e.target.value)}>
          {Object.entries(DATASETS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}
        </select>
        {ds.dated && <>
          <input className="input" style={{ maxWidth: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" style={{ maxWidth: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </>}
        <input className="input" style={{ maxWidth: 220 }} placeholder="🔍 بحث..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }} className="muted">الأعمدة المعروضة:</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {ds.cols.map((c) => (
            <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!cols[c.key]} onChange={(e) => setCols((s) => ({ ...s, [c.key]: e.target.checked }))} />
              {c.label}
            </label>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>{activeCols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={activeCols.length} className="muted" style={{ textAlign: 'center', padding: 20 }}>لا توجد بيانات</td></tr>
            ) : rows.slice(0, 500).map((r, i) => (
              <tr key={r.id ?? i}>{activeCols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{cell(r, c)}</td>)}</tr>
            ))}
            {rows.length > 0 && Object.keys(totals).length > 0 && (
              <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 800 }}>
                {activeCols.map((c, idx) => <td key={c.key} className={c.num ? 'num' : ''}>{c.num ? money(totals[c.key]) : (idx === 0 ? 'الإجمالي' : '')}</td>)}
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted" style={{ padding: '8px 14px' }}>{fmt(rows.length)} سجل{rows.length > 500 ? ' (يُعرض أول 500)' : ''}</p>
      </div>

      <Toast msg={toast} />
    </>
  );
}

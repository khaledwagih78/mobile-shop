// Export / print the overdue-customers list (العملاء المتأخرون).
// Ported idea from the Manus build: filter by min days late + min amount,
// then hand the accountant an Excel-friendly CSV or a print/PDF view.
import { money, fmt, fmtDay } from './utils';
import { today } from './db';

const HEADERS = ['العميل', 'الهاتف', 'أقدم استحقاق', 'أيام التأخير', 'عدد الفواتير المتأخرة', 'المبلغ المتأخر', 'إجمالي الرصيد'];

const rowValues = (r) => [
  r.name || '',
  r.phone || '',
  r.oldestDue ? fmtDay(r.oldestDue) : '—',
  fmt(r.overdueDays || 0),
  fmt(r.overdueInvoices || 0),
  money(r.overdueAmount || 0),
  money(r.balance || 0),
];

// Download a UTF-8 BOM CSV (opens correctly in Arabic Excel).
export function exportOverdueCustomers(rows, { bizName = 'النشاط', minDays = 0, minAmount = 0 } = {}) {
  const meta = [
    [`تقرير العملاء المتأخرين — ${bizName}`],
    [`تاريخ التقرير`, today()],
    [`حد أدنى لأيام التأخير`, String(minDays || '—')],
    [`حد أدنى للمبلغ المتأخر`, String(minAmount || '—')],
    [`عدد العملاء المتأخرين`, String(rows.length)],
    [],
  ];
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const body = [HEADERS, ...rows.map(rowValues)].map((line) => line.map(esc).join(','));
  const csv = '﻿' + [...meta.map((line) => line.map(esc).join(',')), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `العملاء-المتأخرون-${today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Open a print-ready Arabic window (the browser's print dialog can save as PDF).
export function printOverdueCustomers(rows, { bizName = 'النشاط', minDays = 0, minAmount = 0 } = {}) {
  const trs = rows.map((r) => `<tr>${rowValues(r).map((v, i) => `<td class="${i >= 3 ? 'num' : ''}">${v}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
    <title>العملاء المتأخرون — ${bizName}</title>
    <style>
      body{font-family:'Cairo',Tahoma,Arial,sans-serif;padding:24px;color:#111}
      h1{font-size:20px;margin:0 0 4px}
      .meta{color:#555;font-size:13px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}
      th{background:#f3f4f6}
      td.num{text-align:center}
      @media print{button{display:none}}
    </style></head><body>
    <h1>تقرير العملاء المتأخرين — ${bizName}</h1>
    <div class="meta">تاريخ التقرير: ${today()} · حد أدنى للتأخير: ${minDays || '—'} يوم · حد أدنى للمبلغ: ${minAmount ? money(minAmount) : '—'} · عدد العملاء: ${rows.length}</div>
    <table><thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${trs || `<tr><td colspan="7" style="text-align:center">لا توجد نتائج</td></tr>`}</tbody></table>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">🖨️ طباعة / حفظ PDF</button>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

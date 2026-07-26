import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, cancelInvoice, getSetting } from '../db';
import { money, fmt, fmtDate, can, waLink } from '../utils';
import { useAuth } from '../auth';

export default function InvoiceView() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const inv = useLiveQuery(() => db.invoices.get(Number(id)), [id]);
  const bizName = useLiveQuery(() => getSetting('bizName', 'خالد لقطع غيار المحمول'), [], 'خالد لقطع غيار المحمول');
  const party = useLiveQuery(
    () => (inv?.partyId ? (inv.type === 'sale' ? db.customers : db.suppliers).get(inv.partyId) : undefined),
    [inv?.partyId, inv?.type]
  );

  if (!inv) return <div className="card empty">جاري التحميل...</div>;

  const isSale = inv.type === 'sale';

  const waText = () => {
    let t = `*${bizName}*\nفاتورة ${isSale ? 'بيع' : 'شراء'} رقم: ${inv.number}\n`;
    t += `التاريخ: ${fmtDate(inv.createdAt)}\n`;
    if (inv.partyName) t += `${isSale ? 'العميل' : 'المورد'}: ${inv.partyName}\n`;
    t += `------------------\n`;
    inv.lines.forEach((l) => { t += `${l.name} × ${fmt(l.qty)} = ${fmt(l.qty * l.price)}\n`; });
    t += `------------------\n`;
    if (inv.discount > 0) t += `الخصم: ${money(inv.discount)}\n`;
    t += `*الإجمالي: ${money(inv.total)}*\n`;
    if (inv.remaining > 0) t += `المتبقي: ${money(inv.remaining)}\n`;
    t += `شكراً لتعاملكم معنا 🌹`;
    return t;
  };

  const doCancel = async () => {
    if (!confirm(`إلغاء الفاتورة ${inv.number}؟ سيتم عكس حركة المخزون والأرصدة.`)) return;
    await cancelInvoice(inv.id, user.name);
  };

  const exportPDF = () => {
    const win = window.open('', '_blank');
    if (!win) return alert('اسمح النافذة المنبثقة لتصدير PDF');
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>فاتورة ${inv.number}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Cairo', Tahoma, sans-serif; padding: 24px; color: #222; }
        .header { text-align: center; border-bottom: 3px solid #0F4C5C; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { font-size: 22px; color: #0F4C5C; }
        .header p { font-size: 13px; color: #666; margin-top: 4px; }
        .info { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        th { background: #0F4C5C; color: #fff; padding: 8px; font-size: 12px; }
        td { padding: 8px; border-bottom: 1px solid #eee; font-size: 13px; }
        .totals { width: 280px; margin-left: auto; }
        .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
        .totals .grand { border-top: 2px solid #0F4C5C; font-weight: 800; font-size: 16px; padding-top: 8px; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #888; }
        @media print { body { padding: 12px; } }
      </style>
    </head><body>
      <div class="header">
        <h1>${bizName}</h1>
        <p>فاتورة ${isSale ? 'بيع' : 'شراء'} رقم: ${inv.number}</p>
      </div>
      <div class="info">
        <div>
          <b>${isSale ? 'العميل' : 'المورد'}:</b> ${inv.partyName || 'نقدي'}<br/>
          <b>التاريخ:</b> ${fmtDate(inv.createdAt)}
        </div>
        <div style="text-align:left">
          <b>الموظف:</b> ${inv.userName}<br/>
          <b>رقم:</b> ${inv.number}
        </div>
      </div>
      <table>
        <thead><tr><th>الصنف</th><th>الكود</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>
          ${inv.lines.map((l) => `<tr><td>${l.name}</td><td>${l.code}</td><td>${fmt(l.qty)}</td><td>${fmt(l.price)}</td><td>${fmt(l.qty * l.price)}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="totals">
        <div class="row"><span>الإجمالي</span><span>${money(inv.subtotal)}</span></div>
        ${inv.discount > 0 ? `<div class="row"><span>الخصم</span><span>-${money(inv.discount)}</span></div>` : ''}
        <div class="row"><span>المدفوع</span><span>${money(inv.paid)}</span></div>
        ${inv.remaining > 0 ? `<div class="row" style="color:#e67e22"><span>المتبقي</span><span>${money(inv.remaining)}</span></div>` : ''}
        ${isSale ? `<div class="row" style="color:#27ae60"><span>الربح</span><span>${money(inv.profit)}</span></div>` : ''}
        <div class="row grand"><span>الصافي</span><span>${money(inv.total)}</span></div>
      </div>
      <div class="footer">شكراً لتعاملكم معنا — ${bizName}</div>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>`);
    win.document.close();
  };

  return (
    <>
      <div className="page-head">
        <h1>فاتورة {inv.number}</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={exportPDF}>📄 تصدير PDF</button>
          <button className="btn ghost" onClick={() => window.print()}>🖨️ طباعة</button>
          <a className="btn ghost" href={waLink(party?.phone, waText())} target="_blank" rel="noreferrer">
            📲 واتساب{party?.phone ? ' العميل' : ''}
          </a>
          {inv.status === 'active' && can(user.role, 'cancelInvoice') && (
            <button className="btn danger" onClick={doCancel}>إلغاء الفاتورة</button>
          )}
        </div>
      </div>

      {sp.get('new') && inv.status === 'active' && (
        <div className="card" style={{ borderColor: 'var(--green)', marginBottom: 14, color: 'var(--green)', fontWeight: 800 }}>
          ✅ تم حفظ الفاتورة بنجاح
        </div>
      )}
      {inv.status === 'cancelled' && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 14, color: 'var(--red)', fontWeight: 800 }}>
          ⛔ فاتورة ملغاة — بواسطة {inv.cancelledBy} في {fmtDate(inv.cancelledAt)}
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <p><b>{isSale ? 'العميل' : 'المورد'}:</b> {inv.partyName || 'نقدي'}</p>
          <p><b>التاريخ:</b> {fmtDate(inv.createdAt)}</p>
          <p><b>الموظف:</b> {inv.userName}</p>
        </div>
        <div className="card">
          <div className="totals">
            <div className="trow"><span>قبل الخصم</span><span className="num">{money(inv.subtotal)}</span></div>
            <div className="trow"><span>الخصم</span><span className="num">- {money(inv.discount)}</span></div>
            <div className="trow"><span>المدفوع</span><span className="num">{money(inv.paid)}</span></div>
            {inv.remaining > 0 && <div className="trow" style={{ color: 'var(--amber)' }}><span>المتبقي</span><span className="num">{money(inv.remaining)}</span></div>}
            {isSale && <div className="trow" style={{ color: 'var(--green)' }}><span>الربح</span><span className="num">{money(inv.profit)}</span></div>}
            <div className="trow grand"><span>الصافي</span><span className="num">{money(inv.total)}</span></div>
          </div>
        </div>
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table>
          <thead><tr><th>الصنف</th><th>الكود</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.name}</td>
                <td className="num muted">{l.code}</td>
                <td className="num">{fmt(l.qty)}</td>
                <td className="num">{fmt(l.price)}</td>
                <td className="num">{fmt(l.qty * l.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => nav(-1)}>→ رجوع</button>

      {/* print layout (80mm receipt friendly) */}
      <div className="print-area">
        <div className="invoice-print" dir="rtl">
          <h2>{bizName}</h2>
          <div className="ph">
            فاتورة {isSale ? 'بيع' : 'شراء'} رقم {inv.number}<br />
            {fmtDate(inv.createdAt)}<br />
            {inv.partyName ? `${isSale ? 'العميل' : 'المورد'}: ${inv.partyName}` : 'عميل نقدي'}
          </div>
          <table>
            <thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i}><td>{l.name}</td><td>{fmt(l.qty)}</td><td>{fmt(l.price)}</td><td>{fmt(l.qty * l.price)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="tot">
            {inv.discount > 0 && <>الخصم: {money(inv.discount)}<br /></>}
            الإجمالي: {money(inv.total)}<br />
            المدفوع: {money(inv.paid)}
            {inv.remaining > 0 && <><br />المتبقي: {money(inv.remaining)}</>}
          </div>
          <div className="ph" style={{ marginTop: 8 }}>شكراً لتعاملكم معنا</div>
        </div>
      </div>
    </>
  );
}

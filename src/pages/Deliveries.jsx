import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, nowISO, queueSync } from '../db';
import { money, fmt, fmtDate } from '../utils';
import { Modal, Toast } from '../components/UI';

const STATUS_MAP = {
  pending: { label: 'بانتظار التوصيل', color: 'var(--amber)' },
  in_transit: { label: 'في الطريق', color: 'var(--primary)' },
  delivered: { label: 'تم التوصيل', color: 'var(--green)' },
  returned: { label: 'مرتجع', color: 'var(--red)' },
};

export default function Deliveries() {
  const invoices = useLiveQuery(
    () => db.invoices.where('type').equals('sale').and((i) => i.status === 'active').toArray(),
    [], []
  );
  const deliveries = useLiveQuery(() => db.deliveries.toArray(), [], []);
  const [filter, setFilter] = useState('all');
  const [assignFor, setAssignFor] = useState(null);
  const [toast, setToast] = useState('');
  const [driverName, setDriverName] = useState('');

  const show = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const enriched = useMemo(() => {
    const deliveryMap = {};
    (deliveries || []).forEach((d) => { deliveryMap[d.invoiceId] = d; });

    let list = (invoices || []).map((inv) => ({
      ...inv,
      delivery: deliveryMap[inv.id] || null,
      status: deliveryMap[inv.id]?.status || 'pending',
    }));

    if (filter === 'pending') list = list.filter((r) => r.status === 'pending');
    else if (filter === 'in_transit') list = list.filter((r) => r.status === 'in_transit');
    else if (filter === 'delivered') list = list.filter((r) => r.status === 'delivered');
    else if (filter === 'unassigned') list = list.filter((r) => !r.delivery);

    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [invoices, deliveries, filter]);

  const stats = useMemo(() => {
    const all = (deliveries || []).map((d) => d.status);
    return {
      total: enriched.length,
      pending: all.filter((s) => s === 'pending').length,
      in_transit: all.filter((s) => s === 'in_transit').length,
      delivered: all.filter((s) => s === 'delivered').length,
    };
  }, [enriched, deliveries]);

  const assignDriver = async () => {
    if (!driverName.trim() || !assignFor) return;
    const existing = await db.deliveries.where('invoiceId').equals(assignFor.id).first();
    if (existing) {
      await db.deliveries.update(existing.id, { driverName: driverName.trim(), status: 'in_transit' });
    } else {
      await db.deliveries.add({
        invoiceId: assignFor.id,
        driverName: driverName.trim(),
        status: 'in_transit',
        createdAt: nowISO(),
      });
    }
    await queueSync('deliveries', 'assign', { invoiceId: assignFor.id });
    setAssignFor(null);
    setDriverName('');
    show(`✅ تم تعيين ${driverName} لتوصيل الفاتورة ${assignFor.number}`);
  };

  const updateStatus = async (invId, newStatus) => {
    const existing = await db.deliveries.where('invoiceId').equals(invId).first();
    if (existing) {
      await db.deliveries.update(existing.id, { status: newStatus, updatedAt: nowISO() });
    } else {
      await db.deliveries.add({ invoiceId: invId, status: newStatus, createdAt: nowISO() });
    }
    await queueSync('deliveries', 'status', { invoiceId: invId, status: newStatus });
    show(`✅ تم تحديث الحالة إلى: ${STATUS_MAP[newStatus]?.label}`);
  };

  return (
    <>
      <div className="page-head">
        <h1>🚚 التوصيل والمندوبين</h1>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">الطلبات</div><div className="value">{stats.total}</div></div>
        <div className="kpi" style={{ borderColor: 'var(--amber)' }}><div className="label">بانتظار</div><div className="value">{stats.pending}</div></div>
        <div className="kpi tone-accent"><div className="label">في الطريق</div><div className="value">{stats.in_transit}</div></div>
        <div className="kpi tone-green"><div className="label">تم التوصيل</div><div className="value">{stats.delivered}</div></div>
      </div>

      <div className="list-tools">
        <select className="input" style={{ maxWidth: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل الطلبات ({stats.total})</option>
          <option value="unassigned">لم يتم التعيين</option>
          <option value="pending">بانتظار التوصيل</option>
          <option value="in_transit">في الطريق</option>
          <option value="delivered">تم التوصيل</option>
        </select>
      </div>

      {enriched.length === 0 ? (
        <div className="card empty"><div className="big-ico">🚚</div><p>لا توجد فواتير للتوصيل</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>رقم الفاتورة</th><th>العميل</th><th>الإجمالي</th><th>المندوب</th><th>الحالة</th><th>التاريخ</th><th></th></tr>
            </thead>
            <tbody>
              {enriched.map((r) => {
                const st = STATUS_MAP[r.status] || STATUS_MAP.pending;
                return (
                  <tr key={r.id}>
                    <td className="num">{r.number}</td>
                    <td><b>{r.partyName || '—'}</b></td>
                    <td className="num">{money(r.total)}</td>
                    <td>{r.delivery?.driverName || <span className="muted">—</span>}</td>
                    <td><span className="badge" style={{ background: st.color, color: '#fff' }}>{st.label}</span></td>
                    <td className="muted">{fmtDate(r.createdAt)}</td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {!r.delivery?.driverName && (
                        <button className="btn sm" onClick={() => { setAssignFor(r); setDriverName(''); }}>تعيين مندوب</button>
                      )}
                      {r.status !== 'delivered' && r.delivery?.driverName && (
                        <button className="btn ghost sm" style={{ color: 'var(--green)' }}
                          onClick={() => updateStatus(r.id, 'delivered')}>✅ تم</button>
                      )}
                      {r.status === 'pending' && (
                        <button className="btn ghost sm" onClick={() => updateStatus(r.id, 'in_transit')}>
                          🚗 في الطريق
                        </button>
                      )}
                      {r.status !== 'returned' && r.status === 'delivered' && (
                        <button className="btn ghost sm" style={{ color: 'var(--red)' }}
                          onClick={() => updateStatus(r.id, 'returned')}>↩️ مرتجع</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {assignFor && (
        <Modal title={`تعيين مندوب — فاتورة ${assignFor.number}`} onClose={() => setAssignFor(null)}>
          <p className="muted">العميل: {assignFor.partyName || 'نقدي'} · الإجمالي: {money(assignFor.total)}</p>
          <div className="field">
            <label>اسم المندوب *</label>
            <input className="input" value={driverName} onChange={(e) => setDriverName(e.target.value)}
              placeholder="اسم المندوب أو سائق السيارة" autoFocus />
          </div>
          <button className="btn block" onClick={assignDriver} disabled={!driverName.trim()}>🚗 تعيين وبدء التوصيل</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}

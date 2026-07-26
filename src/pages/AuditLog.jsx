import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { fmtDate } from '../utils';

const ACTION_LABELS = {
  create: { label: 'إنشاء', color: 'var(--green)' },
  update: { label: 'تعديل', color: 'var(--amber)' },
  cancel: { label: 'إلغاء', color: 'var(--red)' },
  delete: { label: 'حذف', color: 'var(--red)' },
  payment: { label: 'دفعة', color: 'var(--primary)' },
};

const ENTITY_LABELS = {
  invoice: 'فاتورة',
  item: 'صنف',
  customer: 'عميل',
  supplier: 'مورد',
  expense: 'مصروف',
  employee: 'موظف',
  user: 'مستخدم',
};

export default function AuditLog() {
  const logs = useLiveQuery(() => db.auditLog.orderBy('createdAt').reverse().toArray(), [], []);
  const [q, setQ] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const filtered = useMemo(() => {
    let l = logs || [];
    const t = q.trim().toLowerCase();
    if (t) l = l.filter((r) =>
      (r.userName || '').toLowerCase().includes(t) ||
      (r.entityType || '').includes(t) ||
      (r.action || '').includes(t) ||
      JSON.stringify(r.details || '').toLowerCase().includes(t)
    );
    if (entityFilter) l = l.filter((r) => r.entityType === entityFilter);
    if (actionFilter) l = l.filter((r) => r.action === actionFilter);
    return l;
  }, [logs, q, entityFilter, actionFilter]);

  const entities = useMemo(() => [...new Set((logs || []).map((r) => r.entityType))].filter(Boolean), [logs]);

  return (
    <>
      <div className="page-head">
        <h1>📋 سجل النشاطات <span className="muted" style={{ fontSize: 14 }}>({logs?.length || 0})</span></h1>
      </div>

      <div className="list-tools">
        <input className="input" placeholder="🔍 بحث..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ maxWidth: 140 }} value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
          <option value="">كل الأنواع</option>
          {entities.map((e) => <option key={e} value={e}>{ENTITY_LABELS[e] || e}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 140 }} value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="">كل العمليات</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty"><div className="big-ico">📋</div><p>لا توجد نشاطات بعد</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>التاريخ</th><th>العملية</th><th>النوع</th><th>المستخدم</th><th>التفاصيل</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const act = ACTION_LABELS[r.action] || { label: r.action, color: 'var(--text)' };
                return (
                  <tr key={r.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.createdAt)}</td>
                    <td><span className="badge" style={{ background: act.color, color: '#fff' }}>{act.label}</span></td>
                    <td>{ENTITY_LABELS[r.entityType] || r.entityType} {r.entityId ? <span className="muted">#{r.entityId}</span> : ''}</td>
                    <td>{r.userName || '—'}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.details ? (typeof r.details === 'string' ? r.details : JSON.stringify(r.details)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

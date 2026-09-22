import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db, getSetting, stockOf, today } from '../db';
import { money, fmt } from '../utils';
import { useAuth } from '../auth';

export default function Alerts() {
  const { activeBranch } = useAuth();
  const nav = useNavigate();
  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const customers = useLiveQuery(() => db.customers.toArray(), [], []);
  const plans = useLiveQuery(() => db.installmentPlans.toArray(), [], []);
  const nearExpiryDays = useLiveQuery(() => getSetting('nearExpiryDays', 60), [], 60);
  const t = today();

  const lowStock = useMemo(() => items.filter((it) => stockOf(it, activeBranch) <= (it.minStock || 0) && (it.minStock || 0) > 0), [items, activeBranch]);
  const nearExpiry = useMemo(() => items.filter((it) => it.expiry && Math.floor((new Date(it.expiry) - new Date(t)) / 86400000) <= Number(nearExpiryDays)), [items, t, nearExpiryDays]);
  const overLimit = useMemo(() => customers.filter((c) => (c.creditLimit || 0) > 0 && (c.balance || 0) > c.creditLimit), [customers]);
  const overdueInstallments = useMemo(() => {
    const out = [];
    for (const p of plans) {
      if (p.status !== 'active') continue;
      for (const i of (p.installments || [])) if (i.status !== 'paid' && i.dueDate < t) out.push({ p, i });
    }
    return out;
  }, [plans, t]);
  const topDebtors = useMemo(() => customers.filter((c) => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance).slice(0, 5), [customers]);

  const Section = ({ icon, title, count, tone, to, children }) => (
    <div className="card" style={{ marginBottom: 12, borderColor: count > 0 ? `var(--${tone})` : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: to ? 'pointer' : 'default' }} onClick={() => to && nav(to)}>
        <b>{icon} {title}</b>
        <span className={`badge ${count > 0 ? tone : 'green'}`}>{count > 0 ? count : 'لا يوجد'}</span>
      </div>
      {count > 0 && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );

  const total = lowStock.length + nearExpiry.length + overLimit.length + overdueInstallments.length;

  return (
    <>
      <div className="page-head"><h1>🔔 التنبيهات <span className="muted" style={{ fontSize: 14 }}>({total})</span></h1></div>

      {total === 0 && (
        <div className="card" style={{ borderColor: 'var(--green)', color: 'var(--green)', fontWeight: 700 }}>✅ كل شيء تمام — لا توجد تنبيهات حالياً</div>
      )}

      <Section icon="📉" title="أصناف وصلت الحد الأدنى" count={lowStock.length} tone="red" to="/items">
        {lowStock.slice(0, 10).map((it) => (
          <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
            <span>{it.name}</span><b className="num" style={{ color: 'var(--red)' }}>{fmt(stockOf(it, activeBranch))} / حد {fmt(it.minStock)}</b>
          </div>
        ))}
      </Section>

      <Section icon="📅" title="أصناف قرب انتهاء الصلاحية" count={nearExpiry.length} tone="amber" to="/inventory-ops">
        {nearExpiry.slice(0, 10).map((it) => (
          <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
            <span>{it.name}</span><b className="num">{it.expiry}</b>
          </div>
        ))}
      </Section>

      <Section icon="⏰" title="أقساط متأخرة" count={overdueInstallments.length} tone="red" to="/installments">
        {overdueInstallments.slice(0, 10).map(({ p, i }) => (
          <div key={p.id + '_' + i.no} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
            <span>{p.customerName} — قسط #{i.no} ({i.dueDate})</span><b className="num" style={{ color: 'var(--red)' }}>{money(i.amount - (i.paidAmount || 0))}</b>
          </div>
        ))}
      </Section>

      <Section icon="💳" title="عملاء تجاوزوا الحد الائتماني" count={overLimit.length} tone="amber" to="/customers">
        {overLimit.slice(0, 10).map((c) => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
            <span>{c.name}</span><b className="num" style={{ color: 'var(--red)' }}>{money(c.balance)} / حد {money(c.creditLimit)}</b>
          </div>
        ))}
      </Section>

      {topDebtors.length > 0 && (
        <div className="card">
          <b>👥 أكبر المدينين</b>
          <div style={{ marginTop: 8 }}>
            {topDebtors.map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}>
                <span>{c.name}</span><b className="num" style={{ color: 'var(--red)' }}>{money(c.balance)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

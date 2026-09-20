import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, today, createAsset, runDepreciation, disposeAsset, assetMonthlyDep, assetBookValue } from '../db';
import { money, fmt, fmtDay } from '../utils';
import { Modal, Toast } from '../components/UI';
import { useAuth } from '../auth';

const EMPTY = { name: '', category: '', cost: '', salvage: '', usefulYears: '5', purchaseDate: today(), recordPurchase: true, cashRole: 'cash' };

export default function Assets() {
  const { user, activeBranch } = useAuth();
  const assets = useLiveQuery(() => db.assets.orderBy('createdAt').reverse().toArray(), [], []);
  const [form, setForm] = useState(null);
  const [disposeFor, setDisposeFor] = useState(null);
  const [toast, setToast] = useState('');
  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2800); };

  const active = assets.filter((a) => a.status === 'active');
  const totals = useMemo(() => ({
    cost: active.reduce((s, a) => s + (Number(a.cost) || 0), 0),
    accum: active.reduce((s, a) => s + (Number(a.accumulatedDep) || 0), 0),
    book: active.reduce((s, a) => s + assetBookValue(a), 0),
    monthly: active.reduce((s, a) => s + assetMonthlyDep(a), 0),
  }), [active]);

  const save = async () => {
    await createAsset({
      name: form.name, category: form.category, cost: Number(form.cost) || 0, salvage: Number(form.salvage) || 0,
      usefulYears: Number(form.usefulYears) || 1, purchaseDate: form.purchaseDate, branchId: activeBranch,
      recordPurchase: form.recordPurchase, cashRole: form.cashRole, userName: user.name,
    });
    notify('✅ تم إضافة الأصل');
    setForm(null);
  };

  const depreciate = async () => {
    const res = await runDepreciation(today().slice(0, 7), user.name);
    notify(res.count ? `✅ تم إهلاك ${res.count} أصل بإجمالي ${money(res.total)} لشهر ${res.month}` : 'لا يوجد إهلاك مستحق هذا الشهر (تم بالفعل أو لا توجد أصول)');
  };

  const doDispose = async (dv) => {
    await disposeAsset(disposeFor.id, Number(dv) || 0, user.name);
    notify('✅ تم استبعاد الأصل');
    setDisposeFor(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>🏛️ الأصول الثابتة</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={depreciate}>🗓️ تسجيل إهلاك الشهر</button>
          <button className="btn accent" onClick={() => setForm({ ...EMPTY, purchaseDate: today() })}>＋ أصل جديد</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="label">التكلفة الإجمالية</div><div className="value">{money(totals.cost)}</div></div>
        <div className="kpi tone-red"><div className="label">مجمع الإهلاك</div><div className="value">{money(totals.accum)}</div></div>
        <div className="kpi tone-green"><div className="label">القيمة الدفترية</div><div className="value">{money(totals.book)}</div></div>
        <div className="kpi"><div className="label">إهلاك شهري</div><div className="value">{money(totals.monthly)}</div></div>
      </div>

      {assets.length === 0 ? (
        <div className="card empty"><div className="big-ico">🏛️</div><p>لا توجد أصول — أضف سيارة / جهاز / معدة وسجّل إهلاكها تلقائياً</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>الأصل</th><th>التكلفة</th><th>العمر</th><th>إهلاك شهري</th><th>مجمع الإهلاك</th><th>القيمة الدفترية</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b>{a.category && <div className="meta muted">{a.category}</div>}<div className="meta muted">شراء: {a.purchaseDate}</div></td>
                  <td className="num">{money(a.cost)}</td>
                  <td className="num muted">{a.usefulYears} سنة</td>
                  <td className="num">{money(assetMonthlyDep(a))}</td>
                  <td className="num" style={{ color: 'var(--red)' }}>{money(a.accumulatedDep || 0)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(assetBookValue(a))}</td>
                  <td>{a.status === 'disposed' ? <span className="badge gray">مُستبعد</span> : <span className="badge green">نشط</span>}</td>
                  <td>{a.status === 'active' && <button className="btn ghost sm" onClick={() => setDisposeFor(a)}>استبعاد</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal title="أصل ثابت جديد" onClose={() => setForm(null)}>
          <div className="row">
            <div className="field"><label>اسم الأصل *</label>
              <input className="input" value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="سيارة توصيل / جهاز / معدة" /></div>
            <div className="field"><label>التصنيف</label>
              <input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="سيارات / أجهزة..." /></div>
          </div>
          <div className="row">
            <div className="field"><label>التكلفة *</label>
              <input className="input lg" type="number" min="0" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
            <div className="field"><label>قيمة الخردة (نهاية العمر)</label>
              <input className="input" type="number" min="0" value={form.salvage} onChange={(e) => setForm({ ...form, salvage: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="row">
            <div className="field"><label>العمر الإنتاجي (سنوات) *</label>
              <input className="input" type="number" min="1" value={form.usefulYears} onChange={(e) => setForm({ ...form, usefulYears: e.target.value })} /></div>
            <div className="field"><label>تاريخ الشراء</label>
              <input className="input" type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></div>
          </div>
          {Number(form.cost) > 0 && Number(form.usefulYears) > 0 && (
            <p className="muted">الإهلاك الشهري (قسط ثابت) ≈ <b>{money(Math.max(0, (Number(form.cost) - (Number(form.salvage) || 0))) / (Number(form.usefulYears) * 12))}</b></p>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.recordPurchase} onChange={(e) => setForm({ ...form, recordPurchase: e.target.checked })} />
            تسجيل قيد الشراء (خصم من الخزينة/البنك)
          </label>
          {form.recordPurchase && (
            <div className="field"><label>مصدر الدفع</label>
              <select className="input" value={form.cashRole} onChange={(e) => setForm({ ...form, cashRole: e.target.value })}>
                <option value="cash">الصندوق (نقدي)</option>
                <option value="bank">البنك</option>
              </select></div>
          )}
          <button className="btn accent block" onClick={save} disabled={!form.name.trim() || !(Number(form.cost) > 0)}>💾 حفظ</button>
        </Modal>
      )}

      {disposeFor && <DisposeModal asset={disposeFor} onDispose={doDispose} onClose={() => setDisposeFor(null)} />}

      <Toast msg={toast} />
    </>
  );
}

function DisposeModal({ asset, onDispose, onClose }) {
  const [dv, setDv] = useState('');
  const book = assetBookValue(asset);
  const diff = book - (Number(dv) || 0);
  return (
    <Modal title={`استبعاد أصل: ${asset.name}`} onClose={onClose}>
      <p className="muted">القيمة الدفترية الحالية: <b>{money(book)}</b></p>
      <div className="field"><label>قيمة البيع / الاستبعاد (نقدي)</label>
        <input className="input lg" type="number" min="0" value={dv} onChange={(e) => setDv(e.target.value)} autoFocus placeholder="0" /></div>
      {dv !== '' && (
        <p style={{ color: diff > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
          {diff > 0 ? `خسارة استبعاد: ${money(diff)}` : diff < 0 ? `ربح استبعاد: ${money(-diff)}` : 'بدون ربح أو خسارة'}
        </p>
      )}
      <button className="btn danger block" onClick={() => onDispose(dv)}>تأكيد الاستبعاد</button>
    </Modal>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveInvoice, nowISO } from '../db';
import { money, fmt } from '../utils';
import { useAuth } from '../auth';
import { Modal, Toast } from './UI';

export default function InvoiceEditor({ type }) {
  const isSale = type === 'sale';
  const nav = useNavigate();
  const { user } = useAuth();
  const searchRef = useRef(null);

  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const parties = useLiveQuery(
    () => (isSale ? db.customers.toArray() : db.suppliers.toArray()),
    [isSale], []
  );

  const [q, setQ] = useState('');
  const [lines, setLines] = useState([]);
  const [partyId, setPartyId] = useState('');
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [paidTouched, setPaidTouched] = useState(false);
  const [showNewParty, setShowNewParty] = useState(false);
  const [newParty, setNewParty] = useState({ name: '', phone: '', address: '' });
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return items
      .filter((it) =>
        (it.name || '').toLowerCase().includes(t) ||
        (it.code || '').toLowerCase().includes(t) ||
        (it.barcode || '') === t
      )
      .slice(0, 12);
  }, [q, items]);

  const addItem = (it) => {
    setLines((ls) => {
      const ex = ls.find((l) => l.itemId === it.id);
      if (ex) return ls.map((l) => (l.itemId === it.id ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...ls,
        {
          itemId: it.id,
          name: it.name,
          code: it.code,
          qty: 1,
          price: isSale ? it.salePrice || 0 : it.costPrice || 0,
          cost: it.costPrice || 0,
          stock: it.stock || 0,
        },
      ];
    });
    setQ('');
    searchRef.current?.focus();
  };

  const onSearchEnter = () => {
    // barcode scanners send the code + Enter
    const exact = items.find((it) => it.barcode === q.trim() || it.code === q.trim());
    if (exact) return addItem(exact);
    if (results.length === 1) addItem(results[0]);
  };

  const setLine = (itemId, patch) =>
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));
  const removeLine = (itemId) => setLines((ls) => ls.filter((l) => l.itemId !== itemId));

  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const disc = Number(discount) || 0;
  const total = Math.max(0, subtotal - disc);
  const paidNum = paidTouched ? Number(paid) || 0 : total;
  const remaining = Math.max(0, total - paidNum);
  const profit = isSale ? lines.reduce((s, l) => s + l.qty * (l.price - l.cost), 0) - disc : 0;

  const save = async () => {
    if (lines.length === 0) return;
    if (remaining > 0 && !partyId) {
      setToast(isSale ? 'البيع الآجل يحتاج اختيار عميل' : 'الشراء الآجل يحتاج اختيار مورد');
      setTimeout(() => setToast(''), 2500);
      return;
    }
    setSaving(true);
    const party = parties.find((p) => p.id === Number(partyId));
    const { id } = await saveInvoice({
      type,
      partyId: party ? party.id : null,
      partyName: party ? party.name : null,
      lines: lines.map(({ stock, ...l }) => ({ ...l, qty: Number(l.qty) || 0, price: Number(l.price) || 0 })),
      subtotal,
      discount: disc,
      total,
      paid: paidNum,
      remaining,
      profit,
      userId: user.id,
      userName: user.name,
    });
    nav(`/invoices/${id}?new=1`);
  };

  const saveNewParty = async () => {
    if (!newParty.name.trim()) return;
    const table = isSale ? db.customers : db.suppliers;
    const id = await table.add({ ...newParty, balance: 0, createdAt: nowISO() });
    setPartyId(String(id));
    setShowNewParty(false);
    setNewParty({ name: '', phone: '', address: '' });
  };

  return (
    <>
      <div className="page-head">
        <h1>{isSale ? '🧾 فاتورة بيع جديدة' : '📥 فاتورة شراء جديدة'}</h1>
      </div>

      <div className="pos-grid">
        {/* right: search + cart */}
        <div className="card">
          <div className="search-results">
            <input
              ref={searchRef}
              className="input lg"
              placeholder="🔍 ابحث بالاسم أو الكود أو امسح الباركود..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
              autoFocus
            />
            {results.length > 0 && (
              <div className="search-drop">
                {results.map((it) => (
                  <div key={it.id} className="search-item" onClick={() => addItem(it)}>
                    <div>
                      <b>{it.name}</b>
                      <div className="meta">{it.code} · {it.brand || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <b className="num">{money(isSale ? it.salePrice : it.costPrice)}</b>
                      <div className="meta">رصيد: {fmt(it.stock)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            {lines.length === 0 ? (
              <div className="empty">
                <div className="big-ico">🛒</div>
                <p>ابحث عن صنف لإضافته للفاتورة</p>
              </div>
            ) : (
              <>
                <div className="cart-line" style={{ borderBottom: '2px solid var(--line)' }}>
                  <b className="muted">الصنف</b>
                  <b className="muted" style={{ textAlign: 'center' }}>الكمية</b>
                  <b className="muted" style={{ textAlign: 'center' }}>السعر</b>
                  <b className="muted" style={{ textAlign: 'center' }}>الإجمالي</b>
                  <span />
                </div>
                {lines.map((l) => (
                  <div key={l.itemId} className="cart-line">
                    <div className="name">
                      {l.name}
                      <small>
                        {l.code}
                        {isSale && l.qty > l.stock && (
                          <span style={{ color: 'var(--red)', fontWeight: 700 }}> · الرصيد {fmt(l.stock)} فقط!</span>
                        )}
                      </small>
                    </div>
                    <input type="number" min="0" step="any" value={l.qty}
                      onChange={(e) => setLine(l.itemId, { qty: Number(e.target.value) })} />
                    <input type="number" min="0" step="any" value={l.price}
                      onChange={(e) => setLine(l.itemId, { price: Number(e.target.value) })} />
                    <div className="num" style={{ textAlign: 'center' }}>{fmt(l.qty * l.price)}</div>
                    <button className="x" onClick={() => removeLine(l.itemId)}>✕</button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* left: party + totals + save */}
        <div className="card">
          <div className="field">
            <label>{isSale ? 'العميل' : 'المورد'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">{isSale ? 'عميل نقدي' : 'اختر المورد'}</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button className="btn ghost sm" onClick={() => setShowNewParty(true)}>＋ جديد</button>
            </div>
          </div>

          <div className="row">
            <div className="field">
              <label>الخصم</label>
              <input className="input" type="number" min="0" value={discount}
                onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
            </div>
            <div className="field">
              <label>المدفوع</label>
              <input className="input" type="number" min="0"
                value={paidTouched ? paid : total || ''}
                onChange={(e) => { setPaidTouched(true); setPaid(e.target.value); }}
                placeholder={String(total)} />
            </div>
          </div>

          <div className="totals">
            <div className="trow"><span>الإجمالي قبل الخصم</span><span className="num">{money(subtotal)}</span></div>
            <div className="trow"><span>الخصم</span><span className="num">- {money(disc)}</span></div>
            {remaining > 0 && (
              <div className="trow" style={{ color: 'var(--amber)' }}>
                <span>المتبقي (آجل)</span><span className="num">{money(remaining)}</span>
              </div>
            )}
            {isSale && (
              <div className="trow" style={{ color: 'var(--green)' }}>
                <span>ربح الفاتورة</span><span className="num">{money(profit)}</span>
              </div>
            )}
            <div className="trow grand"><span>الصافي</span><span className="num">{money(total)}</span></div>
          </div>

          <button className="btn accent big block" style={{ marginTop: 14 }}
            onClick={save} disabled={lines.length === 0 || saving}>
            {saving ? '...جاري الحفظ' : '💾 حفظ الفاتورة'}
          </button>
        </div>
      </div>

      {showNewParty && (
        <Modal title={isSale ? 'عميل جديد' : 'مورد جديد'} onClose={() => setShowNewParty(false)}>
          <div className="field">
            <label>الاسم *</label>
            <input className="input" value={newParty.name}
              onChange={(e) => setNewParty({ ...newParty, name: e.target.value })} autoFocus />
          </div>
          <div className="field">
            <label>الهاتف</label>
            <input className="input" inputMode="tel" value={newParty.phone}
              onChange={(e) => setNewParty({ ...newParty, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>العنوان</label>
            <input className="input" value={newParty.address}
              onChange={(e) => setNewParty({ ...newParty, address: e.target.value })} />
          </div>
          <button className="btn block" onClick={saveNewParty} disabled={!newParty.name.trim()}>حفظ</button>
        </Modal>
      )}

      <Toast msg={toast} />
    </>
  );
}

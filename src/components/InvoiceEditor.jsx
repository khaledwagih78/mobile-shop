import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveInvoice, nowISO, stockOf } from '../db';
import { money, fmt, normAr } from '../utils';
import { useAuth } from '../auth';
import { Modal, Toast } from './UI';
import MicButton from './MicButton';

export default function InvoiceEditor({ type }) {
  const isSale = type === 'sale';
  const nav = useNavigate();
  const { user, activeBranch } = useAuth();
  const searchRef = useRef(null);

  const items = useLiveQuery(() => db.items.toArray(), [], []);
  const parties = useLiveQuery(
    () => (isSale ? db.customers.toArray() : db.suppliers.toArray()),
    [isSale], []
  );

  const [q, setQ] = useState('');
  const [lines, setLines] = useState([]);
  const [partyId, setPartyId] = useState('');
  const [partyQ, setPartyQ] = useState('');
  const [partyOpen, setPartyOpen] = useState(false);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [paidTouched, setPaidTouched] = useState(false);
  const [showNewParty, setShowNewParty] = useState(false);
  const [newParty, setNewParty] = useState({ name: '', phone: '', address: '' });
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const results = useMemo(() => {
    const t = normAr(q);
    if (!t) return [];
    const raw = q.trim();
    return items
      .filter((it) =>
        normAr(it.name).includes(t) ||
        normAr(it.code).includes(t) ||
        (it.brand && normAr(it.brand).includes(t)) ||
        (it.barcode || '') === raw
      )
      .slice(0, 12);
  }, [q, items]);

  const selectedParty = parties.find((p) => p.id === Number(partyId));
  const partyResults = useMemo(() => {
    const t = normAr(partyQ);
    const list = t
      ? parties.filter((p) => normAr(p.name).includes(t) || (p.phone || '').includes(partyQ.trim()))
      : parties;
    return list.slice(0, 8);
  }, [partyQ, parties]);

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
          stock: stockOf(it, activeBranch),
          wholesalePrice: it.wholesalePrice || 0,
          wholesaleMinQty: it.wholesaleMinQty || 0,
          unit: it.baseUnit || 'قطعة',
          factor: 1,
          baseUnit: it.baseUnit || 'قطعة',
          salePrice: it.salePrice || 0,
          costPrice: it.costPrice || 0,
          units: it.units || [],
        },
      ];
    });
    setQ('');
    searchRef.current?.focus();
  };

  const onSearchEnter = () => {
    const exact = items.find((it) => it.barcode === q.trim() || it.code === q.trim());
    if (exact) return addItem(exact);
    if (results.length === 1) addItem(results[0]);
  };

  const setLine = (itemId, patch) =>
    setLines((ls) => ls.map((l) => {
      if (l.itemId !== itemId) return l;
      const updated = { ...l, ...patch };
      // auto-switch to wholesale price when qty reaches threshold
      if (isSale && updated.wholesaleMinQty > 0 && updated.wholesalePrice > 0 && updated.qty >= updated.wholesaleMinQty) {
        updated.price = updated.wholesalePrice;
      }
      return updated;
    }));
  const removeLine = (itemId) => setLines((ls) => ls.filter((l) => l.itemId !== itemId));

  const changeUnit = (itemId, unitName) => setLines((ls) => ls.map((l) => {
    if (l.itemId !== itemId) return l;
    const all = [{ name: l.baseUnit || 'قطعة', factor: 1 }, ...(l.units || [])];
    const u = all.find((x) => x.name === unitName) || all[0];
    const factor = Number(u.factor) || 1;
    return { ...l, unit: u.name, factor, price: (isSale ? l.salePrice : l.costPrice) * factor, cost: (l.costPrice || 0) * factor };
  }));

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
      branchId: activeBranch,
      partyId: party ? party.id : null,
      partyName: party ? party.name : null,
      lines: lines.map(({ stock, wholesalePrice, wholesaleMinQty, baseUnit, salePrice, costPrice, units, ...l }) => ({ ...l, qty: Number(l.qty) || 0, price: Number(l.price) || 0, factor: Number(l.factor) || 1 })),
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
    const id = await table.add({ ...newParty, balance: 0, points: 0, totalSpent: 0, createdAt: nowISO() });
    setPartyId(String(id));
    setShowNewParty(false);
    setNewParty({ name: '', phone: '', address: '' });
  };

  const onBarcodeDetected = (code) => {
    setScanning(false);
    const it = items.find((i) => i.barcode === code || i.code === code);
    if (it) {
      addItem(it);
      setToast(`✅ تم إضافة: ${it.name}`);
    } else {
      setToast(`❌ لم يتم العثور على صنف بالكود: ${code}`);
    }
    setTimeout(() => setToast(''), 2500);
  };

  return (
    <>
      <div className="page-head">
        <h1>{isSale ? '🧾 فاتورة بيع جديدة' : '📥 فاتورة شراء جديدة'}</h1>
      </div>

      <div className="pos-grid">
        <div className="card">
          <div className="search-results">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={searchRef}
                className="input lg"
                placeholder="🔍 ابحث بالاسم أو الكود أو امسح الباركود..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
                autoFocus
                style={{ flex: 1 }}
              />
              {navigator.mediaDevices && (
                <button className="btn" onClick={() => setScanning(true)} title="مسح باركود بالكاميرا">📷</button>
              )}
              <MicButton size={44} title="ابحث عن منتج بصوتك" onResult={(t) => { setQ(t); searchRef.current?.focus(); }} />
            </div>
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
                      <div className="meta">رصيد: {fmt(stockOf(it, activeBranch))}</div>
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
                        {isSale && l.qty * (l.factor || 1) > l.stock && (
                          <span style={{ color: 'var(--red)', fontWeight: 700 }}> · الرصيد {fmt(l.stock)} فقط!</span>
                        )}
                        {isSale && l.wholesaleMinQty > 0 && l.qty < l.wholesaleMinQty && (
                          <span style={{ color: 'var(--amber)', fontSize: 11 }}> · جملة({l.wholesaleMinQty}+) {money(l.wholesalePrice)}</span>
                        )}
                      </small>
                      {(l.units && l.units.length > 0) && (
                        <select
                          value={l.unit}
                          onChange={(e) => changeUnit(l.itemId, e.target.value)}
                          style={{ marginTop: 4, fontSize: 12, padding: '2px 4px', maxWidth: 150 }}
                        >
                          {[{ name: l.baseUnit || 'قطعة', factor: 1 }, ...l.units].map((u) => (
                            <option key={u.name} value={u.name}>{u.name}{Number(u.factor) > 1 ? ` (${u.factor})` : ''}</option>
                          ))}
                        </select>
                      )}
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

        <div className="card">
          <div className="field">
            <label>{isSale ? 'العميل' : 'المورد'}</label>
            {selectedParty ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="input" style={{ flex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b>{selectedParty.name}</b>
                  <span className="muted" style={{ fontSize: 12 }}>{selectedParty.phone || ''}{selectedParty.points ? ` · ⭐${selectedParty.points}` : ''}</span>
                </div>
                <button className="btn ghost sm" title="تغيير" onClick={() => { setPartyId(''); setPartyQ(''); setPartyOpen(false); }}>✕</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input" style={{ flex: 1 }} value={partyQ}
                    placeholder={isSale ? '🔍 ابحث عن عميل (أو اتركه نقدي)' : '🔍 ابحث عن مورد'}
                    onChange={(e) => { setPartyQ(e.target.value); setPartyOpen(true); }}
                    onFocus={() => setPartyOpen(true)}
                  />
                  <MicButton title={isSale ? 'ابحث عن عميل بصوتك' : 'ابحث عن مورد بصوتك'} onResult={(t) => { setPartyQ(t); setPartyOpen(true); }} />
                  <button className="btn ghost sm" onClick={() => setShowNewParty(true)}>＋ جديد</button>
                </div>
                {partyOpen && partyResults.length > 0 && (
                  <div className="search-drop">
                    {partyResults.map((p) => (
                      <div key={p.id} className="search-item" onClick={() => { setPartyId(String(p.id)); setPartyOpen(false); }}>
                        <b>{p.name}</b>
                        <span className="meta">{p.phone || '—'}{p.points ? ` · ⭐${p.points}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {isSale && partyId && (() => {
            const party = parties.find((p) => p.id === Number(partyId));
            if (party && party.points > 0) {
              return (
                <div className="card" style={{ background: 'var(--bg)', marginBottom: 12, padding: 10, fontSize: 13 }}>
                  ⭐ نقاط العميل: <b>{party.points}</b> · إجمالي مشتريات: {money(party.totalSpent || 0)}
                </div>
              );
            }
            return null;
          })()}

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

      {scanning && <BarcodeScanner onDetected={onBarcodeDetected} onClose={() => setScanning(false)} />}

      <Toast msg={toast} />
    </>
  );
}

function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Use BarcodeDetector API if available
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'] });
        const detect = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            requestAnimationFrame(detect);
            return;
          }
          try {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0) {
              stopCamera();
              onDetected(barcodes[0].rawValue);
              return;
            }
          } catch {}
          requestAnimationFrame(detect);
        };
        detect();
      }
    } catch (err) {
      alert('لا يمكن فتح الكاميرا: ' + err.message);
      onClose();
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const handleManual = (e) => {
    if (e.key === 'Enter') {
      stopCamera();
      onDetected(e.target.value.trim());
    }
  };

  return (
    <Modal title="📷 مسح باركود" onClose={() => { stopCamera(); onClose(); }}>
      <div style={{ textAlign: 'center' }}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: '100%', maxWidth: 400, borderRadius: 8, background: '#000' }}
          onLoadedData={startCamera} />
        <p className="muted" style={{ margin: '10px 0' }}>
          وجّه الكاميرا نحو الباركود — يُمسح تلقائياً
        </p>
        <div className="field">
          <label>أو اكتب الكود يدوياً</label>
          <input className="input" placeholder="اكتب الكود واضغط Enter" onKeyDown={handleManual} autoFocus />
        </div>
      </div>
    </Modal>
  );
}

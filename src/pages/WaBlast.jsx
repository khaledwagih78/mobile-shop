import { useMemo, useState } from'react';
import { useLiveQuery } from'dexie-react-hooks';
import { db, getSetting } from'../db';
import { money, waLink, renderWaTpl, WA_TPL_DEFAULTS, WA_TPL_VARS } from'../utils';
import { MessageCircle, Send, Users, Check } from'lucide-react';

// إرسال واتساب جماعي: اختر النوع والفئة، عدّل الرسالة، وابعت لكل عميل بضغطة.
// واتساب (wa.me) بيفتح المحادثة والرسالة جاهزة — المستخدم يدوس إرسال (مفيش إرسال صامت بدون API مدفوع).
export default function WaBlast() {
  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [], []);
  const bizName = useLiveQuery(() => getSetting('bizName','نظام المبيعات والمخزون'), [],'نظام المبيعات والمخزون');
  const bizPhone = useLiveQuery(() => getSetting('bizPhone',''), [],'');
  const tplPromo = useLiveQuery(() => getSetting('waTplPromo', WA_TPL_DEFAULTS.promo), [], WA_TPL_DEFAULTS.promo);
  const tplDebt = useLiveQuery(() => getSetting('waTplDebt', WA_TPL_DEFAULTS.debt), [], WA_TPL_DEFAULTS.debt);

  const [kind, setKind] = useState('promo'); // 'promo' | 'debt'
  const [audience, setAudience] = useState('all'); // 'all' | 'debtors'
  const [msg, setMsg] = useState(null); // null => follow the template
  const [sent, setSent] = useState({}); // {customerId: true}

  // The active template (message box overrides it once the user edits).
  const activeTpl = kind ==='debt' ? (tplDebt || WA_TPL_DEFAULTS.debt) : (tplPromo || WA_TPL_DEFAULTS.promo);
  const text = msg === null ? activeTpl : msg;

  // Switching type/clearing edits re-syncs the box to the template.
  const pickKind = (k) => { setKind(k); setMsg(null); setSent({}); };

  const list = useMemo(() => {
    let l = (customers || []).filter((c) => (c.phone ||'').trim());
    if (audience ==='debtors' || kind ==='debt') l = l.filter((c) => (c.balance || 0) > 0);
    return l;
  }, [customers, audience, kind]);

  const noPhone = (customers || []).filter((c) => !(c.phone ||'').trim()).length;
  const sentCount = Object.keys(sent).length;

  const buildMsg = (c) => renderWaTpl(text, {
    name: c.name ||'', amount: money(c.balance || 0), shop: bizName, phone: bizPhone,
  });

  const open = (c) => {
    window.open(waLink(c.phone, buildMsg(c)),'_blank');
    setSent((s) => ({ ...s, [c.id]: true }));
  };

  const preview = list[0] ? buildMsg(list[0]) : renderWaTpl(text, { name:'العميل', amount: money(0), shop: bizName, phone: bizPhone });

  const insertVar = (v) => setMsg((text ||'') + v);

  return (
    <>
      <div className="page-head">
        <h1><MessageCircle size={20} style={{ verticalAlign:'-3px', color:'var(--green)' }} /> إرسال واتساب جماعي</h1>
      </div>

      <div className="card" style={{ background:'var(--chip, #eef4f6)', fontSize: 13 }}>
        واتساب بيفتح المحادثة والرسالة مكتوبة جاهزة — تدوس «إرسال» وترجع للي بعده. (الإرسال الصامت الكامل بيحتاج WhatsApp Business API مدفوع.)
      </div>

      <div className="row" style={{ gap: 16, alignItems:'flex-start', flexWrap:'wrap' }}>
        {/* يسار: إعداد الرسالة */}
        <div className="card" style={{ flex:'1 1 340px', minWidth: 300 }}>
          <div className="field">
            <label>نوع الرسالة</label>
            <div style={{ display:'flex', gap: 8 }}>
              <button className={`btn ${kind ==='promo' ?'' :'ghost'}`} onClick={() => pickKind('promo')} style={{ flex: 1 }}>عرض ترويجي</button>
              <button className={`btn ${kind ==='debt' ?'' :'ghost'}`} onClick={() => pickKind('debt')} style={{ flex: 1 }}>تذكير بالدين</button>
            </div>
          </div>

          <div className="field">
            <label>الفئة المستهدفة</label>
            <select className="input" value={kind ==='debt' ?'debtors' : audience} disabled={kind ==='debt'}
              onChange={(e) => setAudience(e.target.value)}>
              <option value="all">كل العملاء (اللي عندهم رقم)</option>
              <option value="debtors">المديونين فقط</option>
            </select>
            {kind ==='debt' && <small className="muted">تذكير الدين بيروح للمديونين تلقائياً.</small>}
          </div>

          <div className="field">
            <label>نص الرسالة</label>
            <textarea className="input" rows={7} value={text}
              onChange={(e) => setMsg(e.target.value)} />
            <div style={{ display:'flex', gap: 6, flexWrap:'wrap', marginTop: 6 }}>
              {WA_TPL_VARS.map((v) => (
                <button key={v.key} type="button" className="btn ghost sm" title={v.desc}
                  onClick={() => insertVar(v.key)}>{v.key}</button>
              ))}
              {msg !== null && (
                <button type="button" className="btn ghost sm" style={{ color:'var(--muted)' }}
                  onClick={() => setMsg(null)}>↺ القالب الافتراضي</button>
              )}
            </div>
          </div>

          <div className="field">
            <label>معاينة (لأول عميل)</label>
            <div style={{ whiteSpace:'pre-wrap', background:'var(--chip, #eef4f6)', borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 1.7 }}>
              {preview}
            </div>
          </div>
        </div>

        {/* يمين: قائمة العملاء */}
        <div className="card" style={{ flex:'2 1 420px', minWidth: 320 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 10, flexWrap:'wrap', gap: 8 }}>
            <b><Users size={15} style={{ verticalAlign:'-2px' }} /> {list.length} عميل</b>
            <span className="muted" style={{ fontSize: 13 }}>
              تم الإرسال: {sentCount} / {list.length}
              {noPhone > 0 && ` · ${noPhone} بدون رقم`}
            </span>
          </div>

          {list.length === 0 ? (
            <div className="empty">لا يوجد عملاء مطابقون {kind ==='debt' ?'(لا يوجد مديونون برقم هاتف)' :'برقم هاتف'}.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap: 6, maxHeight: 460, overflowY:'auto' }}>
              {list.map((c) => (
                <div key={c.id} style={{ display:'flex', alignItems:'center', gap: 8, padding:'7px 4px', borderBottom:'1px solid var(--line, #e5e5e5)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
                    <div className="muted num" style={{ fontSize: 12 }}>
                      {c.phone}{(c.balance || 0) > 0 && ` · عليه ${money(c.balance)}`}
                    </div>
                  </div>
                  <button className={`btn sm ${sent[c.id] ?'ghost' :''}`} onClick={() => open(c)}
                    style={sent[c.id] ? { color:'var(--green)' } : { background:'var(--green)', borderColor:'var(--green)' }}>
                    {sent[c.id] ? <><Check size={14} /> تم</> : <><Send size={14} /> إرسال</>}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

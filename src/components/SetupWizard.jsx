import { useState } from 'react';
import { setSetting } from '../db';
import { SECTORS } from '../sectors';
import { verifyLicenseCode, applyLicenseCode } from '../license';
import { getPlan } from '../plans';

// First-run setup wizard: shows once (until `setupDone` is set), walks a new
// shop through naming, sector, tax and credit terms, then configures the app to
// the tailored "final product" for that sector. Never appears again afterwards.
export default function SetupWizard({ onDone }) {
  const [step, setStep] = useState(0);
  const [bizName, setBizName] = useState('');
  const [sector, setSector] = useState('general');
  const [taxOn, setTaxOn] = useState(false);
  const [taxRate, setTaxRate] = useState('14');
  const [creditDays, setCreditDays] = useState('30');
  const [licenseCode, setLicenseCode] = useState('');
  const [licenseMsg, setLicenseMsg] = useState('');   // inline feedback (ok/err)
  const [licenseOk, setLicenseOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const total = 5;
  const next = () => setStep((s) => Math.min(total - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  // check the entered code on the activation step (optional)
  const checkCode = async () => {
    setLicenseMsg(''); setLicenseOk(false);
    const res = await verifyLicenseCode(licenseCode);
    if (res.valid) { setLicenseOk(true); setLicenseMsg(`✅ كود صالح — خطة ${getPlan(res.plan).name}${res.exp ? ` حتى ${res.exp}` : ''}`); }
    else { setLicenseMsg('❌ ' + (res.reason || 'الكود غير صحيح')); }
  };

  const finish = async () => {
    // if a code was entered, it must be valid before finishing
    if (licenseCode.trim()) {
      const res = await verifyLicenseCode(licenseCode);
      if (!res.valid) { setStep(4); setLicenseMsg('❌ ' + (res.reason || 'الكود غير صحيح')); return; }
    }
    setSaving(true);
    await setSetting('bizName', bizName.trim() || 'نظام المبيعات والمخزون');
    await setSetting('bizSector', sector);
    await setSetting('moduleOverrides', {}); // start from the sector's clean defaults
    await setSetting('taxEnabled', !!taxOn);
    await setSetting('taxName', 'ضريبة القيمة المضافة');
    await setSetting('taxRate', taxOn ? (Number(taxRate) || 0) : 0);
    await setSetting('creditDays', Number(creditDays) || 30);
    if (licenseCode.trim()) await applyLicenseCode(licenseCode); // upgrades the plan
    await setSetting('setupDone', true);
    import('../sync').then((m) => m.triggerSync()).catch(() => {});
    onDone && onDone();
  };

  const skip = async () => {
    setSaving(true);
    await setSetting('setupDone', true);
    onDone && onDone();
  };

  return (
    <div className="wizard-overlay" style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(15,76,92,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto' }}>
        {/* progress dots */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 5, borderRadius: 4, background: i <= step ? 'var(--accent, #0F4C5C)' : 'var(--line, #ddd)' }} />
          ))}
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>الخطوة {step + 1} من {total}</div>

        {step === 0 && (
          <div>
            <h2 style={{ marginTop: 0 }}>👋 أهلاً بيك</h2>
            <p className="muted">يلا نظبّط البرنامج لنشاطك في دقيقة. الأول، اسم المحل/النشاط:</p>
            <div className="field">
              <label>اسم النشاط</label>
              <input className="input lg" autoFocus value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="مثال: خالد لقطع غيار المحمول" />
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={{ marginTop: 0 }}>🧭 نشاطك إيه؟</h2>
            <p className="muted">هنظهرلك الأقسام اللي تخص مجالك بس، ونسمّي الشاشات بأسماء مناسبة.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
              {SECTORS.map((s) => {
                const active = sector === s.id;
                return (
                  <button key={s.id} className="card" onClick={() => setSector(s.id)} style={{
                    cursor: 'pointer', textAlign: 'right', padding: 10, margin: 0,
                    border: active ? '2px solid var(--accent, #0F4C5C)' : '1px solid var(--line, #ddd)',
                    background: active ? 'var(--bg, #f6f8f9)' : 'var(--card, #fff)',
                  }}>
                    <div style={{ fontSize: 22 }}>{s.ico}</div>
                    <b style={{ fontSize: 13 }}>{s.name}</b>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ marginTop: 0 }}>🧾 الضرايب</h2>
            <p className="muted">فيه ضريبة قيمة مضافة على مبيعاتك؟</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className={`btn ${!taxOn ? '' : 'ghost'}`} onClick={() => setTaxOn(false)}>لا، بدون ضريبة</button>
              <button className={`btn ${taxOn ? '' : 'ghost'}`} onClick={() => setTaxOn(true)}>نعم، فيه ضريبة</button>
            </div>
            {taxOn && (
              <div className="field">
                <label>نسبة الضريبة %</label>
                <input className="input lg" type="number" min="0" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="14" />
              </div>
            )}
            <p className="muted" style={{ fontSize: 12 }}>تقدر تغيّرها لاحقاً من الإعدادات.</p>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={{ marginTop: 0 }}>💳 البيع الآجل</h2>
            <p className="muted">لما تبيع بالآجل، العميل بياخد كام يوم يسدّد افتراضياً؟</p>
            <div className="field">
              <label>مدة الائتمان (أيام)</label>
              <input className="input lg" type="number" min="0" value={creditDays} onChange={(e) => setCreditDays(e.target.value)} placeholder="30" />
            </div>
            <p className="muted" style={{ fontSize: 12 }}>بتُستخدم في تاريخ استحقاق الفواتير وتنبيهات المتأخرين.</p>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 style={{ marginTop: 0 }}>💼 خطة البرنامج</h2>
            <p className="muted">
              البرنامج بيبدأ بالخطة <b>المجانية</b> (البيع والمخزون والعملاء والموردين والتقارير الأساسية).
              لو معاك <b>كود تفعيل</b> لخطة أعلى، ألصقه هنا — أو سيبه فارغ وكمّل مجاناً.
            </p>
            <div className="field">
              <label>🔑 كود التفعيل (اختياري)</label>
              <textarea className="input" rows="2" value={licenseCode}
                onChange={(e) => { setLicenseCode(e.target.value); setLicenseMsg(''); setLicenseOk(false); }}
                placeholder="ألصق كود التفعيل هنا لو معاك واحد..." style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </div>
            {licenseCode.trim() && <button className="btn ghost sm" onClick={checkCode}>تحقّق من الكود</button>}
            {licenseMsg && <p style={{ fontSize: 13, margin: '8px 0', color: licenseOk ? 'var(--green)' : 'var(--red)' }}>{licenseMsg}</p>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
          {step > 0 && <button className="btn ghost" onClick={back} disabled={saving}>‹ رجوع</button>}
          <button className="btn ghost sm" style={{ marginRight: 'auto' }} onClick={skip} disabled={saving}>تخطّي</button>
          {step < total - 1
            ? <button className="btn accent" onClick={next} disabled={saving}>التالي ›</button>
            : <button className="btn accent" onClick={finish} disabled={saving}>{saving ? '...' : 'يلا نبدأ ✅'}</button>}
        </div>
      </div>
    </div>
  );
}

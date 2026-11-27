import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { db, getSetting, setSetting } from '../db';
import { Toast } from '../components/UI';
import { PLANS, FEAT_LABELS, getPlan, isAiAllowed } from '../plans';
import { applyLicenseCode } from '../license';
import { WA_TPL_DEFAULTS, WA_TPL_VARS } from '../utils';
import { ShieldCheck, Sparkles, Check, Lock, CheckCircle2, Building, Users, FileSpreadsheet, Database, Sliders, Scale, FileText, ArrowLeftRight } from 'lucide-react';

export default function Settings() {
  const [bizName, setBizName] = useState('');
  const [usdRate, setUsdRate] = useState('');
  const [margin, setMargin] = useState('');
  const [opPassword, setOpPassword] = useState('');
  const [shop, setShop] = useState({ logo: '', address: '', phone: '', returnPolicy: '', warranty: '', repairTrackUrl: '' });
  const [waAuto, setWaAuto] = useState(false);
  const [waTpl, setWaTpl] = useState({ debt: WA_TPL_DEFAULTS.debt, promo: WA_TPL_DEFAULTS.promo, invoiceFooter: WA_TPL_DEFAULTS.invoiceFooter });
  const [preventOversell, setPreventOversell] = useState(true);
  const [tax, setTax] = useState({ enabled: false, name: 'ضريبة القيمة المضافة', rate: '' });
  const [alerts, setAlerts] = useState({
    nearExpiryDays: '60',
    overdueDays: '30',
    discountApprovalPct: '0',
    creditDays: '30',
    pointEGP: '1',
  });
  const [plan, setPlan] = useState('full');
  const [licenseExp, setLicenseExp] = useState(null);
  const [licenseCode, setLicenseCode] = useState('');
  const [activateInput, setActivateInput] = useState('');
  const [activateMsg, setActivateMsg] = useState('');
  const [toast, setToast] = useState('');

  const notify = (m) => {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  };

  const selectPlan = async (targetId) => {
    await setSetting('plan', targetId);
    setPlan(targetId);
    notify(`تم تعيين الباقة: ${getPlan(targetId).name}`);
  };

  const activate = async () => {
    setActivateMsg('');
    const res = await applyLicenseCode(activateInput);
    if (res.valid) {
      setPlan(res.plan);
      setLicenseExp(res.exp);
      setLicenseCode(activateInput.trim());
      setActivateInput('');
      const p = getPlan(res.plan);
      notify(`تم التفعيل بنجاح — خطة ${p.name}${res.exp ? ` حتى ${res.exp}` : ''}`);
    } else {
      setActivateMsg(res.reason || 'رمز التفعيل غير صالح');
    }
  };

  useEffect(() => {
    (async () => {
      setBizName(await getSetting('bizName', ''));
      setPlan(await getSetting('plan', 'pro'));
      setLicenseExp(await getSetting('licenseExp', null));
      setLicenseCode((await getSetting('licenseCode', '')) || '');
      setUsdRate((await getSetting('usdRate', '')) || '');
      setMargin((await getSetting('defaultMargin', '')) || '');
      setOpPassword((await getSetting('opPassword', '')) || '');
      setShop({
        logo: (await getSetting('bizLogo', '')) || '',
        address: (await getSetting('bizAddress', '')) || '',
        phone: (await getSetting('bizPhone', '')) || '',
        returnPolicy: (await getSetting('returnPolicy', '')) || '',
        warranty: (await getSetting('warranty', '')) || '',
        repairTrackUrl: (await getSetting('repairTrackUrl', '')) || '',
      });
      setWaAuto((await getSetting('waAutoSend', false)) === true);
      setWaTpl({
        debt: (await getSetting('waTplDebt', WA_TPL_DEFAULTS.debt)) || WA_TPL_DEFAULTS.debt,
        promo: (await getSetting('waTplPromo', WA_TPL_DEFAULTS.promo)) || WA_TPL_DEFAULTS.promo,
        invoiceFooter: (await getSetting('waTplInvoiceFooter', WA_TPL_DEFAULTS.invoiceFooter)) || WA_TPL_DEFAULTS.invoiceFooter,
      });
      setPreventOversell((await getSetting('preventOversell', true)) !== false);
      setTax({
        enabled: (await getSetting('taxEnabled', false)) === true,
        name: (await getSetting('taxName', 'ضريبة القيمة المضافة')) || 'ضريبة القيمة المضافة',
        rate: String((await getSetting('taxRate', 0)) || ''),
      });
      setAlerts({
        nearExpiryDays: String((await getSetting('nearExpiryDays', 60)) ?? 60),
        overdueDays: String((await getSetting('overdueDays', 30)) ?? 30),
        discountApprovalPct: String((await getSetting('discountApprovalPct', 0)) ?? 0),
        creditDays: String((await getSetting('creditDays', 30)) ?? 30),
        pointEGP: String((await getSetting('pointEGP', 1)) ?? 1),
      });
    })();
  }, []);

  const saveShop = async () => {
    await setSetting('bizLogo', shop.logo);
    await setSetting('bizAddress', shop.address.trim());
    await setSetting('bizPhone', shop.phone.trim());
    await setSetting('returnPolicy', shop.returnPolicy.trim());
    await setSetting('warranty', shop.warranty.trim());
    await setSetting('repairTrackUrl', (shop.repairTrackUrl || '').trim());
    notify('تم حفظ بيانات المنشأة بنجاح');
  };

  const onLogo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 500 * 1024) {
      notify('حجم الشعار كبير — يرجى اختيار ملف أقل من 500 كيلوبايت');
      return;
    }
    const r = new FileReader();
    r.onload = () => setShop((s) => ({ ...s, logo: r.result }));
    r.readAsDataURL(f);
  };

  const toggleWaAuto = async () => {
    const next = !waAuto;
    setWaAuto(next);
    await setSetting('waAutoSend', next);
    notify(next ? 'تم تفعيل فتح واتساب التلقائي' : 'تم تعطيل فتح واتساب التلقائي');
  };

  const saveWaTpl = async () => {
    await setSetting('waTplDebt', waTpl.debt);
    await setSetting('waTplPromo', waTpl.promo);
    await setSetting('waTplInvoiceFooter', waTpl.invoiceFooter);
    notify('تم حفظ قوالب رسائل واتساب');
  };

  const saveAlerts = async () => {
    await setSetting('nearExpiryDays', Number(alerts.nearExpiryDays) || 60);
    await setSetting('overdueDays', Number(alerts.overdueDays) || 30);
    await setSetting('discountApprovalPct', Number(alerts.discountApprovalPct) || 0);
    await setSetting('creditDays', Number(alerts.creditDays) || 30);
    await setSetting('pointEGP', Math.max(0, Number(alerts.pointEGP) || 0));
    notify('تم حفظ إعدادات التنبيهات والائتمان');
  };

  const saveTax = async () => {
    await setSetting('taxEnabled', !!tax.enabled);
    await setSetting('taxName', (tax.name || '').trim() || 'ضريبة القيمة المضافة');
    await setSetting('taxRate', Number(tax.rate) || 0);
    notify('تم حفظ الإعدادات الضريبية');
  };

  const saveGeneral = async () => {
    await setSetting('bizName', bizName.trim());
    await setSetting('usdRate', Number(usdRate) || 0);
    await setSetting('defaultMargin', Number(margin) || 0);
    await setSetting('opPassword', opPassword.trim());
    notify('تم حفظ الإعدادات العامة بنجاح');
  };

  const checkUpdate = async () => {
    notify('جاري التحقق من التحديثات...');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
    } catch {
      /* ignore */
    }
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <>
      <div className="page-head">
        <h1>الإعدادات</h1>
      </div>

      {/* Admin Quick Hub */}
      <div className="card" style={{ maxWidth: 740, borderRadius: 10, marginBottom: 16 }}>
        <h2 style={{ fontSize: 17, margin: '0 0 4px 0' }}>إدارة النظام والبيانات المتقدمة</h2>
        <p className="muted" style={{ margin: '0 0 14px 0', fontSize: 13 }}>
          الوصول السريع لإدارة الفروع، المستخدمين، استيراد وتصدير البيانات، والنسخ الاحتياطي
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          <NavLink to="/branches" className="card" style={{ margin: 0, padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line,#e2e8f0)', borderRadius: 10 }}>
            <div style={{ background: 'rgba(15,76,92,0.08)', padding: 8, borderRadius: 8, display: 'flex' }}>
              <Building size={18} color="var(--primary)" />
            </div>
            <div>
              <b style={{ fontSize: 13, display: 'block' }}>إدارة الفروع</b>
              <span className="muted" style={{ fontSize: 11 }}>إضافة وتعديل منافذ البيع</span>
            </div>
          </NavLink>

          <NavLink to="/import" className="card" style={{ margin: 0, padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line,#e2e8f0)', borderRadius: 10 }}>
            <div style={{ background: 'rgba(15,76,92,0.08)', padding: 8, borderRadius: 8, display: 'flex' }}>
              <FileSpreadsheet size={18} color="var(--primary)" />
            </div>
            <div>
              <b style={{ fontSize: 13, display: 'block' }}>استيراد من Excel</b>
              <span className="muted" style={{ fontSize: 11 }}>أصناف، عملاء، موردين</span>
            </div>
          </NavLink>

          <NavLink to="/users" className="card" style={{ margin: 0, padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line,#e2e8f0)', borderRadius: 10 }}>
            <div style={{ background: 'rgba(15,76,92,0.08)', padding: 8, borderRadius: 8, display: 'flex' }}>
              <Users size={18} color="var(--primary)" />
            </div>
            <div>
              <b style={{ fontSize: 13, display: 'block' }}>المستخدمون والصلاحيات</b>
              <span className="muted" style={{ fontSize: 11 }}>إدارة الحسابات والأدوار</span>
            </div>
          </NavLink>

          <NavLink to="/backup" className="card" style={{ margin: 0, padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line,#e2e8f0)', borderRadius: 10 }}>
            <div style={{ background: 'rgba(15,76,92,0.08)', padding: 8, borderRadius: 8, display: 'flex' }}>
              <Database size={18} color="var(--primary)" />
            </div>
            <div>
              <b style={{ fontSize: 13, display: 'block' }}>النسخ الاحتياطي</b>
              <span className="muted" style={{ fontSize: 11 }}>حفظ واسترجاع البيانات</span>
            </div>
          </NavLink>

          <NavLink to="/sector" className="card" style={{ margin: 0, padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line,#e2e8f0)', borderRadius: 10 }}>
            <div style={{ background: 'rgba(15,76,92,0.08)', padding: 8, borderRadius: 8, display: 'flex' }}>
              <Sliders size={18} color="var(--primary)" />
            </div>
            <div>
              <b style={{ fontSize: 13, display: 'block' }}>نشاط المنشأة</b>
              <span className="muted" style={{ fontSize: 11 }}>تخصيص الحقول والوحدات</span>
            </div>
          </NavLink>

          <NavLink to="/opening-balances" className="card" style={{ margin: 0, padding: 12, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', border: '1px solid var(--line,#e2e8f0)', borderRadius: 10 }}>
            <div style={{ background: 'rgba(15,76,92,0.08)', padding: 8, borderRadius: 8, display: 'flex' }}>
              <Scale size={18} color="var(--primary)" />
            </div>
            <div>
              <b style={{ fontSize: 13, display: 'block' }}>الأرصدة الافتتاحية</b>
              <span className="muted" style={{ fontSize: 11 }}>بداية النشاط والمخزون</span>
            </div>
          </NavLink>
        </div>
      </div>

      {/* Subscription Tiers & Edition */}
      <div className="card" style={{ maxWidth: 740, borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontSize: 17, margin: 0 }}>باقات واشتراكات النظام</h2>
            <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13 }}>
              اختر الباقة المناسبة لاحتياجات نشاطك التجاري
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: 13 }}>الباقة الحالية:</span>
            <span className={`badge ${plan === 'free' ? 'gray' : 'green'}`} style={{ fontSize: 12 }}>
              {getPlan(plan).name}
            </span>
            {licenseExp && <span className="badge gray" style={{ fontSize: 12 }}>صالحة حتى {licenseExp}</span>}
          </div>
        </div>

        {/* Tier Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14, marginBottom: 16 }}>
          {PLANS.map((tier) => {
            const active = getPlan(plan).id === tier.id;
            return (
              <div
                key={tier.id}
                style={{
                  border: active ? '2px solid var(--primary)' : '1px solid var(--line)',
                  borderRadius: 10,
                  padding: 16,
                  background: active ? 'rgba(15, 76, 92, 0.03)' : '#ffffff',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <b style={{ fontSize: 16 }}>{tier.name}</b>
                      {tier.hasAi && <Sparkles size={15} style={{ color: 'var(--primary)' }} />}
                    </div>
                    {tier.recommended && <span className="badge green" style={{ fontSize: 11 }}>موصى بها</span>}
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                      <b style={{ fontSize: 18, color: 'var(--primary)' }}>{tier.priceMonthly}</b>
                      {tier.priceYearly && <span className="muted" style={{ fontSize: 12 }}>/ شهرياً</span>}
                    </div>
                    {tier.priceYearly && <div className="muted" style={{ fontSize: 12 }}>أو {tier.priceYearly} سنوياً</div>}
                  </div>
                  <p className="muted" style={{ fontSize: 13, margin: '0 0 12px 0', lineHeight: 1.6 }}>{tier.desc}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#334155' }}>
                      <Check size={14} style={{ color: 'var(--green)' }} />
                      <span>الأساسيات: بيع وشراء ومخزون وعملاء وتقارير</span>
                    </div>
                    {tier.hasAi ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f4c5c', fontWeight: 600 }}>
                        <Sparkles size={14} style={{ color: 'var(--primary)' }} />
                        <span>الذكاء الاصطناعي مفعّل</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                        <Lock size={14} style={{ color: '#94a3b8' }} />
                        <span>الذكاء الاصطناعي (غير متضمن)</span>
                      </div>
                    )}
                    {(tier.feats || []).slice(0, 5).map((f) => (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#334155' }}>
                        <Check size={14} style={{ color: 'var(--green)' }} />
                        <span>{FEAT_LABELS[f] || f}</span>
                      </div>
                    ))}
                    {(tier.extras || []).map((x) => (
                      <div key={x} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                        <Lock size={14} style={{ color: '#94a3b8' }} />
                        <span>{x} <small>(قريباً)</small></span>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  className={`btn ${active ? 'ghost' : ''}`}
                  disabled={active}
                  onClick={() => selectPlan(tier.id)}
                  style={{ width: '100%', borderRadius: 8, fontSize: 13 }}
                >
                  {active ? 'الباقة المفعلة حالياً' : `التحويل لـ ${tier.name}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* License Activation Section */}
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14, marginTop: 14 }}>
          <div className="field">
            <label style={{ fontSize: 13, fontWeight: 600 }}>رمز التفعيل المشفّر (لتجديد الاشتراك أو التفعيل أوفلاين)</label>
            <textarea
              className="input"
              rows="2"
              value={activateInput}
              onChange={(e) => setActivateInput(e.target.value)}
              placeholder="أدخل رمز التفعيل هنا..."
              style={{ fontFamily: 'monospace', fontSize: 12, borderRadius: 8 }}
            />
          </div>
          {activateMsg && <p style={{ color: 'var(--red)', fontSize: 13, margin: '4px 0' }}>{activateMsg}</p>}
          <button className="btn accent" onClick={activate} disabled={!activateInput.trim()} style={{ borderRadius: 8 }}>
            تفعيل الترخيص
          </button>
        </div>
      </div>

      {/* Business & Pricing Information */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>البيانات العامة والتسعير</h2>
        <div className="field">
          <label>اسم المنشأة / النشاط (يظهر في الفواتير وشاشة الدخول)</label>
          <input
            className="input lg"
            value={bizName}
            onChange={(e) => setBizName(e.target.value)}
            placeholder="اسم الشركة أو المؤسسة"
          />
        </div>
        <div className="row">
          <div className="field">
            <label>سعر صرف الدولار (ج.م)</label>
            <input
              className="input lg"
              type="number"
              min="0"
              step="0.01"
              value={usdRate}
              onChange={(e) => setUsdRate(e.target.value)}
              placeholder="مثال: 48.5"
            />
          </div>
          <div className="field">
            <label>هامش الربح الافتراضي %</label>
            <input
              className="input lg"
              type="number"
              min="0"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
              placeholder="مثال: 30"
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          عند تسجيل تكلفة الصنف بالدولار، يتم احتساب سعر الشراء والبيع تلقائياً بالاعتماد على سعر الصرف ونسبة الهامش.
        </p>

        {/* Gemini AI Status (Locked - Not Editable by User) */}
        <div
          style={{
            marginTop: 18,
            marginBottom: 14,
            padding: '12px 14px',
            background: 'rgba(15, 76, 92, 0.05)',
            borderRadius: 10,
            border: '1px solid rgba(15, 76, 92, 0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>
            <ShieldCheck size={16} />
            <span>محرك الذكاء الاصطناعي: Google Gemini 3.5 Flash-Lite</span>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>
            الربط مشفّر ومضبوط في بيئة النظام (.env). الذكاء الاصطناعي يعمل بوضع <b>التحليل والاستشارة فقط (Analyze-Only)</b> دون أي قدرة على تعديل أو حذف البيانات. إعدادات المفتاح محمية ومقفلة لمنع التعديل.
          </p>
        </div>

        <button className="btn big" onClick={saveGeneral}>
          حفظ الإعدادات العامة
        </button>
      </div>

      {/* Invoice Print Settings */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>بيانات الفاتورة المطبوعة</h2>
        <div className="field">
          <label>شعار المنشأة</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {shop.logo ? (
              <img
                src={shop.logo}
                alt="logo"
                style={{ height: 60, borderRadius: 6, border: '1px solid var(--line,#ddd)' }}
              />
            ) : (
              <span className="muted">لا يوجد شعار محدد</span>
            )}
            <input type="file" accept="image/*" onChange={onLogo} />
            {shop.logo && (
              <button className="btn ghost sm" onClick={() => setShop({ ...shop, logo: '' })}>
                إزالة الشعار
              </button>
            )}
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>العنوان</label>
            <input
              className="input"
              value={shop.address}
              onChange={(e) => setShop({ ...shop, address: e.target.value })}
              placeholder="العنوان الكامل للمنشأة"
            />
          </div>
          <div className="field">
            <label>رقم الهاتف</label>
            <input
              className="input"
              inputMode="tel"
              value={shop.phone}
              onChange={(e) => setShop({ ...shop, phone: e.target.value })}
              placeholder="01xxxxxxxxx"
            />
          </div>
        </div>
        <div className="field">
          <label>سياسة الاسترجاع والاستبدال</label>
          <input
            className="input"
            value={shop.returnPolicy}
            onChange={(e) => setShop({ ...shop, returnPolicy: e.target.value })}
            placeholder="مثال: الاسترجاع خلال 14 يوماً مع تقديم أصل الفاتورة"
          />
        </div>
        <div className="field">
          <label>شروط الضمان</label>
          <input
            className="input"
            value={shop.warranty}
            onChange={(e) => setShop({ ...shop, warranty: e.target.value })}
            placeholder="مثال: ضمان لمدة عام ضد عيوب الصناعة"
          />
        </div>
        <div className="field">
          <label>رابط متابعة الصيانة (صفحة track.html على موقعك)</label>
          <input
            className="input"
            dir="ltr"
            value={shop.repairTrackUrl}
            onChange={(e) => setShop({ ...shop, repairTrackUrl: e.target.value })}
            placeholder="https://yourshop.example/track.html"
          />
          <small className="muted">يُستخدم في زرار «لينك المتابعة» بصفحة الصيانة ليتابع العميل حالة جهازه.</small>
        </div>
        <button className="btn" onClick={saveShop}>
          حفظ بيانات الفاتورة
        </button>
      </div>

      {/* Security: Operation Password */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>أمان العمليات والإلغاء</h2>
        <div className="field">
          <label>كلمة سر الإلغاء والحذف (اختياري)</label>
          <input
            className="input lg"
            type="password"
            value={opPassword}
            onChange={(e) => setOpPassword(e.target.value)}
            placeholder="اتركها فارغة لتعطيل طلب التأكيد"
          />
          <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
            عند تحديد كلمة سر، يُشترط إدخالها قبل إلغاء أي فاتورة أو استرجاع حركة محاسبية لحماية السجلات من التلاعب.
          </p>
        </div>
        <button className="btn" onClick={saveGeneral}>
          حفظ كلمة السر
        </button>
      </div>

      {/* WhatsApp Integration */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>تكامل واتساب للفواتير</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          فتح واتساب تلقائياً بنص الفاتورة عند إتمام عمليات البيع للعملاء المسجلين.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={waAuto}
            onChange={toggleWaAuto}
            style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
          />
          <b>{waAuto ? 'مفعل' : 'معطل'}</b>
        </label>
      </div>

      {/* WhatsApp message templates */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>قوالب رسائل واتساب</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          عدّل صيغة الرسائل بكلماتك. المتغيّرات التالية تتعبّأ تلقائياً لكل عميل:{' '}
          {WA_TPL_VARS.map((v) => (
            <code key={v.key} style={{ margin: '0 3px', background: 'var(--chip,#eef4f6)', borderRadius: 4, padding: '1px 5px' }} title={v.desc}>{v.key}</code>
          ))}
        </p>

        <div className="field">
          <label>قالب تذكير الدين</label>
          <textarea className="input" rows={4} value={waTpl.debt}
            onChange={(e) => setWaTpl({ ...waTpl, debt: e.target.value })} />
        </div>
        <div className="field">
          <label>قالب العرض الترويجي</label>
          <textarea className="input" rows={4} value={waTpl.promo}
            onChange={(e) => setWaTpl({ ...waTpl, promo: e.target.value })} />
        </div>
        <div className="field">
          <label>تذييل رسالة الفاتورة</label>
          <input className="input" value={waTpl.invoiceFooter}
            onChange={(e) => setWaTpl({ ...waTpl, invoiceFooter: e.target.value })} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={saveWaTpl}>حفظ القوالب</button>
          <button className="btn ghost" onClick={() => setWaTpl({ debt: WA_TPL_DEFAULTS.debt, promo: WA_TPL_DEFAULTS.promo, invoiceFooter: WA_TPL_DEFAULTS.invoiceFooter })}>
            استعادة الافتراضي
          </button>
        </div>
      </div>

      {/* VAT / Tax Settings */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>إعدادات ضريبة القيمة المضافة (VAT)</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', margin: '8px 0' }}>
          <input
            type="checkbox"
            checked={tax.enabled}
            onChange={(e) => setTax({ ...tax, enabled: e.target.checked })}
            style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
          />
          <b>{tax.enabled ? 'الضريبة مفعلة' : 'الضريبة معطلة'}</b>
        </label>
        <div className="row">
          <div className="field">
            <label>مسمى الضريبة</label>
            <input
              className="input"
              value={tax.name}
              onChange={(e) => setTax({ ...tax, name: e.target.value })}
              placeholder="ضريبة القيمة المضافة"
            />
          </div>
          <div className="field">
            <label>النسبة المئوية %</label>
            <input
              className="input lg"
              type="number"
              min="0"
              step="0.01"
              value={tax.rate}
              onChange={(e) => setTax({ ...tax, rate: e.target.value })}
              placeholder="14"
            />
          </div>
        </div>
        <button className="btn" onClick={saveTax}>
          حفظ الإعدادات الضريبية
        </button>
      </div>

      {/* System Alerts & Limits */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>التنبيهات وحدود الائتمان</h2>
        <div className="row">
          <div className="field">
            <label>تنبيه اقتراب الصلاحية (أيام)</label>
            <input
              className="input"
              type="number"
              min="1"
              value={alerts.nearExpiryDays}
              onChange={(e) => setAlerts({ ...alerts, nearExpiryDays: e.target.value })}
            />
          </div>
          <div className="field">
            <label>اعتبار المديونية متأخرة بعد (أيام)</label>
            <input
              className="input"
              type="number"
              min="1"
              value={alerts.overdueDays}
              onChange={(e) => setAlerts({ ...alerts, overdueDays: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label>فترة الائتمان الافتراضية للمبيعات الآجلة (أيام)</label>
          <input
            className="input"
            type="number"
            min="0"
            value={alerts.creditDays}
            onChange={(e) => setAlerts({ ...alerts, creditDays: e.target.value })}
            placeholder="30"
          />
        </div>
        <div className="field">
          <label>نسبة الخصم المشروطة بموافقة الإدارة % (0 = بدون)</label>
          <input
            className="input"
            type="number"
            min="0"
            value={alerts.discountApprovalPct}
            onChange={(e) => setAlerts({ ...alerts, discountApprovalPct: e.target.value })}
            placeholder="مثال: 10"
          />
        </div>
        <div className="field">
          <label>منع البيع بأكثر من الرصيد المتاح (البيع بالسالب)</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={preventOversell}
              onChange={async (e) => { setPreventOversell(e.target.checked); await setSetting('preventOversell', e.target.checked); }}
              style={{ width: 20, height: 20, accentColor: 'var(--primary)' }}
            />
            <b>{preventOversell ? 'مفعل — لا يُباع إلا بالرصيد الموجب' : 'معطل — يسمح بالبيع بالسالب'}</b>
          </label>
        </div>
        <div className="field">
          <label>قيمة نقطة الولاء بالعملة المحلية عند الاستبدال</label>
          <input
            className="input"
            type="number"
            min="0"
            step="0.1"
            value={alerts.pointEGP}
            onChange={(e) => setAlerts({ ...alerts, pointEGP: e.target.value })}
            placeholder="1"
          />
        </div>
        <button className="btn" onClick={saveAlerts}>
          حفظ إعدادات التنبيهات والائتمان
        </button>
      </div>

      {/* Software Updates */}
      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <h2 style={{ fontSize: 17, marginTop: 0 }}>تحديثات النظام</h2>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          يقوم النظام بمزامنة التحديثات البرمجية والتحسينات الدورية تلقائياً عند الاتصال بالشبكة.
        </p>
        <button className="btn" onClick={checkUpdate}>
          التحقق من وجود تحديثات الآن
        </button>
      </div>

      <Toast msg={toast} />
    </>
  );
}

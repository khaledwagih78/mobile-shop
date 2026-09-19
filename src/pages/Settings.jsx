import { useEffect, useState } from 'react';
import { db, getSetting, setSetting } from '../db';
import { Toast } from '../components/UI';

export default function Settings() {
  const [bizName, setBizName] = useState('');
  const [usdRate, setUsdRate] = useState('');
  const [margin, setMargin] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [opPassword, setOpPassword] = useState('');
  const [email, setEmail] = useState({ to: '', serviceId: '', templateId: '', publicKey: '' });
  const [shop, setShop] = useState({ logo: '', address: '', phone: '', returnPolicy: '', warranty: '' });
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      setBizName(await getSetting('bizName', 'نظام المبيعات والمخزون'));
      setUsdRate(await getSetting('usdRate', '') || '');
      setMargin(await getSetting('defaultMargin', '') || '');
      setApiKey(await getSetting('aiKey', '') || '');
      setOpPassword(await getSetting('opPassword', '') || '');
      setEmail({
        to: await getSetting('emailTo', '') || '',
        serviceId: await getSetting('emailServiceId', '') || '',
        templateId: await getSetting('emailTemplateId', '') || '',
        publicKey: await getSetting('emailPublicKey', '') || '',
      });
      setShop({
        logo: await getSetting('bizLogo', '') || '',
        address: await getSetting('bizAddress', '') || '',
        phone: await getSetting('bizPhone', '') || '',
        returnPolicy: await getSetting('returnPolicy', '') || '',
        warranty: await getSetting('warranty', '') || '',
      });
    })();
  }, []);

  const saveShop = async () => {
    await setSetting('bizLogo', shop.logo);
    await setSetting('bizAddress', shop.address.trim());
    await setSetting('bizPhone', shop.phone.trim());
    await setSetting('returnPolicy', shop.returnPolicy.trim());
    await setSetting('warranty', shop.warranty.trim());
    setToast('✅ تم حفظ بيانات المحل');
    setTimeout(() => setToast(''), 2500);
  };

  const onLogo = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (f.size > 500 * 1024) { setToast('⚠️ اللوجو كبير — اختر صورة أصغر من 500 ك.ب'); setTimeout(() => setToast(''), 3000); return; }
    const r = new FileReader();
    r.onload = () => setShop((s) => ({ ...s, logo: r.result }));
    r.readAsDataURL(f);
  };

  const saveEmail = async () => {
    await setSetting('emailTo', email.to.trim());
    await setSetting('emailServiceId', email.serviceId.trim());
    await setSetting('emailTemplateId', email.templateId.trim());
    await setSetting('emailPublicKey', email.publicKey.trim());
  };

  const testEmail = async () => {
    await saveEmail();
    if (!email.to.trim() || !email.serviceId.trim() || !email.templateId.trim() || !email.publicKey.trim()) {
      setToast('⚠️ املأ كل خانات الإيميل الأربعة أولاً'); setTimeout(() => setToast(''), 3000); return;
    }
    const m = await import('../notify');
    await m.notifyEvent({ action: 'test', title: '📧 اختبار تنبيه', body: 'ده إيميل تجريبي من تطبيقك للتأكد إن تنبيهات الحذف/الإلغاء شغّالة ✅' });
    setToast('📧 تم إرسال إيميل تجريبي — راجع بريدك');
    setTimeout(() => setToast(''), 3500);
  };

  const save = async () => {
    await setSetting('bizName', bizName.trim() || 'نظام المبيعات والمخزون');
    await setSetting('usdRate', Number(usdRate) || 0);
    await setSetting('defaultMargin', Number(margin) || 0);
    await setSetting('aiKey', apiKey.trim());
    await setSetting('opPassword', opPassword.trim());
    await saveEmail();
    setToast('✅ تم حفظ الإعدادات');
    setTimeout(() => setToast(''), 2500);
  };

  const checkUpdate = async () => {
    setToast('🔄 جاري التحقق من التحديثات...');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
    } catch { /* ignore */ }
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <>
      <div className="page-head"><h1>⚙️ الإعدادات</h1></div>

      <div className="card" style={{ maxWidth: 640 }}>
        <div className="field">
          <label>اسم النشاط (يظهر في الفواتير وشاشة الدخول)</label>
          <input className="input lg" value={bizName} onChange={(e) => setBizName(e.target.value)}
            placeholder="مثال: نظام المبيعات والمخزون / جزيرة فون / أي نشاط آخر" />
        </div>

        <div className="row">
          <div className="field">
            <label>💵 سعر صرف الدولار (ج.م)</label>
            <input className="input lg" type="number" min="0" step="0.01" value={usdRate}
              onChange={(e) => setUsdRate(e.target.value)} placeholder="مثال: 48.5" />
          </div>
          <div className="field">
            <label>📈 نسبة الربح الافتراضية % (على التكلفة)</label>
            <input className="input lg" type="number" min="0" value={margin}
              onChange={(e) => setMargin(e.target.value)} placeholder="مثال: 30" />
          </div>
        </div>
        <p className="muted">
          لو سجّلتي للصنف <b>تكلفة بالدولار</b> في شاشة المخزون، يتحسب سعر الشراء تلقائياً بسعر الصرف،
          وسعر البيع يُقترح بنسبة الربح الافتراضية. وعند تغيير سعر الصرف، استخدمي زر
          <b> "إعادة التسعير بالدولار" </b> في صفحة المخزون لتحديث كل الأسعار دفعة واحدة.
        </p>

        <div className="field" style={{ marginTop: 18 }}>
          <label>🤖 مفتاح Claude API (اختياري — لتفعيل التحليل بالذكاء الاصطناعي)</label>
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..." />
          <p className="muted" style={{ marginTop: 6 }}>
            بدون المفتاح: صفحة المساعد الذكي تعمل بالتحليلات المحلية (بدون إنترنت).
            بالمفتاح: تحصلين على توصيات مكتوبة بالذكاء الاصطناعي. المفتاح يُحفظ على جهازك فقط.
          </p>
        </div>

        <button className="btn big" onClick={save}>💾 حفظ الإعدادات</button>
      </div>

      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <div className="field">
          <label>🧾 بيانات المحل في الفاتورة المطبوعة</label>
          <p className="muted" style={{ marginTop: 4 }}>كل الخانات دي اختيارية — اللي تسيبه فاضي مش هيظهر في الفاتورة.</p>
        </div>
        <div className="field">
          <label>لوجو المحل</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {shop.logo
              ? <img src={shop.logo} alt="logo" style={{ height: 60, borderRadius: 6, border: '1px solid var(--line,#ddd)' }} />
              : <span className="muted">لا يوجد لوجو</span>}
            <input type="file" accept="image/*" onChange={onLogo} />
            {shop.logo && <button className="btn ghost sm" onClick={() => setShop({ ...shop, logo: '' })}>حذف اللوجو</button>}
          </div>
        </div>
        <div className="row">
          <div className="field"><label>عنوان المحل</label>
            <input className="input" value={shop.address} onChange={(e) => setShop({ ...shop, address: e.target.value })} placeholder="المنيا - شارع الحسيني" /></div>
          <div className="field"><label>هاتف المحل</label>
            <input className="input" inputMode="tel" value={shop.phone} onChange={(e) => setShop({ ...shop, phone: e.target.value })} placeholder="01000000000" /></div>
        </div>
        <div className="field"><label>مدة/سياسة الاسترجاع</label>
          <input className="input" value={shop.returnPolicy} onChange={(e) => setShop({ ...shop, returnPolicy: e.target.value })} placeholder="مثال: الاسترجاع خلال 14 يوم بشرط وجود الفاتورة والمنتج بحالته" /></div>
        <div className="field"><label>الضمان</label>
          <input className="input" value={shop.warranty} onChange={(e) => setShop({ ...shop, warranty: e.target.value })} placeholder="مثال: ضمان 6 شهور على العيوب الصناعية" /></div>
        <button className="btn" onClick={saveShop}>💾 حفظ بيانات المحل</button>
      </div>

      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <div className="field">
          <label>🔒 كلمة سر الحذف والإلغاء (اختياري)</label>
          <input className="input lg" type="password" value={opPassword} onChange={(e) => setOpPassword(e.target.value)}
            placeholder="اتركها فارغة لتعطيلها" />
          <p className="muted" style={{ marginTop: 6 }}>
            لو حطّيت كلمة سر هنا، أي <b>إلغاء فاتورة</b> أو <b>استرجاع</b> هيطلب كلمة السر دي قبل التنفيذ —
            حماية إضافية عشان محدش يلغي فاتورة بالغلط أو بدون إذن. الفواتير الملغاة <b>بتفضل محفوظة</b>
            وتقدر ترجّعها في أي وقت من صفحة الفاتورة. (اضغط 💾 حفظ الإعدادات بعد التغيير)
          </p>
          <button className="btn" onClick={save}>💾 حفظ كلمة السر</button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <div className="field">
          <label>📧 تنبيه بالإيميل عند الحذف / الإلغاء</label>
          <p className="muted" style={{ marginTop: 4 }}>
            يبعت لك إيميل تلقائي أول ما حد يلغي أو يسترجع فاتورة. بيشتغل عن طريق خدمة
            <b> EmailJS </b> المجانية (بتبعت من غير سيرفر). الخطوات مرة واحدة:
          </p>
          <ol className="muted" style={{ paddingRight: 18, lineHeight: 1.9, margin: '4px 0 10px' }}>
            <li>اعمل حساب مجاني على <b>emailjs.com</b> ووصّل إيميلك (Gmail مثلاً).</li>
            <li>أنشئ <b>Email Service</b> وخد الـ <b>Service ID</b>.</li>
            <li>أنشئ <b>Email Template</b> فيه المتغيرات: <code>{'{{subject}}'}</code> و<code>{'{{message}}'}</code> و<code>{'{{to_email}}'}</code>، وخد الـ <b>Template ID</b>.</li>
            <li>من Account خد الـ <b>Public Key</b>.</li>
            <li>الصقهم تحت + إيميل الاستقبال، واضغط "اختبار".</li>
          </ol>
          <div className="field"><label>إيميل الاستقبال</label>
            <input className="input" type="email" value={email.to} onChange={(e) => setEmail({ ...email, to: e.target.value })} placeholder="you@gmail.com" /></div>
          <div className="row">
            <div className="field"><label>Service ID</label>
              <input className="input" value={email.serviceId} onChange={(e) => setEmail({ ...email, serviceId: e.target.value })} placeholder="service_xxx" /></div>
            <div className="field"><label>Template ID</label>
              <input className="input" value={email.templateId} onChange={(e) => setEmail({ ...email, templateId: e.target.value })} placeholder="template_xxx" /></div>
          </div>
          <div className="field"><label>Public Key</label>
            <input className="input" value={email.publicKey} onChange={(e) => setEmail({ ...email, publicKey: e.target.value })} placeholder="xxxxxxxxxxxxx" /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={save}>💾 حفظ</button>
            <button className="btn ghost" onClick={testEmail}>📧 إرسال إيميل تجريبي</button>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>ملاحظة: الإرسال بيحتاج إنترنت. سيب الخانات فاضية لتعطيل التنبيهات.</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
        <div className="field">
          <label>🔄 تحديثات التطبيق</label>
          <p className="muted" style={{ marginTop: 4 }}>
            التطبيق بيتحدّث <b>تلقائياً</b>: كل ما نضيف مميزات أو خصائص جديدة، بتوصل لجهازك
            لوحدها أول ما تفتح التطبيق وأنت متصل بالإنترنت — من غير ما تعيد تثبيت أي حاجة.
            لو حابب تجيب آخر نسخة دلوقتي حالاً، اضغط الزر ده.
          </p>
          <button className="btn" onClick={checkUpdate}>🔄 تحديث التطبيق الآن</button>
        </div>
      </div>

      <Toast msg={toast} />
    </>
  );
}

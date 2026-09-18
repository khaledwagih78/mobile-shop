import { useEffect, useState } from 'react';
import { db, getSetting, setSetting } from '../db';
import { Toast } from '../components/UI';

export default function Settings() {
  const [bizName, setBizName] = useState('');
  const [usdRate, setUsdRate] = useState('');
  const [margin, setMargin] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [opPassword, setOpPassword] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    (async () => {
      setBizName(await getSetting('bizName', 'خالد لقطع غيار المحمول'));
      setUsdRate(await getSetting('usdRate', '') || '');
      setMargin(await getSetting('defaultMargin', '') || '');
      setApiKey(await getSetting('aiKey', '') || '');
      setOpPassword(await getSetting('opPassword', '') || '');
    })();
  }, []);

  const save = async () => {
    await setSetting('bizName', bizName.trim() || 'خالد لقطع غيار المحمول');
    await setSetting('usdRate', Number(usdRate) || 0);
    await setSetting('defaultMargin', Number(margin) || 0);
    await setSetting('aiKey', apiKey.trim());
    await setSetting('opPassword', opPassword.trim());
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
            placeholder="مثال: خالد لقطع غيار المحمول / جزيرة فون / أي نشاط آخر" />
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

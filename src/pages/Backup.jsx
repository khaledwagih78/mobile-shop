import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, loadDemoData } from '../db';
import { exportBackup, importBackup } from '../backup';
import { fmtDate } from '../utils';
import { Toast } from '../components/UI';

export default function Backup() {
  const fileRef = useRef(null);
  const [pw, setPw] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useLiveQuery(() => db.syncQueue.where('synced').equals(0).count(), [], 0);
  const itemsCount = useLiveQuery(() => db.items.count(), [], 0);
  const invCount = useLiveQuery(() => db.invoices.count(), [], 0);

  const show = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const doExport = async () => {
    setBusy(true);
    try {
      await exportBackup(pw.trim() || null);
      show('✅ تم تنزيل النسخة الاحتياطية');
    } catch (e) { show('❌ ' + e.message); }
    setBusy(false);
  };

  const doImport = async (file) => {
    if (!file) return;
    if (!confirm('⚠️ الاسترجاع سيستبدل كل البيانات الحالية بالنسخة المختارة. متأكد؟')) return;
    setBusy(true);
    try {
      const date = await importBackup(file, pw.trim() || null);
      show(`✅ تم استرجاع نسخة بتاريخ ${fmtDate(date)} — أعد تسجيل الدخول`);
      setTimeout(() => location.reload(), 2000);
    } catch (e) { show('❌ ' + e.message); }
    setBusy(false);
    fileRef.current.value = '';
  };

  return (
    <>
      <div className="page-head"><h1>🛡️ النسخ الاحتياطي</h1></div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>📤 نسخ احتياطي الآن</h3>
          <p className="muted">يتم تنزيل ملف يحتوي كل بياناتك ({itemsCount} صنف، {invCount} فاتورة). احفظه على Google Drive أو أرسله لنفسك على Gmail / واتساب.</p>
          <div className="field">
            <label>كلمة سر التشفير (اختياري — موصى به)</label>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="اتركها فارغة لنسخة بدون تشفير" />
          </div>
          <button className="btn big block" onClick={doExport} disabled={busy}>💾 نسخ احتياطي الآن</button>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 10 }}>📥 استرجاع البيانات</h3>
          <p className="muted">اختر ملف نسخة احتياطية لاسترجاعه أو لنقل البيانات لجهاز جديد. إن كانت النسخة مشفّرة أدخل كلمة السر في الخانة المجاورة أولاً.</p>
          <input ref={fileRef} type="file" accept=".json,.kerp" style={{ display: 'none' }}
            onChange={(e) => doImport(e.target.files[0])} />
          <button className="btn ghost big block" onClick={() => fileRef.current.click()} disabled={busy}>
            📂 اختيار ملف واسترجاع
          </button>
        </div>
      </div>

      <div className="section-title">☁️ المزامنة السحابية</div>
      <div className="card">
        <p>
          <span className="badge amber">المرحلة الثانية</span>{' '}
          البرنامج يسجّل كل عملية محلياً ويحتفظ بقائمة انتظار للمزامنة.
          عند تفعيل الربط السحابي (Supabase) سيتم رفع <b>{pending}</b> عملية معلّقة تلقائياً أول ما يتوفر الإنترنت.
        </p>
        <p className="muted">حالياً: كل البيانات محفوظة بأمان داخل الجهاز وتعمل بدون إنترنت بالكامل.</p>
      </div>

      {itemsCount === 0 && (
        <>
          <div className="section-title">🧪 بيانات تجريبية</div>
          <div className="card">
            <p className="muted">للتجربة السريعة: حمّل أصناف وعملاء تجريبيين (يمكن حذفهم لاحقاً).</p>
            <button className="btn ghost" onClick={async () => { await loadDemoData(); show('✅ تم تحميل البيانات التجريبية'); }}>
              تحميل بيانات تجريبية
            </button>
          </div>
        </>
      )}

      <Toast msg={toast} />
    </>
  );
}

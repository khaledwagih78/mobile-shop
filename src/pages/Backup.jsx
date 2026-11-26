import { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting, clearBusinessData } from '../db';
import { exportBackup, importBackup } from '../backup';
import { fmtDate } from '../utils';
import { useSyncStatus, triggerSync } from '../sync';
import { Toast } from '../components/UI';

function relTime(iso) {
  if (!iso) return'لم يتم بعد';
  const m = Math.floor((Date.now() - new Date(iso)) / 60_000);
  if (m < 1) return'الآن';
  if (m < 60) return`منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return`منذ ${h} ساعة`;
  return`منذ ${Math.floor(h / 24)} يوم`;
}

export default function Backup() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const fileRef = useRef(null);

  const lastBackupAt = useLiveQuery(() => getSetting('lastBackupAt', null), [], undefined);
  const reminderDays = useLiveQuery(() => getSetting('backupReminderDays', 7), [], 7);
  const autoBackup = useLiveQuery(() => getSetting('autoBackup', false), [], false);
  const itemsCount = useLiveQuery(() => db.items.count(), [], 0);
  const invCount = useLiveQuery(() => db.invoices.count(), [], 0);
  const sync = useSyncStatus();
  const pending = useLiveQuery(() => db.syncQueue.where('synced').equals(0).count(), [], 0);

  const show = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const doExport = async () => {
    setBusy(true);
    try {
      await exportBackup(pw.trim() || null);
      show('تم تنزيل النسخة الاحتياطية بنجاح');
    } catch (e) { show('خطأ:' + e.message); }
    setBusy(false);
  };

  const doImport = async (file) => {
    if (!file) return;
    if (!confirm('الاسترجاع سيستبدل كل البيانات الحالية بالنسخة المختارة. هل ترغب في المتابعة؟')) return;
    setBusy(true);
    try {
      const date = await importBackup(file, pw.trim() || null);
      show(`تم استرجاع نسخة بتاريخ ${fmtDate(date)} — أعد تسجيل الدخول`);
      setTimeout(() => location.reload(), 2000);
    } catch (e) { show('خطأ:' + e.message); }
    setBusy(false);
    fileRef.current.value ='';
  };

  return (
    <>
      <div className="page-head"><h1>النسخ الاحتياطي</h1></div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 10 }}>نسخ احتياطي الآن</h3>
          <p className="muted">يتم تنزيل ملف يحتوي كل بياناتك ({itemsCount} صنف، {invCount} فاتورة). احفظه على Google Drive أو أرسله لنفسك على Gmail / واتساب.</p>
          <div className="field">
            <label>كلمة سر التشفير (اختياري — موصى به)</label>
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="اتركها فارغة لنسخة بدون تشفير" />
          </div>
          <button className="btn big block" onClick={doExport} disabled={busy}>نسخ احتياطي الآن</button>
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            {lastBackupAt
              ? <>آخر نسخة احتياطية: <b>{fmtDate(lastBackupAt)}</b> ({relTime(lastBackupAt)})</>
              : <b style={{ color:'var(--red,#d33)' }}>لم تقم بأي نسخة احتياطية بعد.</b>}
          </p>
          <div className="field" style={{ marginTop: 10 }}>
            <label>ذكّرني بالنسخ الاحتياطي كل (أيام)</label>
            <input className="input" type="number" min="1" value={reminderDays}
              onChange={(e) => setSetting('backupReminderDays', Math.max(1, Number(e.target.value) || 7))} />
          </div>
          <label style={{ display:'flex', alignItems:'center', gap: 8, cursor:'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={!!autoBackup} onChange={(e) => setSetting('autoBackup', e.target.checked)} style={{ width: 18, height: 18 }} />
            نسخة احتياطية تلقائية عند فتح التطبيق إذا تأخرت (تُنزَّل بدون تشفير)
          </label>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 10 }}>استرجاع البيانات</h3>
          <p className="muted">اختر ملف نسخة احتياطية لاسترجاعه أو لنقل البيانات لجهاز جديد. إن كانت النسخة مشفّرة أدخل كلمة السر في الخانة المجاورة أولاً.</p>
          <input ref={fileRef} type="file" accept=".json,.kerp" style={{ display:'none' }}
            onChange={(e) => doImport(e.target.files[0])} />
          <button className="btn ghost big block" onClick={() => fileRef.current.click()} disabled={busy}>اختيار ملف واسترجاع</button>
        </div>
      </div>

      <div className="section-title">المزامنة السحابية (Supabase)</div>
      <div className="card">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 12 }}>
          <div>
            {sync.state ==='syncing' && <span className="badge amber">جاري المزامنة...</span>}
            {sync.state ==='ok'      && <span className="badge green">مزامن — {relTime(sync.at)}</span>}
            {sync.state ==='error'   && <span className="badge red">خطأ في المزامنة</span>}
            {sync.state ==='offline' && <span className="badge gray">غير متصل بالإنترنت</span>}
            {sync.state ==='idle'    && <span className="badge gray">في انتظار المزامنة</span>}
            {sync.error && (
              <pre className="muted" style={{ fontSize: 11, marginTop: 6, direction:'ltr', whiteSpace:'pre-wrap', maxWidth: 500, background:'#fee', padding: 8, borderRadius: 6, border:'1px solid #fcc' }}>{sync.error}</pre>
            )}
          </div>
          <button
            className="btn"
            onClick={triggerSync}
            disabled={sync.state ==='syncing' || !navigator.onLine}
          >زامن الآن</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          {pending > 0
            ?`${pending} عملية محلية بانتظار الرفع — تتزامن تلقائياً كل 30 ثانية وعند عودة الإنترنت.`
            :'كل البيانات مزامنة مع السحابة. يمكنك فتح التطبيق من أي جهاز وستجد نفس البيانات.'}
        </p>
      </div>

      <div className="section-title">إعادة تهيئة البيانات</div>
      <div className="card" style={{ borderColor:'var(--red, #d33)' }}>
        <p className="muted" style={{ marginTop: 0 }}>
          حذف كافة البيانات التشغيلية على هذا الجهاز (الأصناف، الفواتير، العملاء، الموردين، المصروفات،
          والقيود المحاسبية) لتهيئة النظام لبدء إدخال السجلات الفعلية للمنشأة.
          <br />تبقى بيانات المستخدمين، الإعدادات، الفروع، والحقول المخصصة محفوظة دون حذف.
          <br /><b style={{ color:'var(--red,#d33)' }}>هذا الإجراء نهائي ولا يمكن التراجع عنه — يُوصى بالاحتفاظ بنسخة احتياطية أولاً.</b>
        </p>
        <button className="btn danger"
          onClick={async () => {
            if (!confirm('تأكيد: هل ترغب حقاً في تفريغ كافة البيانات التشغيلية على هذا الجهاز؟ لا يمكن التراجع عن هذه العملية.')) return;
            if (!confirm('تأكيد نهائي: سيتم مسح كافة الفواتير والأصناف والعملاء. هل أنت متأكد تماماً؟')) return;
            await clearBusinessData();
            show('تم تفريغ البيانات التشغيلية بنجاح');
            setTimeout(() => window.location.reload(), 1000);
          }}>
          تفريغ السجلات والبدء من جديد
        </button>
      </div>

      <Toast msg={toast} />
    </>
  );
}

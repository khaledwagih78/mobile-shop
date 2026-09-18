import { useEffect, useState } from 'react';
import { getSetting } from '../db';
import { Modal } from './UI';

// Confirmation dialog for sensitive actions (cancel / delete / restore).
// If an operations password is set in Settings, it must be entered; otherwise
// it's a plain confirm. Calls onConfirm() then onClose() when confirmed.
export default function PasswordGate({ title, message, onConfirm, onClose }) {
  const [pw, setPw] = useState('');
  const [need, setNeed] = useState('');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { getSetting('opPassword', '').then((v) => { setNeed(v || ''); setReady(true); }); }, []);
  if (!ready) return null;

  const submit = () => {
    if (need && pw !== need) { setErr('كلمة السر غير صحيحة'); return; }
    onConfirm();
    onClose();
  };

  return (
    <Modal title={title || 'تأكيد العملية'} onClose={onClose}>
      {message && <p className="muted" style={{ marginBottom: 10 }}>{message}</p>}
      {need ? (
        <div className="field">
          <label>🔒 كلمة سر الحذف/الإلغاء</label>
          <input className="input lg" type="password" autoFocus value={pw}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
      ) : null}
      {err && <div style={{ color: 'var(--red)', fontWeight: 700, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn block" onClick={submit}>{need ? 'تأكيد بكلمة السر' : 'تأكيد'}</button>
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting } from '../db';
import { useAuth } from '../auth';
import { ROLES } from '../utils';

export default function Login() {
  const users = useLiveQuery(() => db.users.toArray(), [], []);
  const bizName = useLiveQuery(() => getSetting('bizName', 'خالد لقطع غيار المحمول'), [], 'خالد لقطع غيار المحمول');
  const { login } = useAuth();
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    const ok = await login(Number(userId), pin);
    if (!ok) setErr('الرقم السري غير صحيح');
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">{bizName}</div>
        <div className="tag">نظام المبيعات والمخزون — يعمل بدون إنترنت</div>

        <div className="field">
          <label>المستخدم</label>
          <select className="input lg" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">اختر المستخدم</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {ROLES[u.role]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>الرقم السري (PIN)</label>
          <input
            className="input lg"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="••••"
          />
        </div>

        {err && <div style={{ color: 'var(--red)', fontWeight: 700, marginBottom: 10 }}>{err}</div>}

        <button className="btn big block" onClick={submit} disabled={!userId || !pin}>
          دخول
        </button>

        <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
          أول مرة؟ المستخدم: المدير — الرقم السري: 1234
        </p>
      </div>
    </div>
  );
}

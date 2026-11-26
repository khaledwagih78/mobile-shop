import { useState, useEffect, useMemo } from'react';
import { useLiveQuery } from'dexie-react-hooks';
import { db, getSetting } from'../db';
import { useAuth } from'../auth';
import { ROLES } from'../utils';

export default function Login() {
  const rawUsers = useLiveQuery(() => db.users.toArray(), [], []);
  const bizName = useLiveQuery(() => getSetting('bizName',''), [],'');
  const { login } = useAuth();

  // Deduplicate users so multiple admins never appear
  const users = useMemo(() => {
    if (!rawUsers || !rawUsers.length) return [];
    const map = new Map();
    for (const u of rawUsers) {
      const key =`${u.name}_${u.role}`;
      if (!map.has(key)) map.set(key, u);
    }
    return Array.from(map.values());
  }, [rawUsers]);

  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (users && users.length && !userId) {
      const defaultUser = users.find((u) => u.role ==='admin') || users[0];
      setUserId(String(defaultUser.id));
    }
  }, [users, userId]);

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!userId || !pin) return;
    setErr('');
    setLoading(true);
    try {
      const ok = await login(Number(userId), pin);
      if (!ok) {
        setErr('الرمز السري غير صحيح');
        setPin('');
      }
    } catch {
      setErr('تعذر تسجيل الدخول، يرجى المحاولة لاحقاً');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-header">
          <div className="login-brand-bar" />
          <h1 className="login-title">{bizName ||'نظام إدارة المبيعات'}</h1>
          <p className="login-subtitle">تسجيل الدخول إلى حساب المنشأة</p>
        </div>

        <form onSubmit={submit}>
          <div className="login-field">
            <label className="login-label">المستخدم</label>
            <select
              className="login-input"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setErr('');
              }}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {ROLES[u.role] || u.role}
                </option>
              ))}
            </select>
          </div>

          <div className="login-field">
            <label className="login-label">الرمز السري</label>
            <input
              className="login-input"
              type="password"
              inputMode="numeric"
              maxLength={12}
              value={pin}
              autoFocus
              onChange={(e) => {
                setPin(e.target.value);
                setErr('');
              }}
              placeholder="••••"
            />
            {err && <div className="login-error">{err}</div>}
          </div>

          <button
            type="submit"
            className="login-btn"
            disabled={!userId || !pin || loading}
          >
            {loading ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    </div>
  );
}

'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ERROR_MESSAGES, authErrorCode, homeForRole, isEgyptMobile, normalizePhone, phoneToAuthEmail, type AppRole,
} from '@kmr/shared';
import { supabaseBrowser } from '@/lib/supabase/client';

type Mode = 'login' | 'signup';

function msg(code: string) {
  return ERROR_MESSAGES[code] ?? 'حصل خطأ، حاول تاني';
}

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(params.get('inactive') ? 'الحساب ده موقوف — تواصل مع إدارة المحل' : null);
  const [busy, setBusy] = useState(false);

  async function goHome() {
    const sb = supabaseBrowser();
    const { data } = await sb.rpc('whoami');
    const role = (data as { role?: AppRole; is_active?: boolean } | null)?.role;
    if ((data as { is_active?: boolean } | null)?.is_active === false) {
      await sb.auth.signOut();
      setError('الحساب ده موقوف — تواصل مع إدارة المحل');
      return;
    }
    const next = params.get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : homeForRole(role));
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isEgyptMobile(phone)) return setError('اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 01)');
    if (password.length < 8) return setError(msg('WEAK_PASSWORD'));
    if (mode === 'signup') {
      if (name.trim().length < 2) return setError(msg('NAME_REQUIRED'));
      if (password !== password2) return setError('كلمتين السر مش متطابقين');
    }

    setBusy(true);
    const sb = supabaseBrowser();
    try {
      const email = phoneToAuthEmail(phone);
      if (mode === 'login') {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) return setError(msg(authErrorCode(err.message)));
      } else {
        const { data, error: err } = await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim(), phone: normalizePhone(phone) } },
        });
        if (err) return setError(msg(authErrorCode(err.message)));
        if (!data.session) {
          return setError('اتعمل الحساب، لكن تأكيد الإيميل مفعّل في Supabase — لازم يتقفل (راجع دليل الإعداد)');
        }
      }
      await goHome();
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="card text-center">
        <p className="font-bold">النظام لسه مش متوصّل بقاعدة البيانات.</p>
        <p className="mt-2 text-sm text-slate-500">
          ضيف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في ملف ‎.env.local
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
        {(['login', 'signup'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null); }}
            className={`min-h-11 rounded-lg font-bold ${mode === m ? 'bg-white text-brand shadow' : 'text-slate-500'}`}
          >
            {m === 'login' ? 'تسجيل الدخول' : 'حساب جديد'}
          </button>
        ))}
      </div>

      {mode === 'signup' && (
        <div>
          <label className="label" htmlFor="name">الاسم</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="phone">رقم الموبايل</label>
        <input
          id="phone"
          className="input text-left"
          dir="ltr"
          inputMode="tel"
          placeholder="01xxxxxxxxx"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">كلمة السر</label>
        <input
          id="password"
          type="password"
          className="input"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </div>
      {mode === 'signup' && (
        <div>
          <label className="label" htmlFor="password2">تأكيد كلمة السر</label>
          <input id="password2" type="password" className="input" dir="ltr" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
        </div>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'جاري التنفيذ…' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
      </button>

      {mode === 'login' && (
        <p className="text-center text-sm text-slate-500">نسيت كلمة السر؟ تواصل مع المحل وهيتم تعيين كلمة جديدة.</p>
      )}
    </form>
  );
}

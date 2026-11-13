'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  ERROR_MESSAGES, authErrorCode, homeForRole, isEgyptMobile, isEmail, normalizePhone, phoneToAuthEmail,
  type AppRole, type LoginMethod,
} from '@kmr/shared';
import { supabaseBrowser } from '@/lib/supabase/client';

type Mode = 'login' | 'signup';

function msg(code: string) {
  return ERROR_MESSAGES[code] ?? 'حصل خطأ، حاول تاني';
}

function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-lg font-bold ${value === o.value ? 'bg-white text-brand shadow' : 'text-slate-500'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [method, setMethod] = useState<LoginMethod>('PHONE');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(params.get('inactive') ? 'الحساب ده موقوف — تواصل مع إدارة المحل' : null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setError(null);
    setInfo(null);
    setCode('');
    setCodeSentTo(null);
  }

  async function goHome() {
    const sb = supabaseBrowser();
    const { data } = await sb.rpc('whoami');
    const me = data as { role?: AppRole; is_active?: boolean } | null;
    if (me?.is_active === false) {
      await sb.auth.signOut();
      setError('الحساب ده موقوف — تواصل مع إدارة المحل');
      return;
    }
    const next = params.get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : homeForRole(me?.role));
    router.refresh();
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  // ------------------------- phone + password -------------------------
  async function submitPhone() {
    if (!isEgyptMobile(phone)) return setError('اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 01)');
    if (password.length < 8) return setError(msg('WEAK_PASSWORD'));
    if (mode === 'signup') {
      if (name.trim().length < 2) return setError(msg('NAME_REQUIRED'));
      if (password !== password2) return setError('كلمتين السر مش متطابقين');
    }
    const sb = supabaseBrowser();
    const authEmail = phoneToAuthEmail(phone);
    if (mode === 'login') {
      const { error: err } = await sb.auth.signInWithPassword({ email: authEmail, password });
      if (err) return setError(msg(authErrorCode(err.message)));
    } else {
      const { data, error: err } = await sb.auth.signUp({
        email: authEmail,
        password,
        options: { data: { full_name: name.trim(), phone: normalizePhone(phone) } },
      });
      if (err) return setError(msg(authErrorCode(err.message)));
      if (!data.session) return setError('اتعمل الحساب، لكن "Confirm email" مفعّل في Supabase — لازم يتقفل (راجع دليل الإعداد)');
    }
    await goHome();
  }

  // ------------------------- e-mail + code ----------------------------
  async function sendCode() {
    const addr = email.trim().toLowerCase();
    if (!isEmail(addr)) return setError(msg('INVALID_EMAIL'));
    if (mode === 'signup') {
      if (name.trim().length < 2) return setError(msg('NAME_REQUIRED'));
      if (!isEgyptMobile(phone)) return setError('اكتب رقم موبايل مصري صحيح (11 رقم يبدأ بـ 01)');
    }
    const { error: err } = await supabaseBrowser().auth.signInWithOtp({
      email: addr,
      options: mode === 'signup'
        ? { shouldCreateUser: true, data: { full_name: name.trim(), phone: normalizePhone(phone) } }
        : { shouldCreateUser: false },
    });
    if (err) return setError(msg(authErrorCode(err.message)));
    setCodeSentTo(addr);
    setInfo(`بعتنا كود من 6 أرقام على ${addr} — لو مش لاقيه بص في الـ Spam`);
  }

  async function verifyCode() {
    if (!/^[0-9]{6}$/.test(code.trim())) return setError('الكود 6 أرقام');
    const { error: err } = await supabaseBrowser().auth.verifyOtp({ email: codeSentTo!, token: code.trim(), type: 'email' });
    if (err) return setError(msg(authErrorCode(err.message)));
    await goHome();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (method === 'PHONE') return run(submitPhone);
    return run(codeSentTo ? verifyCode : sendCode);
  }

  if (!configured) {
    return (
      <div className="card text-center">
        <p className="font-bold">النظام لسه مش متوصّل بقاعدة البيانات.</p>
        <p className="mt-2 text-sm text-slate-500">ضيف NEXT_PUBLIC_SUPABASE_URL و NEXT_PUBLIC_SUPABASE_ANON_KEY في ملف ‎.env.local</p>
      </div>
    );
  }

  const nameField = (
    <div>
      <label className="label" htmlFor="name">الاسم</label>
      <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
    </div>
  );
  const phoneField = (
    <div>
      <label className="label" htmlFor="phone">رقم الموبايل</label>
      <input id="phone" className="input text-left" dir="ltr" inputMode="tel" placeholder="01xxxxxxxxx"
        value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
    </div>
  );

  const submitLabel = busy
    ? 'جاري التنفيذ…'
    : method === 'EMAIL'
      ? codeSentTo ? 'تأكيد الكود والدخول' : 'ابعت الكود'
      : mode === 'login' ? 'دخول' : 'إنشاء الحساب';

  return (
    <form onSubmit={onSubmit} className="card space-y-4" noValidate>
      <Segmented value={mode} onChange={(v) => { setMode(v); reset(); }}
        options={[{ value: 'login', label: 'تسجيل الدخول' }, { value: 'signup', label: 'حساب جديد' }]} />

      <div>
        <span className="label">طريقة الدخول</span>
        <Segmented value={method} onChange={(v) => { setMethod(v); reset(); }}
          options={[{ value: 'PHONE', label: '📱 موبايل وكلمة سر' }, { value: 'EMAIL', label: '✉️ إيميل وكود' }]} />
      </div>

      {method === 'PHONE' && (
        <>
          {mode === 'signup' && nameField}
          {phoneField}
          <div>
            <label className="label" htmlFor="password">كلمة السر</label>
            <input id="password" type="password" className="input" dir="ltr" value={password}
              onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </div>
          {mode === 'signup' && (
            <div>
              <label className="label" htmlFor="password2">تأكيد كلمة السر</label>
              <input id="password2" type="password" className="input" dir="ltr" value={password2}
                onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
            </div>
          )}
        </>
      )}

      {method === 'EMAIL' && !codeSentTo && (
        <>
          {mode === 'signup' && nameField}
          <div>
            <label className="label" htmlFor="email">الإيميل</label>
            <input id="email" type="email" className="input text-left" dir="ltr" placeholder="name@gmail.com"
              value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          {mode === 'signup' && phoneField}
        </>
      )}

      {method === 'EMAIL' && codeSentTo && (
        <div>
          <label className="label" htmlFor="code">الكود</label>
          <input id="code" className="input text-center text-2xl tracking-[0.5em]" dir="ltr" inputMode="numeric"
            maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button type="button" className="mt-2 text-sm font-semibold text-brand" onClick={reset}>تغيير الإيميل / إرسال كود جديد</button>
        </div>
      )}

      {info && !error && <p role="status" className="rounded-xl bg-sky-100 p-3 text-sm font-semibold text-navy">{info}</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={busy}>{submitLabel}</button>

      {method === 'PHONE' && mode === 'login' && (
        <p className="text-center text-sm text-slate-500">نسيت كلمة السر؟ تواصل مع المحل وهيتم تعيين كلمة جديدة.</p>
      )}
    </form>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { ROLE_LABELS, arabicError, displayPhone, type AppRole } from '@kmr/shared';
import { supabaseBrowser } from '@/lib/supabase/client';

interface UserRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  branch_id: string | null;
  is_active: boolean;
  job_title: string | null;
  created_at: string;
}

const ROLES: AppRole[] = ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TECHNICIAN', 'CUSTOMER'];

export function UsersManager({ meId }: { meId: string }) {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<AppRole | ''>('');
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb.rpc('admin_list_users', {
      p_search: search.trim() || null,
      p_role: roleFilter || null,
    });
    setLoading(false);
    if (error) return setFlash({ ok: false, text: arabicError(error.message) });
    setRows((data ?? []) as UserRow[]);
  }, [sb, search, roleFilter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function toggleActive(u: UserRow) {
    const { error } = await sb.rpc('admin_set_active', { p_profile: u.id, p_active: !u.is_active });
    setFlash(error ? { ok: false, text: arabicError(error.message) } : { ok: true, text: u.is_active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب' });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 sm:grid-cols-3">
        <input className="input sm:col-span-2" placeholder="ابحث بالاسم أو رقم الموبايل" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as AppRole | '')}>
          <option value="">كل الأدوار</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      <div className="rounded-xl bg-brand-50 p-4 text-sm text-navy-600">
        لإضافة موظف أو فني: يعمل حساب من صفحة الدخول برقم موبايله، وبعدين تبحث عنه هنا وتغيّر دوره.
      </div>

      {flash && (
        <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${flash.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {flash.text}
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-right text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="p-3">الاسم</th>
              <th className="p-3">الموبايل</th>
              <th className="p-3">الدور</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-6 text-center text-slate-400">جاري التحميل…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">لا توجد نتائج</td></tr>}
            {!loading && rows.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="p-3 font-semibold">{u.full_name ?? '—'}{u.job_title ? <span className="block text-xs text-slate-400">{u.job_title}</span> : null}</td>
                <td className="p-3" dir="ltr">{displayPhone(u.phone)}</td>
                <td className="p-3"><span className="badge bg-sky-100 text-navy">{ROLE_LABELS[u.role]}</span></td>
                <td className="p-3">
                  <span className={`badge ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {u.is_active ? 'نشط' : 'موقوف'}
                  </span>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setEditing(u)} disabled={u.id === meId}>تغيير الدور</button>
                    <button className="btn-secondary min-h-9 px-3 text-xs" onClick={() => setResetFor(u)}>كلمة سر جديدة</button>
                    {u.id !== meId && (
                      <button className={`${u.is_active ? 'btn-danger' : 'btn-primary'} min-h-9 px-3 text-xs`} onClick={() => toggleActive(u)}>
                        {u.is_active ? 'إيقاف' : 'تفعيل'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RoleDialog
          user={editing}
          onClose={() => setEditing(null)}
          onDone={(text) => { setEditing(null); setFlash({ ok: true, text }); load(); }}
        />
      )}
      {resetFor && (
        <ResetPasswordDialog
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={(ok, text) => { setResetFor(null); setFlash({ ok, text }); }}
        />
      )}
    </div>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="card w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function RoleDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: (t: string) => void }) {
  const sb = supabaseBrowser();
  const [role, setRole] = useState<AppRole>(user.role);
  const [jobTitle, setJobTitle] = useState(user.job_title ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error: err } = await sb.rpc('admin_set_role', {
      p_profile: user.id,
      p_role: role,
      p_job_title: jobTitle.trim() || null,
    });
    setBusy(false);
    if (err) return setError(arabicError(err.message));
    onDone(`تم تغيير دور ${user.full_name ?? ''} إلى ${ROLE_LABELS[role]}`);
  }

  return (
    <Dialog title={`تغيير دور: ${user.full_name ?? displayPhone(user.phone)}`} onClose={onClose}>
      <div>
        <label className="label">الدور</label>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      {role !== 'CUSTOMER' && (
        <div>
          <label className="label">المسمى الوظيفي (اختياري)</label>
          <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="مثال: فني هاردوير" />
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>حفظ</button>
        <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: (ok: boolean, t: string) => void }) {
  const sb = supabaseBrowser();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pw.length < 8) return setError('كلمة السر لازم تكون 8 حروف/أرقام على الأقل');
    setBusy(true);
    const { data, error: err } = await sb.functions.invoke('admin-reset-password', {
      body: { profile_id: user.id, new_password: pw },
    });
    setBusy(false);
    if (err || (data && (data as { error?: string }).error)) {
      return setError('تعذّر تغيير كلمة السر — تأكد إن الدالة admin-reset-password منشورة على Supabase');
    }
    onDone(true, `تم تعيين كلمة سر جديدة لـ ${user.full_name ?? displayPhone(user.phone)} — بلّغه بيها شخصيًا`);
  }

  return (
    <Dialog title={`كلمة سر جديدة: ${user.full_name ?? displayPhone(user.phone)}`} onClose={onClose}>
      <p className="text-sm text-slate-500">استخدمها لما حد ينسى كلمة السر. اتأكد من شخصيته قبل ما تديله الكلمة الجديدة.</p>
      <input className="input" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8 حروف/أرقام على الأقل" />
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>تعيين</button>
        <button className="btn-secondary flex-1" onClick={onClose}>إلغاء</button>
      </div>
    </Dialog>
  );
}

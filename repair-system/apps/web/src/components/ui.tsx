'use client';
import { STATUS_LABELS, type RepairStatus } from '@kmr/shared';
import { STATUS_STYLE } from '@/lib/format';

export function StatusBadge({ status }: { status: RepairStatus }) {
  return <span className={`badge whitespace-nowrap ${STATUS_STYLE[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function Flash({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? 'status' : 'alert'}
      className={`rounded-xl p-3 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
      {msg.text}
    </p>
  );
}

export function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{text}</p>;
}

export function Loading() {
  return <div className="p-6 text-center text-slate-400">جاري التحميل…</div>;
}

export function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <h2 className="text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

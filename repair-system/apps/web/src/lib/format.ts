import type { RepairStatus } from '@kmr/shared';

const TZ = 'Africa/Cairo';
const LOCALE = 'ar-EG-u-nu-latn'; // عربي بأرقام إنجليزي (أوضح في المحل)

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, dateStyle: 'medium' }).format(new Date(iso));
}

/** 30 → "يوم و6 ساعات" */
export function durationLabel(hours: number | string | null | undefined): string {
  if (hours === null || hours === undefined || hours === '') return '—';
  const h = Math.max(0, Math.round(Number(hours)));
  if (h < 1) return 'أقل من ساعة';
  const d = Math.floor(h / 24);
  const r = h % 24;
  const days = d === 0 ? '' : d === 1 ? 'يوم' : d === 2 ? 'يومين' : `${d} أيام`;
  const hrs = r === 0 ? '' : r === 1 ? 'ساعة' : r === 2 ? 'ساعتين' : `${r} ساعات`;
  return [days, hrs].filter(Boolean).join(' و');
}

export function money(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—';
  return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`;
}

/** datetime-local input value (Cairo time) <-> ISO */
export function toLocalInput(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  // the browser interprets datetime-local in the device's timezone (the shop is in Egypt)
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const STATUS_STYLE: Record<RepairStatus, string> = {
  NEW_REQUEST: 'bg-slate-100 text-slate-700',
  BOOKING_CONFIRMED: 'bg-sky-100 text-navy',
  DEVICE_RECEIVED: 'bg-brand-50 text-brand-600',
  UNDER_DIAGNOSIS: 'bg-indigo-50 text-indigo-700',
  WAITING_CUSTOMER_APPROVAL: 'bg-amber-50 text-amber-700',
  CUSTOMER_APPROVED: 'bg-teal-50 text-teal-700',
  CUSTOMER_REJECTED: 'bg-rose-50 text-rose-700',
  WAITING_SPARE_PART: 'bg-orange-50 text-orange-700',
  UNDER_REPAIR: 'bg-blue-50 text-blue-700',
  UNDER_TESTING: 'bg-violet-50 text-violet-700',
  WAITING_MANAGER_APPROVAL: 'bg-yellow-50 text-yellow-800',
  READY_FOR_PICKUP: 'bg-emerald-50 text-emerald-700',
  DELIVERED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
};

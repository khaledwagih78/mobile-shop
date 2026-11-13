import Link from 'next/link';
import { ROLE_LABELS } from '@kmr/shared';
import type { WhoAmI } from '@/lib/supabase/server';
import { BrandTitle } from './Brand';
import { LogoutButton } from './LogoutButton';

export interface NavItem {
  href: string;
  label: string;
}

export function AppShell({ me, nav, children }: { me: WhoAmI; nav: NavItem[]; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <BrandTitle />
          <div className="flex items-center gap-3">
            <div className="text-left leading-tight">
              <div className="text-sm font-bold">{me.full_name ?? '—'}</div>
              <div className="text-xs text-slate-500">{ROLE_LABELS[me.role]}</div>
            </div>
            <LogoutButton />
          </div>
        </div>
        {nav.length > 0 && (
          <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="badge whitespace-nowrap bg-brand-50 px-4 py-2 text-sm text-brand-600 hover:bg-sky-100">
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

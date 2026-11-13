import Link from 'next/link';
import { redirect } from 'next/navigation';
import { homeForRole } from '@kmr/shared';
import { Logo } from '@/components/Brand';
import { supabaseConfigured } from '@/lib/supabase/env';
import { getWhoAmI } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (supabaseConfigured) {
    const me = await getWhoAmI();
    if (me?.is_active) redirect(homeForRole(me.role));
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-navy to-navy-600 px-4 text-center text-white">
      <Logo size={88} />
      <h1 className="mt-6 text-3xl font-bold">خالد لصيانة المحمول</h1>
      <p className="mt-3 max-w-md text-sky-100">احجز صيانة جهازك وتابع كل مرحلة لحظة بلحظة، ووافق على التكلفة قبل أي إصلاح.</p>
      <div className="mt-8 flex w-full max-w-xs flex-col gap-3">
        <Link href="/login" className="btn-primary">تسجيل الدخول / حساب جديد</Link>
      </div>
    </div>
  );
}

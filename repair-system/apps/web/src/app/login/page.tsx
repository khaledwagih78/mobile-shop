import { Suspense } from 'react';
import { BrandTitle } from '@/components/Brand';
import { supabaseConfigured } from '@/lib/supabase/env';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'تسجيل الدخول — خالد لصيانة المحمول' };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-navy to-navy-600 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="rounded-xl bg-white/95 p-4">
          <BrandTitle />
        </div>
        <Suspense>
          <LoginForm configured={supabaseConfigured} />
        </Suspense>
      </div>
    </div>
  );
}

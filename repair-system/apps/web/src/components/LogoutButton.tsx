'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn-secondary min-h-10 px-4 text-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      تسجيل الخروج
    </button>
  );
}

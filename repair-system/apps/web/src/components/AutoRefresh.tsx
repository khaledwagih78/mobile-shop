'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** For public pages (no login → no Realtime): refresh every N seconds and when the tab is reopened. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    const onVis = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onVis);
    };
  }, [router, seconds]);
  return null;
}

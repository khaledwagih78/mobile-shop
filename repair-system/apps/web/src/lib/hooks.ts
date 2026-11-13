'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { arabicError } from '@kmr/shared';
import { supabaseBrowser } from './supabase/client';

/** Calls an RPC and keeps {data, error, loading}. Re-runs when `key` changes. */
export function useRpc<T>(name: string, args: Record<string, unknown> | null, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const argsRef = useRef(args);
  argsRef.current = args;

  const reload = useCallback(async () => {
    if (argsRef.current === null) return;
    setLoading(true);
    const { data: d, error: e } = await supabaseBrowser().rpc(name, argsRef.current);
    setLoading(false);
    if (e) {
      setError(arabicError(e.message));
      return;
    }
    setError(null);
    setData(d as T);
  }, [name]);

  useEffect(() => {
    const t = setTimeout(reload, 200); // debounce typing in search boxes
    return () => clearTimeout(t);
  }, [reload, key]);

  return { data, error, loading, reload };
}

/**
 * Live refresh: when any row the user may see (RLS applies to Realtime) in
 * these tables changes, call onChange. Also refreshes when the tab regains
 * focus or the network comes back (covers disconnections).
 */
export function useLiveRefresh(tables: string[], onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const tablesKey = tables.join(',');

  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 300);
    };
    const channel = sb.channel(`live:${tablesKey}:${Math.random().toString(36).slice(2)}`);
    for (const t of tablesKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, fire);
    }
    channel.subscribe();
    const onVisible = () => document.visibilityState === 'visible' && fire();
    window.addEventListener('online', fire);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', fire);
      document.removeEventListener('visibilitychange', onVisible);
      sb.removeChannel(channel);
    };
  }, [tablesKey]);
}

/** A stable idempotency key per form "attempt": retries reuse it, a new form gets a new one. */
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  return { key, renew: () => setKey(crypto.randomUUID()) };
}

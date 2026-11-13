import 'server-only';
import { headers } from 'next/headers';
import { SITE_URL } from './supabase/env';

/**
 * Base URL for tracking / receipt links:
 * the shop setting (tracking_base_url) → NEXT_PUBLIC_SITE_URL → current request host.
 */
export async function siteBase(fromSettings?: string | null): Promise<string> {
  if (fromSettings) return fromSettings.replace(/\/+$/, '');
  if (SITE_URL) return SITE_URL.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** The DB builds links from tracking_base_url; when it's empty it returns a relative path "/track/<token>". */
export async function absolute(urlOrPath: string): Promise<string> {
  return urlOrPath.startsWith('http') ? urlOrPath : (await siteBase()) + urlOrPath;
}

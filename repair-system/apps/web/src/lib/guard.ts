import 'server-only';
import { redirect } from 'next/navigation';
import { homeForRole, type AppRole } from '@kmr/shared';
import { getWhoAmI, type WhoAmI } from './supabase/server';

/**
 * UX guard for pages: sends the user to their own home if their role
 * doesn't belong here. NOT the security boundary — the database rejects
 * any unauthorized read/write regardless of what the UI shows.
 */
export async function requireRole(roles: AppRole[]): Promise<WhoAmI> {
  const me = await getWhoAmI();
  if (!me) redirect('/login');
  if (!me.is_active) redirect('/login?inactive=1');
  if (!roles.includes(me.role)) redirect(homeForRole(me.role));
  return me;
}

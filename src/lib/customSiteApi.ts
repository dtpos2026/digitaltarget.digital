// The Custom Website card's reads and writes (v1.108.0), straight to the database's own functions for the signed-in owner
// or admin — so they work wherever the software runs, including the packaged Windows app, which serves no server
// functions. The intake secret never comes back from a read: only rotateCustomSiteKey returns it, once.
import { sb } from '@/lib/supabase';
import { EMPTY_STATUS, type CustomSiteMode, type CustomSiteStatus } from '@/lib/customSite';

const REASONS: Record<string, string> = {
  bad_mode: 'Choose one of the three options.',
  bad_site_url: 'The site address must be a full https:// address, for example https://myrestaurant.com.',
  bad_admin_url: 'The admin address must be a full https:// address.',
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn as never, (args ?? {}) as never);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function getCustomSiteStatus(): Promise<CustomSiteStatus> {
  return { ...EMPTY_STATUS, ...(await call<Partial<CustomSiteStatus>>('custom_site_status')) };
}

export async function saveCustomSiteSettings(input: { mode: CustomSiteMode; siteUrl: string | null; adminUrl: string | null }) {
  const r = await call<{ ok: boolean; reason?: string; siteUrl?: string | null; adminUrl?: string | null }>('custom_site_save', {
    p_mode: input.mode, p_site_url: input.siteUrl, p_admin_url: input.adminUrl,
  });
  if (!r?.ok) throw new Error(REASONS[r?.reason ?? ''] ?? 'The settings could not be saved.');
  return r;
}

/** Create the key, or replace it. The only moment the secret leaves the database. */
export async function rotateCustomSiteKey(): Promise<{ secret: string; hint: string }> {
  return call('custom_site_rotate_key');
}

export async function revokeCustomSiteKey(): Promise<{ ok: true }> {
  return call('custom_site_revoke_key');
}

/** "Check connection": is the own site on, is there a key, would the owner's own switches refuse orders. Places nothing. */
export async function checkCustomSiteConnection(): Promise<{ ok: boolean; message: string }> {
  return call('custom_site_check');
}

/** Super Admin: every restaurant that connects its own website. */
export interface OwnSiteRow {
  tenantId: string; name: string; mode: CustomSiteMode; siteUrl: string | null; adminUrl: string | null;
  hasKey: boolean; lastOrderAt: string | null; lastError: string | null; lastErrorAt: string | null; orders7d: number;
}
export async function listOwnSites(): Promise<OwnSiteRow[]> {
  return (await call<OwnSiteRow[] | null>('sa_custom_site_overview')) ?? [];
}

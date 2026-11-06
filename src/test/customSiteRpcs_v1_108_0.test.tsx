// v1.108.0 — the database functions behind the card, the API wrapper and the Super Admin overview.
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', async (orig) => ({ ...(await orig<any>()), sb: () => ({ rpc }) }));

const api = await import('@/lib/customSiteApi');
const { default: SuperAdminOwnSites, siteState } = await import('@/components/SuperAdminOwnSites');

beforeEach(() => rpc.mockReset());
afterEach(cleanup);

describe('customSiteApi', () => {
  it('reads the status and fills what the database leaves out', async () => {
    rpc.mockResolvedValue({ data: { mode: 'own', hasKey: true, keyHint: '…abcd' }, error: null });
    const s = await api.getCustomSiteStatus();
    expect(rpc).toHaveBeenCalledWith('custom_site_status', {});
    expect(s).toMatchObject({ mode: 'own', hasKey: true, keyHint: '…abcd', orders7d: 0, recentUnmatched: [] });
  });

  it('turns a refusal from the database into a sentence', async () => {
    rpc.mockResolvedValue({ data: { ok: false, reason: 'bad_site_url' }, error: null });
    await expect(api.saveCustomSiteSettings({ mode: 'own', siteUrl: 'http://x', adminUrl: null })).rejects.toThrow(/https:\/\//);
    rpc.mockResolvedValue({ data: null, error: { message: 'only the owner or an admin can use this' } });
    await expect(api.getCustomSiteStatus()).rejects.toThrow(/owner or an admin/);
  });

  it('sends the mode and addresses as named parameters', async () => {
    rpc.mockResolvedValue({ data: { ok: true, siteUrl: 'https://a.example', adminUrl: null }, error: null });
    await api.saveCustomSiteSettings({ mode: 'both', siteUrl: 'a.example', adminUrl: null });
    expect(rpc).toHaveBeenCalledWith('custom_site_save', { p_mode: 'both', p_site_url: 'a.example', p_admin_url: null });
  });

  it('the key comes back from rotate only', async () => {
    rpc.mockResolvedValue({ data: { secret: 'dtcs_x', hint: '…s_x' }, error: null });
    expect((await api.rotateCustomSiteKey()).secret).toBe('dtcs_x');
    rpc.mockResolvedValue({ data: { mode: 'own', hasKey: true, keyHint: '…s_x' }, error: null });
    expect(JSON.stringify(await api.getCustomSiteStatus())).not.toContain('dtcs_');
  });
});

describe('Super Admin: restaurants with their own website', () => {
  const row = (over = {}) => ({ tenantId: 't1', name: 'Karachi Bites', mode: 'own', siteUrl: 'https://kb.example', adminUrl: null, hasKey: true, lastOrderAt: new Date().toISOString(), lastError: null, lastErrorAt: null, orders7d: 9, ...over });

  it('decides the state from the key, the last order and the last problem', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(siteState(row({ mode: 'builtin' }) as any, now)).toBe('off');
    expect(siteState(row({ hasKey: false }) as any, now)).toBe('no_key');
    expect(siteState(row({ lastOrderAt: '2026-11-06T10:00:00Z' }) as any, now)).toBe('ok');
    expect(siteState(row({ lastOrderAt: '2026-11-01T10:00:00Z' }) as any, now)).toBe('quiet');
    expect(siteState(row({ lastOrderAt: null }) as any, now)).toBe('quiet');
    expect(siteState(row({ lastOrderAt: '2026-11-06T10:00:00Z', lastError: 'bad signature', lastErrorAt: '2026-11-06T11:00:00Z' }) as any, now)).toBe('problem');
    // an old problem followed by a good order is not a problem any more
    expect(siteState(row({ lastOrderAt: '2026-11-06T11:00:00Z', lastError: 'bad signature', lastErrorAt: '2026-11-06T10:00:00Z' }) as any, now)).toBe('ok');
  });

  it('lists the restaurants with their state, their numbers and safe links', async () => {
    rpc.mockResolvedValue({ data: [row(), row({ tenantId: 't2', name: 'Lahore Grill', hasKey: false, siteUrl: null })], error: null });
    render(<SuperAdminOwnSites />);
    const r1 = await screen.findByTestId('own-site-t1');
    expect(r1.textContent).toContain('Karachi Bites');
    expect(r1.textContent).toContain('Delivering');
    expect(r1.textContent).toContain('9');
    const link = r1.querySelector('a')!;
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByTestId('own-site-t2').textContent).toContain('No key yet');
  });

  it('says so when nobody has connected one, and when it cannot load', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<SuperAdminOwnSites />);
    expect(await screen.findByText(/No restaurant has connected/)).toBeTruthy();
    cleanup();
    rpc.mockResolvedValue({ data: null, error: { message: 'Super Admin only' } });
    render(<SuperAdminOwnSites />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Could not load/));
  });
});

describe('migration 20261106120000 (card functions + Super Admin overview)', () => {
  const sql = readFileSync('supabase/migrations/20261106120000_v1_108_0_custom_site_rpcs.sql', 'utf8').replace(/^\s*--.*$/gm, '');
  it('every owner function checks the caller is the restaurant\'s owner or admin', () => {
    for (const fn of ['custom_site_status', 'custom_site_save', 'custom_site_rotate_key', 'custom_site_revoke_key']) {
      const body = sql.slice(sql.indexOf(`function public.${fn}(`), sql.indexOf('end $function$', sql.indexOf(`function public.${fn}(`)));
      expect(body, fn).toContain("auth_role() not in ('owner', 'admin')");
      expect(body, fn).toContain('auth_tenant_id()');
    }
  });
  it('the Super Admin function checks is_super_admin and returns no secret', () => {
    const body = sql.slice(sql.indexOf('function public.sa_custom_site_overview'));
    expect(body).toContain('is_super_admin()');
    expect(body).not.toMatch(/'secret'|secret_hint\s*,|'keyHint'/);
  });
  it('no function is open to anon and the secret is only returned by rotate', () => {
    expect(sql).not.toMatch(/grant execute[^;]*\banon\b/);
    expect(sql).toMatch(/revoke all on function public\.custom_site_status\(\) from public, anon/);
    const status = sql.slice(sql.indexOf('function public.custom_site_status'), sql.indexOf('end $function$'));
    expect(status).not.toMatch(/'secret'/);
  });
  it('adds no table, column or policy', () => {
    expect(sql).not.toMatch(/\b(create table|alter table|drop|create policy)\b/i);
  });
});

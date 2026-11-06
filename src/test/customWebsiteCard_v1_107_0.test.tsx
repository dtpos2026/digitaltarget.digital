// v1.107.0 — the "My own website" card, the intake route and the migrations behind it.
import { existsSync, readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_STATUS, type CustomSiteStatus } from '@/lib/customSite';

const fns = vi.hoisted(() => ({
  getCustomSiteStatus: vi.fn(),
  saveCustomSiteSettings: vi.fn(),
  rotateCustomSiteKey: vi.fn(),
  revokeCustomSiteKey: vi.fn(),
  testCustomSiteConnection: vi.fn(),
}));
// v1.108.1 — every call is a database function (customSiteApi); there is no server function behind the card any more.
vi.mock('@/lib/customSiteApi', () => ({
  getCustomSiteStatus: fns.getCustomSiteStatus,
  saveCustomSiteSettings: fns.saveCustomSiteSettings,
  rotateCustomSiteKey: fns.rotateCustomSiteKey,
  revokeCustomSiteKey: fns.revokeCustomSiteKey,
  checkCustomSiteConnection: fns.testCustomSiteConnection,
}));
vi.mock('@/lib/tenant', () => ({ getTenantId: () => '64434fd6-3ea7-4ae2-9c05-6da25a41ad41', getTenantName: () => 'R' }));

import CustomWebsiteCard from '@/components/settings/CustomWebsiteCard';

const status = (over: Partial<CustomSiteStatus> = {}): CustomSiteStatus => ({ ...EMPTY_STATUS, ...over });

beforeEach(() => {
  Object.values(fns).forEach(f => f.mockReset());
  fns.getCustomSiteStatus.mockResolvedValue(status());
});
afterEach(cleanup);

describe('My own website card', () => {
  it('shows the three modes and hides the connection details while the built-in website is selected', async () => {
    render(<CustomWebsiteCard />);
    await waitFor(() => expect(fns.getCustomSiteStatus).toHaveBeenCalled());
    expect(screen.getByTestId('custom-site-mode-builtin').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('custom-site-mode-own')).toBeTruthy();
    expect(screen.getByTestId('custom-site-mode-both')).toBeTruthy();
    expect(screen.queryByTestId('custom-site-intake')).toBeNull();
  });

  it('says plainly what is needed when the database cannot be reached or the user is not the owner', async () => {
    fns.getCustomSiteStatus.mockRejectedValue(new Error('only the owner or an admin can use this'));
    render(<CustomWebsiteCard />);
    expect(await screen.findByText(/signed-in owner or admin/i)).toBeTruthy();
  });

  it('own website: shows the address to post to, with the restaurant id, and no secret yet', async () => {
    fns.getCustomSiteStatus.mockResolvedValue(status({ mode: 'own' }));
    render(<CustomWebsiteCard />);
    const box = await screen.findByTestId('custom-site-intake');
    expect(box.textContent).toContain('/api/custom-site/order/64434fd6-3ea7-4ae2-9c05-6da25a41ad41');
    expect(box.textContent).toContain('x-dt-signature');
    expect(screen.getByTestId('custom-site-key-hint').textContent).toMatch(/not created yet/);
    expect(screen.queryByTestId('custom-site-secret')).toBeNull();
  });

  it('shows the new secret once, and only the last four characters after a reload', async () => {
    fns.getCustomSiteStatus.mockResolvedValue(status({ mode: 'own' }));
    fns.rotateCustomSiteKey.mockResolvedValue({ secret: 'dtcs_SHOWN_ONCE_wxyz', hint: '…wxyz' });
    render(<CustomWebsiteCard />);
    fireEvent.click(await screen.findByRole('button', { name: /create key/i }));
    fns.getCustomSiteStatus.mockResolvedValue(status({ mode: 'own', hasKey: true, keyHint: '…wxyz', keyCreatedAt: '2026-11-06T00:00:00Z' }));
    const secret = await screen.findByTestId('custom-site-secret');
    expect(secret.textContent).toContain('dtcs_SHOWN_ONCE_wxyz');
    expect(secret.textContent).toMatch(/only once/i);
    await waitFor(() => expect(screen.getByTestId('custom-site-key-hint').textContent).toContain('…wxyz'));
    // the status the server sends never carries the secret
    expect(JSON.stringify(status({ hasKey: true, keyHint: '…wxyz' }))).not.toContain('dtcs_');
  });

  it('checks the connection and reports the result in words', async () => {
    fns.getCustomSiteStatus.mockResolvedValue(status({ mode: 'both', hasKey: true, keyHint: '…abcd' }));
    fns.testCustomSiteConnection.mockResolvedValue({ ok: false, status: 409, message: 'Delivery is switched off right now.' });
    render(<CustomWebsiteCard />);
    fireEvent.click(await screen.findByRole('button', { name: /check connection/i }));
    expect((await screen.findByTestId('custom-site-check')).textContent).toContain('Delivery is switched off');
  });

  it('shows health, the last problem and the lines that still need matching', async () => {
    fns.getCustomSiteStatus.mockResolvedValue(status({
      mode: 'own', hasKey: true, keyHint: '…abcd', orders7d: 12, unmatched7d: 2,
      lastError: 'The signature does not match.', lastErrorAt: '2026-11-06T08:00:00Z',
      recentUnmatched: [{ orderNumber: 5174, name: 'Mystery Special', quantity: 3, price: 99, at: '2026-11-06T07:00:00Z' }],
    }));
    render(<CustomWebsiteCard />);
    expect((await screen.findByTestId('custom-site-health')).textContent).toContain('12');
    expect(screen.getByTestId('custom-site-last-error').textContent).toContain('signature does not match');
    expect(screen.getByTestId('custom-site-unmatched').textContent).toContain('3 × Mystery Special');
  });

  it('opens the site and its admin panel in a new tab without handing over the opener', async () => {
    fns.getCustomSiteStatus.mockResolvedValue(status({ siteUrl: 'https://mine.example', adminUrl: 'https://mine.example/wp-admin' }));
    render(<CustomWebsiteCard />);
    const site = await screen.findByRole('link', { name: /open site/i });
    const admin = screen.getByRole('link', { name: /admin panel/i });
    for (const a of [site, admin]) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
  });

  it('saves the mode and the addresses', async () => {
    render(<CustomWebsiteCard />);
    fireEvent.click(await screen.findByTestId('custom-site-mode-own'));
    fireEvent.change(screen.getByLabelText(/site address/i), { target: { value: 'https://mine.example' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(fns.saveCustomSiteSettings).toHaveBeenCalledWith({ mode: 'own', siteUrl: 'https://mine.example', adminUrl: null }));
  });
});

const read = (p: string) => readFileSync(p, 'utf8');

describe('the intake route', () => {
  const route = read('src/routes/api/custom-site/order.$tenantId.ts');

  it('is a POST-only server route that checks the id is a uuid and caps the body', () => {
    expect(route).toContain("createFileRoute('/api/custom-site/order/$tenantId')");
    expect(route).toMatch(/handlers:\s*{\s*POST:/);
    expect(route).not.toMatch(/\bGET:|\bPUT:|\bDELETE:/);
    expect(route).toContain('UUID.test(params.tenantId)');
    expect(route).toContain('MAX_BODY_BYTES');
    expect(route).toContain("'cache-control': 'no-store'");
    expect(route).toContain("x-dt-dry-run");
  });

  it('imports nothing of ours at the top: the production worker must start (v1.108.1)', () => {
    // v1.107.0 put a server function file next to this route and the worker stopped booting. The route loads every module
    // of ours inside its handler, so the server entry's chunk graph does not change.
    const staticImports = [...route.matchAll(/^import\s.*from\s+'([^']+)'/gm)].map(m => m[1]);
    expect(staticImports).toEqual(['@tanstack/react-router']);
  });

  it('there is no server-function file for the Custom Website (it broke the worker once)', () => {
    expect(existsSync('src/lib/customSite.functions.ts')).toBe(false);
    for (const f of ['src/components/settings/CustomWebsiteCard.tsx', 'src/lib/customSiteApi.ts']) {
      expect(read(f)).not.toMatch(/createServerFn|customSite\.functions/);
    }
  });

  it('never logs the body or the secret', () => {
    expect(route).not.toMatch(/console\.\w+\([^)]*(rawBody|secret)/);
    expect(read('src/lib/customSiteIntake.server.ts')).not.toMatch(/console\.\w+/);
  });

  it('the card talks to the database functions, which check the caller themselves', () => {
    const api = read('src/lib/customSiteApi.ts');
    for (const fn of ['custom_site_status', 'custom_site_save', 'custom_site_rotate_key', 'custom_site_revoke_key', 'custom_site_check', 'sa_custom_site_overview']) {
      expect(api).toContain(`'${fn}'`);
    }
    expect(api).not.toMatch(/\.from\(/);   // never touches the closed tables directly
  });
});

describe('the migrations behind v1.107.0', () => {
  const grants = read('supabase/migrations/20261105120000_v1_107_0_close_unused_grants.sql').replace(/^\s*--.*$/gm, '');
  const throttle = read('supabase/migrations/20261105121000_v1_107_0_track_order_throttle.sql').replace(/^\s*--.*$/gm, '');
  // Comments explain the change; the checks below are about the statements.
  const code = (sql: string) => sql.replace(/^\s*--.*$/gm, '');
  const site = code(read('supabase/migrations/20261105122000_v1_107_0_custom_website.sql'));

  it('grants: only removes anon access from signed-in-only functions, and never touches data', () => {
    expect(grants).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
    expect(grants).toMatch(/revoke all on function public\.recycle_bin_restore\(text, uuid\[\]\)\s+from public, anon/);
    expect(grants).toMatch(/revoke all on function public\.sync_super_admins_from_allowlist\(\)\s+from public, anon, authenticated/);
    expect(grants).toMatch(/revoke all on function public\.sync_order_money_mirror\(\)\s+from public, anon, authenticated/);
    expect(grants).not.toMatch(/public_track_order|public_place_order|verify_invoice/);
  });

  it('throttle: guessable lookups are limited per restaurant, the uuid lookup is not, and the table is closed to the API', () => {
    expect(throttle).toContain('c_limit  constant integer := 60');
    expect(throttle).toMatch(/if p_order_id is null then[\s\S]*c_limit/);
    expect(throttle).toContain('alter table public.public_track_attempts enable row level security');
    expect(throttle).toMatch(/revoke all on public\.public_track_attempts from public, anon, authenticated/);
    expect(throttle).toMatch(/exists \(select 1 from tenants t where t\.id = p_tenant\)/);
    expect(throttle).not.toMatch(/revoke execute on function public\.public_track_order/i);
  });

  it('custom website: additive, closed tables, a server-only function, lines matched in three steps', () => {
    expect(site).not.toMatch(/\bdrop\b/i);
    expect(site).not.toMatch(/alter table public\.(orders|order_items|menu_items)/i);
    for (const t of ['custom_site_intake', 'custom_site_orders']) {
      expect(site).toContain(`alter table public.${t} enable row level security`);
      expect(site).toMatch(new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
    }
    expect(site).toMatch(/revoke all on function public\.custom_site_place_order\(uuid, uuid, jsonb\) from public, anon, authenticated/);
    expect(site).toMatch(/grant execute on function public\.custom_site_place_order\(uuid, uuid, jsonb\) to service_role/);
    expect(site).not.toMatch(/grant execute on function public\.custom_site_place_order[^;]*(anon|authenticated)/);
    expect(site).toContain("'menuItemId'");
    expect(site).toContain('m.sku = v_key or m.barcode = v_key');
    expect(site).toContain('lower(btrim(m.name)) = lower(v_name)');
    expect(site).toContain("'source'") ;
    expect(site).toContain("v_type, 'running', 'website'");
  });

  it('there is a rollback for every change, with the exact previous grants', () => {
    const rb = read('docs/rollback/2026-11-05-v1_107_0-rollback.sql');
    expect(rb).toContain('grant execute on function public.sync_super_admins_from_allowlist()                                 to authenticated, service_role');
    expect(rb).toContain('drop table if exists public.public_track_attempts');
    expect(rb).toContain('custom_site_place_order');
    expect(read('docs/rollback/2026-11-05-v1_107_0-public_track_order-before.sql')).toContain('CREATE OR REPLACE FUNCTION public.public_track_order');
  });
});

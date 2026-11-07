// v1.112.0 — the customer's profile on the website shows the offers the restaurant is running (and any promo code in them).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { CustomerProfile } from '@/lib/customerAccount';

const state = vi.hoisted(() => ({ rpc: vi.fn(), codes: [] as Array<{ code: string; isActive: boolean }> }));
vi.mock('@/lib/supabaseClient', async (orig) => {
  const m = await orig<Record<string, unknown>>().catch(() => ({}));
  return { ...m, isSupabaseConfigured: () => true, supabase: { rpc: (...a: unknown[]) => state.rpc(...a) } };
});
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), getPromoCodes: () => state.codes }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { codesInOffer, customerPromotions } from '@/lib/customerAccount';
import CustomerProfilePanel from '@/components/CustomerProfilePanel';

const profile = { id: 'c1', customerCode: 'C-1', photoUrl: null, name: 'Ali', phone: '03001112223', email: null, address: null, city: null, fullAddress: null, addresses: [], dateOfBirth: null } as unknown as CustomerProfile;

describe('codesInOffer', () => {
  it('finds only codes the restaurant really has active, in any letter case, once each', () => {
    expect(codesInOffer('Use eid25 for 25% off', ['EID25', 'OLD10'])).toEqual(['EID25']);
    expect(codesInOffer('EID25 or EID25', ['EID25'])).toEqual(['EID25']);
    expect(codesInOffer('Free delivery this week', ['EID25'])).toEqual([]);
    expect(codesInOffer('Use WELCOME', [])).toEqual([]);
    expect(codesInOffer('', ['A'])).toEqual([]);
  });
});

describe('the panel', () => {
  beforeEach(() => { state.rpc.mockReset(); state.codes = []; localStorage.clear(); });
  const src = readFileSync('src/components/CustomerProfilePanel.tsx', 'utf8');
  it('asks for the offers when it opens and lists them, with a copy button for a real promo code', async () => {
    localStorage.setItem('pos-customer-token', 'tok');
    state.codes = [{ code: 'EID25', isActive: true }, { code: 'OLD10', isActive: false }];
    expect(src).toContain('customerPromotions(tenantId)');
    // the account module reads the token itself; stub the function the panel calls through the module instead
    const mod = await import('@/lib/customerAccount');
    const spy = vi.spyOn(mod, 'customerPromotions').mockResolvedValue([
      { id: 'p1', title: 'Eid offer', body: 'Use EID25 for 25% off. OLD10 is over.', imageUrl: null, deepLink: null, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' },
      { id: 'p2', title: 'Free delivery', body: '', imageUrl: null, deepLink: null, startsAt: '2026-11-01T00:00:00Z', endsAt: null },
    ]);
    render(<CustomerProfilePanel open onClose={() => {}} tenantId="t1" profile={profile} onSaved={() => {}} onLogout={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-profile-offers]')).toBeTruthy());
    expect(screen.getByText('Offers for you')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-profile-offer]')).toHaveLength(2);
    expect(document.querySelector('[data-offer-code="EID25"]')).toBeTruthy();
    expect(document.querySelector('[data-offer-code="OLD10"]')).toBeNull();          // inactive: not offered
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    fireEvent.click(document.querySelector('[data-offer-code="EID25"]')!);
    expect(write).toHaveBeenCalledWith('EID25');
    spy.mockRestore();
  });
  it('shows nothing — not an empty heading — when there are no offers', async () => {
    const mod = await import('@/lib/customerAccount');
    const spy = vi.spyOn(mod, 'customerPromotions').mockResolvedValue([]);
    render(<CustomerProfilePanel open onClose={() => {}} tenantId="t1" profile={profile} onSaved={() => {}} onLogout={() => {}} />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(document.querySelector('[data-profile-offers]')).toBeNull();
    spy.mockRestore();
  });
});

describe('customerPromotions', () => {
  it('is empty without a session and never throws', async () => {
    localStorage.clear();
    expect(await customerPromotions('t1')).toEqual([]);
  });
});

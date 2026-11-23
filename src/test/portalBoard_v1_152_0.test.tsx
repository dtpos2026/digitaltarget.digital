// ============================================================
// v1.152.0 — Customer website & app as the design draws it (SW-35): the title and Preview, four channel cards with a switch each (Website · Delivery · Pickup · Guest
// checkout), Branding (logo, site name, four colours, WhatsApp), Delivery rules (fee, minimum order, radius, the share link with Copy) and Story & contact. Settings
// save as they are typed, as before. Pinned: the rules in lib/portalBoard.ts, every control against the saved settings, what stays below, the old look, the stylesheet.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { getSettings } from '@/lib/store';
import { setTenant } from '@/lib/tenant';
import { BRAND_SWATCHES, CHANNEL_KEY, approvalCaption, channelCards, normalHex, shortLink, whatsappNumber } from '@/lib/portalBoard';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/lib/storage', async (orig) => ({ ...(await orig<typeof import('@/lib/storage')>()), uploadTenantImage: vi.fn(async (_f: File, prefix: string) => `https://img.example/${prefix}.png`) }));
vi.mock('@/lib/store', async (orig) => ({ ...(await orig<typeof import('@/lib/store')>()), refreshOrdersFromCloud: vi.fn(async () => {}) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
const TID = '22222222-2222-4222-8222-222222222222';

describe('the rules', () => {
  it('approvalCaption: manual is "Approval required", anything else "Auto-accept"', () => {
    expect(approvalCaption('manual')).toBe('Approval required'); expect(approvalCaption('auto')).toBe('Auto-accept'); expect(approvalCaption(undefined)).toBe('Auto-accept');
  });

  it('channelCards: the website switch rules the others; the website\'s own approval setting wins over the global one', () => {
    const on = channelCards({});
    expect(on.map(c => [c.key, c.label, c.caption, c.on, c.disabled])).toEqual([
      ['website', 'Website', 'Auto-accept', true, false], ['delivery', 'Delivery', 'Home delivery', true, false], ['pickup', 'Pickup', 'Self pickup', true, false], ['guest', 'Guest checkout', 'No signup needed', true, false],
    ]);
    expect(channelCards({ onlineOrderApprovalMode: 'manual' })[0].caption).toBe('Approval required');
    expect(channelCards({ onlineOrderApprovalMode: 'manual', sourceApprovalMode: { website: 'auto' } })[0].caption).toBe('Auto-accept');
    const off = channelCards({ onlineOrderEnabled: false, onlineDeliveryEnabled: false });
    expect(off[0]).toMatchObject({ on: false, caption: 'Switched off', disabled: false });
    expect(off.slice(1).every(c => c.disabled)).toBe(true);
    expect(off[1].on).toBe(false);
    expect(channelCards({ allowGuestCheckout: false })[3].on).toBe(false);
    expect(CHANNEL_KEY).toEqual({ website: 'onlineOrderEnabled', delivery: 'onlineDeliveryEnabled', pickup: 'onlinePickupEnabled', guest: 'allowGuestCheckout' });
  });

  it('normalHex, whatsappNumber, shortLink, the four swatches', () => {
    expect(normalHex('#ABC')).toBe('#aabbcc'); expect(normalHex('b91c1c')).toBe('#b91c1c'); expect(normalHex(' #B91C1C ')).toBe('#b91c1c'); expect(normalHex('zzz')).toBeNull(); expect(normalHex('')).toBeNull();
    expect(whatsappNumber({ supportWhatsappNumber: '+92 300 1', phone1: '0300' })).toBe('+92 300 1'); expect(whatsappNumber({ phone1: '0300' })).toBe('0300'); expect(whatsappNumber({})).toBe('');
    expect(shortLink('https://digitaltarget.digital/#/order/abc')).toBe('digitaltarget.digital/#/order/abc');
    expect(shortLink('https://digitaltarget.digital/#/order/22222222-2222-4222-8222-222222222222', 30).length).toBe(30);
    expect(shortLink('https://x.test/a', 30)).toBe('x.test/a');
    expect(BRAND_SWATCHES).toEqual(['#b91c1c', '#d9480f', '#0f766e', '#5b21b6']);
  });
});

function seed(settings: Record<string, unknown> = {}) {
  setTenant(TID, 'Sample Restaurant');                                  // the link carries the restaurant's id
  const put = (v: string) => { localStorage.setItem('desi-pos-data', v); localStorage.setItem(`desi-pos-data:${TID}`, v); };
  put(JSON.stringify({
    settings: { name: 'Sample Restaurant', currencySymbol: 'Rs ', onlineOrderApprovalMode: 'manual', deliveryCharge: 150, minOnlineOrder: 800, deliveryRadiusKm: 8, phone1: '0300-1234567', ...settings },
    users: [{ id: 'a1', name: 'Ayesha', username: 'admin', password: 'x', role: 'admin', isActive: true }],
    categories: [], menuItems: [], orders: [], tables: [], floors: [], kitchens: [], waiters: [], riders: [], creditPayments: [], inventory: [], transactions: [], orderCounter: 1,
  }));
  localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Ayesha');
  reload();
}
const mount = async () => { const { default: Page } = await import('@/pages/OnlinePortalPage'); return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>); };
const card = (k: string) => document.querySelector(`[data-op-channel="${k}"]`) as HTMLElement;
const sw = (k: string) => within(card(k)).getByRole('switch') as HTMLButtonElement;
const field = (label: RegExp, root: ParentNode = document) => within(root as HTMLElement).getByLabelText(label) as HTMLInputElement;

describe('the page under DT Refined', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); window.location.hash = '#/online-portal'; seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); });
  afterEach(() => cleanup());

  it('the title, the line under it, "Saved automatically" and Preview', async () => {
    await mount();
    expect(screen.getAllByRole('heading', { level: 1 })[0].textContent).toBe('Customer website & app');
    expect(document.querySelector('[data-op-subtitle]')!.textContent).toBe('How customers order from you');
    expect(document.querySelector('[data-op-saved]')!.textContent).toBe('Saved automatically');
    expect(screen.getByRole('button', { name: /Preview/ })).toBeInTheDocument();
  });

  it('four channel cards with the words the settings give them', async () => {
    await mount();
    expect([...document.querySelectorAll('[data-op-channel]')].map(c => c.getAttribute('data-op-channel'))).toEqual(['website', 'delivery', 'pickup', 'guest']);
    expect(card('website').textContent).toContain('Approval required');
    expect(card('delivery').textContent).toContain('Home delivery');
    expect(sw('website').getAttribute('aria-checked')).toBe('true');
  });

  it('a switch writes its setting; switching the website off switches the rest off and says so', async () => {
    await mount();
    fireEvent.click(sw('guest'));
    expect(getSettings().allowGuestCheckout).toBe(false);
    expect(sw('guest').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw('website'));
    expect(getSettings().onlineOrderEnabled).toBe(false);
    expect(card('website').textContent).toContain('Switched off');
    expect(sw('delivery').disabled).toBe(true); expect(sw('pickup').disabled).toBe(true); expect(sw('guest').disabled).toBe(true);
    fireEvent.click(sw('website'));
    expect(getSettings().onlineOrderEnabled).toBe(true);
    expect(sw('delivery').disabled).toBe(false);
  });

  it('Branding: the site name, the four colours (one picked), a colour of your own, and WhatsApp', async () => {
    await mount();
    const b = document.querySelector('[data-op-branding]') as HTMLElement;
    fireEvent.change(field(/App \/ site name/, b), { target: { value: 'Chai Corner' } });
    expect(getSettings().name).toBe('Chai Corner');
    expect([...b.querySelectorAll('[data-op-swatch]')].map(x => x.getAttribute('data-op-swatch'))).toEqual([...BRAND_SWATCHES]);
    fireEvent.click(b.querySelector('[data-op-swatch="#0f766e"]')!);
    expect(getSettings().onlineBrandColor).toBe('#0f766e');
    expect(b.querySelector('[data-op-swatch="#0f766e"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(b.querySelector('[data-op-swatch="#b91c1c"]')!.getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(within(b).getByLabelText('Custom brand colour'), { target: { value: '#123456' } });
    expect(getSettings().onlineBrandColor).toBe('#123456');
    expect(field(/WhatsApp/, b).value).toBe('0300-1234567');                      // the shop's phone until a WhatsApp number is set
    fireEvent.change(field(/WhatsApp/, b), { target: { value: '+92 300 0000000' } });
    expect(getSettings().supportWhatsappNumber).toBe('+92 300 0000000');
  });

  it('the logo: a picked file is uploaded and kept; Remove clears it', async () => {
    await mount();
    const input = within(document.querySelector('[data-op-branding]') as HTMLElement).getByLabelText('Upload logo') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(getSettings().webPortalLogo).toBe('https://img.example/web-portal-logo.png'));
    fireEvent.click(await screen.findByRole('button', { name: /Remove the website logo/ }));
    expect(getSettings().webPortalLogo).toBe('');
  });

  it('a logo over 2 MB is refused with a message and nothing is saved', async () => {
    await mount();
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 3_000_000 });
    fireEvent.change(within(document.querySelector('[data-op-branding]') as HTMLElement).getByLabelText('Upload logo'), { target: { files: [big] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Logo max 2 MB'));
    expect(getSettings().webPortalLogo).toBeFalsy();
  });

  it('Delivery rules: fee, minimum order, free above and radius are saved as numbers', async () => {
    await mount();
    const d = document.querySelector('[data-op-delivery]') as HTMLElement;
    expect(field(/Delivery fee/, d).value).toBe('150'); expect(field(/Minimum order/, d).value).toBe('800'); expect(field(/Service radius/, d).value).toBe('8');
    fireEvent.change(field(/Delivery fee/, d), { target: { value: '200' } });
    fireEvent.change(field(/Minimum order/, d), { target: { value: '1000' } });
    fireEvent.change(field(/Free above/, d), { target: { value: '2500' } });
    fireEvent.change(field(/Service radius/, d), { target: { value: '12' } });
    expect(getSettings()).toMatchObject({ deliveryCharge: 200, minOnlineOrder: 1000, freeDeliveryThreshold: 2500, deliveryRadiusKm: 12 });
  });

  it('the share link is the website\'s link for this restaurant; Copy puts the whole link on the clipboard; Preview opens it', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = vi.fn(); (window as any).open = open;
    await mount();
    const code = document.querySelector('[data-op-link]') as HTMLElement;
    const full = code.getAttribute('title')!;
    expect(full).toMatch(new RegExp(`/#/order/${TID}$`));
    expect(code.textContent!.length).toBeLessThanOrEqual(38);
    fireEvent.click(document.querySelector('[data-op-copy]')!);
    expect(writeText).toHaveBeenCalledWith(full);
    expect(toast.success).toHaveBeenCalledWith('Website link copied!');
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(open).toHaveBeenCalledWith(full, '_blank', 'noopener');
  });

  it('Story & contact: tagline, phone, address, about, and a banner that can be uploaded and removed', async () => {
    await mount();
    const st = document.querySelector('[data-op-story]') as HTMLElement;
    fireEvent.change(field(/Tagline/, st), { target: { value: 'Fresh daily' } });
    fireEvent.change(field(/Address/, st), { target: { value: 'Lahore' } });
    fireEvent.change(within(st).getByLabelText(/About/), { target: { value: 'Welcome!' } });
    expect(getSettings()).toMatchObject({ onlineTagline: 'Fresh daily', address: 'Lahore', onlineAbout: 'Welcome!' });
    fireEvent.change(within(st).getByLabelText('Upload banner'), { target: { files: [new File(['x'], 'b.png', { type: 'image/png' })] } });
    await waitFor(() => expect(getSettings().onlineBanner).toBe('https://img.example/online-banner.png'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(getSettings().onlineBanner).toBe('');
  });

  it('what the old page had is still there below: the portals and links, opening hours, live orders and customers; its header, master switches and branding card are replaced', async () => {
    await mount();
    expect(screen.getByText('Customer Portals / Websites')).toBeInTheDocument();
    expect(screen.getByText(/Live Website Orders/)).toBeInTheDocument();
    expect(screen.getByText(/Online Customers/)).toBeInTheDocument();
    expect(screen.queryByText('Master Switches')).toBeNull();
    expect(screen.queryByText('Website Branding & Design')).toBeNull();
    expect(screen.queryByText('Customer Portal / Online Website')).toBeNull();
  });

  it('another look keeps the old page: its title, Master Switches and the branding card', async () => {
    cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(document.querySelector('[data-op-page]')).toBeNull();
    expect(screen.getByText('Customer Portal / Online Website')).toBeInTheDocument();
    expect(screen.getByText('Master Switches')).toBeInTheDocument();
    expect(screen.getByText('Website Branding & Design')).toBeInTheDocument();
  });
});

describe('the stylesheet', () => {
  it('is imported and every rule is scoped to DT Refined', () => {
    const css = read('src/styles/ui-refined-portal.css');
    expect(read('src/styles.css')).toContain('ui-refined-portal.css');
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const b of flat.split('}')) {
      const sel = b.split('{')[0].trim();
      if (!sel) continue;
      for (const one of sel.split(/,\s*(?![^()]*\))/)) expect(one.trim(), one).toMatch(/^:root\[data-ui="modern"\]\[data-ui-theme="dt-refined"\]/);
    }
  });
});

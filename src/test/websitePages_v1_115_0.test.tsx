// v1.115.0 — the website's other screens (About, Offers, Help, closed banner, product details, menu sheet), the opening hours
// rule, and the owner's side of it in Settings → Online Portal.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  closedMessage, defaultOpeningHours, formatClock, isPaused, openState, parseOpeningHours, pauseUntil, statusChip, weekLines, wallClock, type OpeningHours,
} from '@/lib/openingHours';
import { orderingBlockedReason, pickStorefront, storefrontAsSettings } from '@/lib/publicStorefront';
import { buildFaq, mapsLink, telLink, waDigits, waLink } from '@/lib/siteHelp';
import { AboutView, ClosedBanner, HelpView, ItemDetailSheet, OffersView, SiteMenuSheet, type DetailItem } from '@/components/website/siteViews';
import OpeningHoursEditor from '@/components/website/OpeningHoursEditor';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** Karachi is UTC+5 all year, so the tests do not depend on the machine's zone or on daylight saving. */
const KHI = 'Asia/Karachi';
const at = (iso: string) => new Date(iso);                 // 2026-11-17 is a Tuesday
const weekly = (over: Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { closed: boolean; open: string; close: string }>> = {}): OpeningHours => {
  const h = defaultOpeningHours();
  return { ...h, enabled: true, timeZone: KHI, days: { ...h.days, ...over } };
};

describe('the opening hours rule', () => {
  it('open inside the day, closed outside it, in the restaurant’s own time zone', () => {
    const h = weekly();                                                          // every day 11:00–23:00
    expect(openState(h, at('2026-11-17T13:00:00Z')).kind).toBe('open');          // 18:00 in Karachi
    expect(openState(h, at('2026-11-17T04:00:00Z')).kind).toBe('closed');        // 09:00 in Karachi
    expect(openState(h, at('2026-11-17T04:00:00Z'))).toMatchObject({ reason: 'schedule', opensAt: { dayOffset: 0, day: 'tue', time: '11:00' } });
    // the same instant is a different hour elsewhere: 13:00Z is 08:00 in New York → closed there
    expect(openState({ ...h, timeZone: 'America/New_York' }, at('2026-11-17T13:00:00Z')).kind).toBe('closed');
    expect(wallClock(at('2026-11-17T13:00:00Z'), KHI)).toMatchObject({ day: 1, minutes: 18 * 60 });
  });
  it('says "closing soon" in the last half hour and when it closes', () => {
    const s = openState(weekly(), at('2026-11-17T17:45:00Z'));                   // 22:45
    expect(s).toMatchObject({ kind: 'open', closesAt: '23:00', closingSoon: true });
    expect(statusChip(s)).toEqual({ tone: 'soon', text: 'Closes soon · 11:00 PM' });
    expect(statusChip(openState(weekly(), at('2026-11-17T13:00:00Z')))).toEqual({ tone: 'open', text: 'Open until 11:00 PM' });
  });
  it('a day that runs past midnight stays open after 00:00, as the day that opened it', () => {
    const h = weekly({ tue: { closed: false, open: '18:00', close: '02:00' } });
    expect(openState(h, at('2026-11-17T13:30:00Z')).kind).toBe('open');          // Tue 18:30
    expect(openState(h, at('2026-11-17T20:00:00Z')).kind).toBe('open');          // Wed 01:00 — still Tuesday's opening
    expect(openState(h, at('2026-11-17T22:00:00Z')).kind).toBe('closed');        // Wed 03:00
  });
  it('a closed day points at the next day it opens', () => {
    const h = weekly({ tue: { closed: true, open: '11:00', close: '23:00' } });
    const s = openState(h, at('2026-11-17T13:00:00Z'));
    expect(s).toMatchObject({ kind: 'closed', reason: 'schedule', opensAt: { dayOffset: 1, day: 'wed', time: '11:00' } });
    expect(closedMessage(s)).toBe('We are closed right now. We open tomorrow at 11:00 AM.');
    expect(closedMessage(openState(weekly({ tue: { closed: true, open: '11:00', close: '23:00' }, wed: { closed: true, open: '11:00', close: '23:00' } }), at('2026-11-17T13:00:00Z')))).toBe('We are closed right now. We open Thursday at 11:00 AM.');
  });
  it('hours that are off, missing or unreadable never close the site', () => {
    expect(openState(null, at('2026-11-17T04:00:00Z')).kind).toBe('always');
    expect(openState({ ...weekly(), enabled: false }, at('2026-11-17T04:00:00Z')).kind).toBe('always');
    expect(parseOpeningHours('nonsense')).toBeNull();
    expect(parseOpeningHours({ enabled: true, days: {} })?.enabled).toBe(false);            // nothing open → cannot be "enabled"
    const p = parseOpeningHours({ enabled: true, timeZone: 'Not/AZone', days: { mon: { open: '9:5', close: '25:00' }, tue: { open: '10:00', close: '10:00' } } })!;
    expect(p.timeZone).toBeUndefined();
    expect(p.days.mon.closed).toBe(true);                                                   // unreadable times = closed, not "always open"
    expect(p.days.tue.closed).toBe(true);                                                   // open == close is not a schedule
  });
  it('the owner’s pause closes the site whatever the hours say, and ends by itself', () => {
    const now = at('2026-11-17T13:00:00Z');
    const until = pauseUntil(now, 30);
    expect(openState(weekly(), now, { pausedUntil: until })).toMatchObject({ kind: 'closed', reason: 'paused' });
    expect(openState(null, now, { pausedUntil: until }).kind).toBe('closed');               // even with no hours at all
    expect(openState(weekly(), at('2026-11-17T13:31:00Z'), { pausedUntil: until }).kind).toBe('open');
    expect(isPaused(until, now)).toBe(true);
    expect(isPaused('', now)).toBe(false);
    expect(isPaused('garbage', now)).toBe(false);
    expect(closedMessage(openState(null, now, { pausedUntil: until }))).toContain('paused online orders');
  });
  it('words: 12-hour clock, the week folded into lines', () => {
    expect(formatClock('00:00')).toBe('12:00 AM');
    expect(formatClock('13:05')).toBe('1:05 PM');
    expect(formatClock('13:05', false)).toBe('13:05');
    const lines = weekLines(weekly({ sat: { closed: false, open: '12:00', close: '23:59' }, sun: { closed: true, open: '11:00', close: '23:00' } }));
    expect(lines).toEqual([
      { label: 'Mon – Fri', hours: '11:00 AM – 11:00 PM', closed: false },
      { label: 'Sat', hours: '12:00 PM – 11:59 PM', closed: false },
      { label: 'Sun', hours: 'Closed', closed: true },
    ]);
  });
});

describe('the server’s and the page’s backstop', () => {
  const sf = (hours: OpeningHours | null, pausedUntil?: string) => ({ onlineOrderEnabled: true, onlineDeliveryEnabled: true, onlinePickupEnabled: true, openingHours: hours, pausedUntil });
  const closedNow = at('2026-11-17T04:00:00Z');
  it('refuses delivery and pickup outside the hours, but not a table order or staff', () => {
    expect(orderingBlockedReason(sf(weekly()), { orderType: 'delivery', source: 'website' }, closedNow)).toContain('We open today at 11:00 AM');
    expect(orderingBlockedReason(sf(weekly()), { orderType: 'takeaway', source: 'website' }, closedNow)).toContain('closed');
    expect(orderingBlockedReason(sf(weekly()), { orderType: 'dining', source: 'qr' }, closedNow)).toBeNull();
    expect(orderingBlockedReason(sf(weekly()), { orderType: 'delivery', source: 'order_taker' }, closedNow)).toBeNull();
    expect(orderingBlockedReason(sf(weekly()), { orderType: 'delivery', source: 'website' }, at('2026-11-17T13:00:00Z'))).toBeNull();
  });
  it('refuses while paused; with no hours set nothing changes from before', () => {
    const now = at('2026-11-17T13:00:00Z');
    expect(orderingBlockedReason(sf(null, pauseUntil(now, 15)), { orderType: 'delivery', source: 'website' }, now)).toContain('paused');
    expect(orderingBlockedReason(sf(null), { orderType: 'delivery', source: 'website' }, closedNow)).toBeNull();
    expect(orderingBlockedReason({ onlineOrderEnabled: true, onlineDeliveryEnabled: true, onlinePickupEnabled: true }, { orderType: 'delivery', source: 'website' })).toBeNull();
  });
  it('the public allow-list carries the new fields — and drops a link that is not a web address', () => {
    const p = pickStorefront({
      name: 'Burger House', onlineAbout: 'Since 1999', onlineInstagram: 'instagram.com/bh', onlineFacebook: 'javascript:alert(1)', onlineTiktok: 'https://tiktok.com/@bh',
      onlineHours: { enabled: true, timeZone: KHI, days: { mon: { open: '11:00', close: '23:00' } } }, onlinePausedUntil: '2026-11-17T14:00:00.000Z',
      ownerWhatsApp: '0300', pin: '1234',
    });
    expect(p.about).toBe('Since 1999');
    expect(p.instagram).toBe('https://instagram.com/bh');
    expect(p.facebook).toBeUndefined();
    expect(p.tiktok).toBe('https://tiktok.com/@bh');
    expect(p.openingHours?.enabled).toBe(true);
    expect(p.pausedUntil).toBe('2026-11-17T14:00:00.000Z');
    expect(JSON.stringify(p)).not.toContain('1234');
    expect(JSON.stringify(p)).not.toContain('0300');
    expect(storefrontAsSettings(p).onlineAbout).toBe('Since 1999');
    expect(pickStorefront({}).openingHours).toBeNull();
  });
});

describe('links and the common questions', () => {
  it('WhatsApp digits, call and map links', () => {
    expect(waDigits('0300 1234567')).toBe('923001234567');
    expect(waDigits('+92 300 1234567')).toBe('923001234567');
    expect(waDigits('003001234567')).toBe('3001234567');
    expect(waDigits('12')).toBeNull();
    expect(waLink('03001234567', 'Hi there')).toBe('https://wa.me/923001234567?text=Hi%20there');
    expect(waLink('', 'x')).toBeNull();
    expect(telLink('0300-1234567')).toBe('tel:03001234567');
    expect(telLink('abc')).toBeNull();
    expect(mapsLink({ address: 'Main Blvd', city: 'Lahore' })).toBe('https://www.google.com/maps/search/?api=1&query=Main%20Blvd%2C%20Lahore');
    expect(mapsLink({ lat: 31.5, lng: 74.3 })).toBe('https://www.google.com/maps/search/?api=1&query=31.5,74.3');
    expect(mapsLink({})).toBeNull();
  });
  it('answers from the restaurant’s own settings, and promises nothing it does not know', () => {
    const base = { restaurant: 'BH', deliveryOn: true, pickupOn: false, deliveryFee: 'Rs 150', freeAbove: 'Rs 2,000', minOrder: 'Rs 500', radiusKm: 8, hours: weekly(), phone: '0300', hasWhatsApp: true, guestCheckout: true };
    const faq = buildFaq(base);
    const q = (t: string) => faq.find(f => f.q.startsWith(t))!.a;
    expect(q('How much is delivery')).toContain('Delivery costs Rs 150');
    expect(q('How much is delivery')).toContain('free on orders of Rs 2,000 or more');
    expect(q('How much is delivery')).toContain('minimum order is Rs 500');
    expect(q('Do you deliver')).toContain('within about 8 km');
    expect(q('When are you open')).toContain('Mon – Sun: 11:00 AM – 11:00 PM');
    expect(q('Do I need an account')).toContain('No — you can order as a guest');
    expect(q('Where is my order')).toContain('WhatsApp or call us');
    const noDelivery = buildFaq({ ...base, deliveryOn: false, pickupOn: true, hours: null, phone: null, hasWhatsApp: false, guestCheckout: false });
    expect(noDelivery.some(f => f.q.startsWith('Do you deliver'))).toBe(false);
    expect(noDelivery.some(f => f.q.startsWith('When are you open'))).toBe(false);
    expect(noDelivery.find(f => f.q.startsWith('Do I need an account'))!.a).toMatch(/^Yes/);
    expect(noDelivery.find(f => f.q.startsWith('Where is my order'))!.a).toContain('contact the restaurant');
  });
});

describe('About us (WEB-02)', () => {
  const info = { name: 'Burger House', tagline: 'Fresh & fast', about: 'Family run.', phone: '0300 1234567', whatsapp: '03001234567', instagram: 'https://instagram.com/bh' };
  const branches = [{ id: 'b1', name: 'Gulberg', address: 'Main Blvd', city: 'Lahore', phone: '042111' }, { id: 'b2', name: 'DHA', address: 'Phase 5', city: 'Lahore' }];
  it('shows who they are and how to reach them — call, WhatsApp, directions', () => {
    render(<AboutView info={info} branches={branches} hours={weekly()} state={openState(weekly(), at('2026-11-17T13:00:00Z'))} hour12 onBack={() => {}} />);
    expect(screen.getByRole('heading', { name: 'About us' })).toBeInTheDocument();
    expect(screen.getByText('Burger House')).toBeInTheDocument();
    expect(screen.getByText('Fresh & fast')).toBeInTheDocument();
    expect(document.querySelector('[data-about-text]')?.textContent).toBe('Family run.');
    const phone = document.querySelector('[data-contact-row="Phone"]') as HTMLAnchorElement;
    expect(phone.getAttribute('href')).toBe('tel:03001234567');
    expect((document.querySelector('[data-contact-row="WhatsApp"]') as HTMLAnchorElement).getAttribute('href')).toContain('https://wa.me/923001234567');
    expect((document.querySelector('[data-contact-row="Address"]') as HTMLAnchorElement).getAttribute('href')).toContain('google.com/maps');
    expect(document.querySelector('[data-open-chip="open"]')?.textContent).toBe('Open until 11:00 PM');
    expect(within(document.querySelector('[data-about-hours]') as HTMLElement).getByText('Mon – Sun')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-about-branch]')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Instagram/ }).getAttribute('rel')).toContain('noopener');
  });
  it('has no empty boxes: no hours, no branches list for one branch, no contact card with nothing in it', () => {
    render(<AboutView info={{ name: 'X' }} branches={[branches[0]]} hours={null} state={{ kind: 'always' }} hour12 onBack={() => {}} />);
    expect(document.querySelector('[data-about-hours]')).toBeNull();
    expect(document.querySelector('[data-about-branches]')).toBeNull();
    expect(document.querySelector('[data-about-social]')).toBeNull();
    expect(document.querySelector('[data-open-chip]')).toBeNull();
  });
  it('the back button goes back, and picking a branch orders from it', () => {
    const back = vi.fn(), pick = vi.fn();
    render(<AboutView info={info} branches={branches} hours={null} state={{ kind: 'always' }} hour12 onBack={back} onPickBranch={pick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the menu' }));
    expect(back).toHaveBeenCalled();
    fireEvent.click(within(document.querySelector('[data-about-branch="b2"]') as HTMLElement).getByRole('button', { name: 'Order from here' }));
    expect(pick).toHaveBeenCalledWith('b2');
  });
});

describe('Offers (WEB-17)', () => {
  const codes = [{ code: 'WELCOME10', title: '10% off your order', validity: 'Valid until 31 Dec', terms: ['Min order Rs 500'] }];
  const deals = [{ id: 'd1', name: 'Family deal', priceText: 'Rs 3,290', contents: '2× Pizza, 1× Fries', available: true }];
  const base = { codes, deals, loading: false, failed: false, closed: false, onBack: () => {}, onRetry: () => {}, onOrderDeal: () => {} };
  it('deal card and promo tickets; copying a code puts it on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const copied = vi.fn(), order = vi.fn();
    render(<OffersView {...base} onCopied={copied} onOrderDeal={order} />);
    expect(screen.getByText('Rs 3,290')).toBeInTheDocument();
    expect(screen.getByText('2× Pizza, 1× Fries')).toBeInTheDocument();
    const ticket = within(document.querySelector('[data-offer-code="WELCOME10"]') as HTMLElement);
    expect(ticket.getByText('Valid until 31 Dec · Min order Rs 500')).toBeInTheDocument();
    fireEvent.click(ticket.getByRole('button', { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('WELCOME10'));
    await waitFor(() => expect(copied).toHaveBeenCalledWith('WELCOME10', true));
    await waitFor(() => expect(ticket.getByRole('button', { name: /Copied/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Order this deal' }));
    expect(order).toHaveBeenCalledWith('d1');
    expect(screen.getByText(/One code per order/)).toBeInTheDocument();
  });
  it('closed: the deal cannot be ordered; unavailable deal says so', () => {
    const { rerender } = render(<OffersView {...base} closed />);
    expect((screen.getByRole('button', { name: 'Closed right now' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<OffersView {...base} deals={[{ ...deals[0], available: false }]} />);
    expect((screen.getByRole('button', { name: 'Not available' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('empty, loading and failed are three different screens', () => {
    const { rerender } = render(<OffersView {...base} codes={[]} deals={[]} />);
    expect(document.querySelector('[data-offers-empty]')).not.toBeNull();
    rerender(<OffersView {...base} codes={[]} deals={[]} loading />);
    expect(document.querySelector('[data-offers-loading]')).not.toBeNull();
    expect(document.querySelector('[data-offers-empty]')).toBeNull();
    const retry = vi.fn();
    rerender(<OffersView {...base} codes={[]} deals={[]} failed onRetry={retry} />);
    expect(document.querySelector('[data-offers-empty]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('Help (WEB-18)', () => {
  const faq = [{ q: 'Where is my order?', a: 'Open My orders.' }, { q: 'How do I cancel?', a: 'Call us.' }];
  it('WhatsApp and Call tiles, the order shortcut, and questions that open one at a time', () => {
    const track = vi.fn();
    render(<HelpView phone="0300 1234567" whatsapp="03001234567" restaurant="BH" faq={faq} lastOrder={{ number: 218 }} onTrackOrder={track} onBack={() => {}} />);
    expect((document.querySelector('[data-help-whatsapp]') as HTMLAnchorElement).getAttribute('href')).toContain('order%20%23218');
    expect((document.querySelector('[data-help-call]') as HTMLAnchorElement).getAttribute('href')).toBe('tel:03001234567');
    fireEvent.click(screen.getByText('Help with order #218'));
    expect(track).toHaveBeenCalled();
    expect(document.querySelector('[data-faq-a]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Where is my order?' }));
    expect(screen.getByText('Open My orders.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'How do I cancel?' }));
    expect(screen.queryByText('Open My orders.')).toBeNull();
    expect(screen.getByText('Call us.')).toBeInTheDocument();
  });
  it('with no phone or WhatsApp it says so instead of showing dead buttons; no order, no shortcut', () => {
    render(<HelpView phone={undefined} whatsapp={null} restaurant="BH" faq={faq} lastOrder={null} onBack={() => {}} />);
    expect(document.querySelector('[data-help-no-contact]')).not.toBeNull();
    expect(document.querySelector('[data-help-whatsapp]')).toBeNull();
    expect(document.querySelector('[data-help-order]')).toBeNull();
  });
});

describe('the closed banner and the menu sheet (WEB-20)', () => {
  it('the banner says what to do and can offer another branch', () => {
    const onBranch = vi.fn();
    render(<ClosedBanner message="We are closed right now. We open today at 11:00 AM." onBranch={onBranch} />);
    expect(screen.getByRole('status')).toHaveTextContent('We open today at 11:00 AM');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another branch' }));
    expect(onBranch).toHaveBeenCalled();
  });
  it('the sheet lists Menu, Offers, About us, Help; picking one closes it and goes there', () => {
    const go = vi.fn(), change = vi.fn();
    render(<SiteMenuSheet open onOpenChange={change} name="BH" items={[{ key: 'menu', label: 'Menu', icon: 'home' }, { key: 'offers', label: 'Offers', icon: 'offers' }, { key: 'about', label: 'About us', icon: 'about' }, { key: 'help', label: 'Help', icon: 'help' }]} active="menu" onGo={go} />);
    expect(document.querySelector('[data-site-nav="menu"]')?.getAttribute('aria-current')).toBe('page');
    fireEvent.click(document.querySelector('[data-site-nav="about"]')!);
    expect(go).toHaveBeenCalledWith('about');
    expect(change).toHaveBeenCalledWith(false);
  });
});

describe('Product details (WEB-05)', () => {
  const money = (n: number) => `Rs ${n.toLocaleString('en-US')}`;
  const pizza: DetailItem = { id: 'm1', name: 'Fajita Pizza', category: 'Pizza', icon: 'pizza', tone: 0, price: 1000, flavors: ['Spicy', 'Mild'], variants: { kind: 'size', list: [{ name: 'Small', price: 900 }, { name: 'Large', price: 1500 }] } };
  const plain: DetailItem = { id: 'm2', name: 'Fries', icon: 'sides', tone: 1, price: 250, flavors: [], variants: null };
  it('asks for the size, then the flavour, before it adds; the price follows the size and the quantity', () => {
    const add = vi.fn();
    render(<ItemDetailSheet item={pizza} money={money} closed={false} onClose={() => {}} onAdd={add} />);
    expect(screen.getByText('From Rs 900')).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).not.toHaveBeenCalled();
    expect(document.querySelector('[data-detail-add]')?.textContent).toBe('Choose a size first');
    fireEvent.click(document.querySelector('[data-detail-size="Large"]')!);
    expect(document.querySelector('[data-detail-price]')?.textContent).toBe('Rs 1,500');
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(document.querySelector('[data-detail-add]')?.textContent).toBe('Choose a flavour first');
    fireEvent.click(document.querySelector('[data-detail-flavor="Mild"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    fireEvent.change(document.querySelector('[data-detail-note]')!, { target: { value: '  no onions ' } });
    expect(document.querySelector('[data-detail-add]')?.textContent).toBe('Add to cart — Rs 3,000');
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).toHaveBeenCalledWith(pizza, { variant: { kind: 'size', name: 'Large', price: 1500 }, flavor: 'Mild', note: 'no onions', qty: 2 });
  });
  it('a plain item adds straight away; quantity never goes below one; closed greys the button out', () => {
    const add = vi.fn();
    const { rerender } = render(<ItemDetailSheet item={plain} money={money} closed={false} onClose={() => {}} onAdd={add} />);
    fireEvent.click(screen.getByRole('button', { name: 'One less' }));
    expect(document.querySelector('[data-detail-qty]')?.textContent).toBe('1');
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).toHaveBeenCalledWith(plain, { note: '', qty: 1 });
    rerender(<ItemDetailSheet item={plain} money={money} closed closedText="We are closed right now." onClose={() => {}} onAdd={add} />);
    const b = document.querySelector('[data-detail-add]') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe('Closed right now');
    expect(screen.getByText('We are closed right now.')).toBeInTheDocument();
  });
});

describe('the software’s side: Settings → Online Portal', () => {
  const settings = (over: Record<string, unknown> = {}) => ({ name: 'BH', ...over }) as never;
  it('turning the hours on saves a complete schedule with a time zone', () => {
    const persist = vi.fn();
    render(<OpeningHoursEditor settings={settings()} persist={persist} />);
    fireEvent.click(document.querySelector('[data-hours-enabled]')!);
    const saved = persist.mock.calls[0][0].onlineHours;
    expect(saved.enabled).toBe(true);
    expect(typeof saved.timeZone).toBe('string');
    expect(Object.keys(saved.days)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(saved.days.sun).toEqual({ closed: false, open: '11:00', close: '23:00' });
  });
  it('a day can be closed or changed, and Monday can be copied to every day', () => {
    const persist = vi.fn();
    const stored = { enabled: true, timeZone: KHI, days: { mon: { closed: false, open: '09:00', close: '21:00' }, tue: { closed: false, open: '11:00', close: '23:00' } } };
    render(<OpeningHoursEditor settings={settings({ onlineHours: stored })} persist={persist} />);
    fireEvent.click(document.querySelector('[data-hours-closed="tue"]')!);
    expect(persist.mock.calls.at(-1)![0].onlineHours.days.tue.closed).toBe(true);
    fireEvent.change(document.querySelector('[data-hours-close="mon"]')!, { target: { value: '22:30' } });
    expect(persist.mock.calls.at(-1)![0].onlineHours.days.mon.close).toBe('22:30');
    fireEvent.click(document.querySelector('[data-hours-copy]')!);
    const days = persist.mock.calls.at(-1)![0].onlineHours.days;
    expect(days.sat).toEqual({ closed: false, open: '09:00', close: '21:00' });
  });
  it('pause: a quick button sets a future time; Resume clears it', () => {
    const persist = vi.fn();
    const { unmount } = render(<OpeningHoursEditor settings={settings()} persist={persist} />);
    fireEvent.click(document.querySelector('[data-pause-minutes="30"]')!);
    const until = persist.mock.calls[0][0].onlinePausedUntil as string;
    expect(Date.parse(until) - Date.now()).toBeGreaterThan(29 * 60_000);
    unmount();
    const p2 = vi.fn();
    render(<OpeningHoursEditor settings={settings({ onlinePausedUntil: new Date(Date.now() + 600_000).toISOString() })} persist={p2} />);
    expect(screen.getByText(/Online orders are paused until/)).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-pause-resume]')!);
    expect(p2).toHaveBeenCalledWith({ onlinePausedUntil: '' });
  });
  it('the links are saved as typed, and the card is on the Online Portal page', () => {
    const persist = vi.fn();
    render(<OpeningHoursEditor settings={settings()} persist={persist} />);
    fireEvent.change(document.querySelector('[data-social="onlineInstagram"]')!, { target: { value: 'instagram.com/bh' } });
    expect(persist).toHaveBeenCalledWith({ onlineInstagram: 'instagram.com/bh' });
    expect(read('src/pages/OnlinePortalPage.tsx')).toContain('<OpeningHoursEditor settings={settings} persist={persist} />');
  });
});

describe('the page', () => {
  const page = read('src/pages/OnlineOrderPage.tsx');
  it('one route serves the site and its extra screens, so the cart survives a visit to Offers', () => {
    expect(read('src/App.tsx')).toContain('<Route path="/order/:tenantId/*" element={<OnlineOrderPage />} />');
    expect(page).toContain("rawView === 'offers' || rawView === 'about' || rawView === 'help'");
    expect(page).toContain('<AboutView');
    expect(page).toContain('<OffersView');
    expect(page).toContain('<HelpView');
    expect(page).toContain('<SiteMenuSheet');
    expect(page).toContain('<ItemDetailSheet');
  });
  it('closed means closed: add is refused, the buttons are greyed, checkout is blocked, and a table guest is not', () => {
    expect(page).toContain('const closedText = !dineIn ? closedMessage(openNow, HOUR12) : null;');
    expect(page).toMatch(/const addItem = \(m: MenuItem\) => \{\s+if \(closedText\) \{ toast\.error\(closedText\); return; \}/);
    expect(page).toContain('onOpen={() => openDetail(m)} disabled={isClosed}');
    expect(page).toContain('openingHours: site?.openingHours ?? null, pausedUntil: site?.pausedUntil');
    expect(page).toMatch(/placing\s+\|\| isClosed/);
  });
  it('a copied code lands in the cart’s code box; the note and quantity from the details reach the cart', () => {
    expect(page).toContain('setPromoInput(code)');
    expect(page).toContain('pushToCart(m, pick.flavor, pick.variant, { qty: pick.qty, note: pick.note })');
    expect(page).toContain("[flavor ? `Flavor: ${flavor}` : '', userNote].filter(Boolean).join(' · ')");
  });
  it('on a phone every dialog is a bottom sheet: the centring translate is zeroed through the variables the minifier cannot drop', () => {
    const css = read('src/styles/ui-screen.css');
    const rule = css.slice(css.indexOf('html[data-screen="phone"] [data-slot="dialog-content"]'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('--tw-translate-x: 0px; --tw-translate-y: 0px;');
  });
  it('the DB function reads the same settings row the page does (the all-branches one)', () => {
    const sql = read('supabase/migrations/20261117120000_v1_115_0_storefront_settings_row.sql');
    expect(sql).toContain("(ts.branch_id = ''00000000-0000-0000-0000-000000000000''::uuid) desc nulls last");
  });
});

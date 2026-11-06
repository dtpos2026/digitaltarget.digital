// v1.109.0 — the screen profile, the page frame and the stylesheet that reads them.
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREAKPOINTS, applyProfile, computeProfile, installScreenProfile, kindForWidth, readScreenOverride, writeScreenOverride,
} from '@/lib/screenProfile';
import { EmptyState, ErrorState, FilterBar, LoadingState, PageHeader } from '@/components/layout/PageFrame';

beforeEach(() => { localStorage.clear(); });
afterEach(cleanup);

describe('the profile is decided by the window', () => {
  it('phone below 640, tablet below 1024, desktop below 2200, TV above', () => {
    expect([359, 639].map(kindForWidth)).toEqual(['phone', 'phone']);
    expect([640, 1023].map(kindForWidth)).toEqual(['tablet', 'tablet']);
    expect([1024, 1366, 1920, 2199].map(kindForWidth)).toEqual(['desktop', 'desktop', 'desktop', 'desktop']);
    expect([2200, 3840].map(kindForWidth)).toEqual(['tv', 'tv']);
    expect(BREAKPOINTS).toEqual({ tablet: 640, desktop: 1024, tv: 2200 });
  });

  it('the gutter and the card width grow with the screen', () => {
    const w = (width: number) => computeProfile({ width, height: 900, coarse: false });
    expect([360, 768, 1366, 2560].map(x => w(x).gutter)).toEqual([12, 16, 24, 32]);
    expect([360, 768, 1366, 2560].map(x => w(x).minCard)).toEqual([150, 168, 200, 240]);
  });

  it('a till at 1366×768 with a mouse is compact; the same width taller is comfortable; a finger is always comfortable', () => {
    expect(computeProfile({ width: 1366, height: 768, coarse: false }).density).toBe('compact');
    expect(computeProfile({ width: 1920, height: 1080, coarse: false }).density).toBe('comfortable');
    expect(computeProfile({ width: 1366, height: 768, coarse: true }).density).toBe('comfortable');
    expect(computeProfile({ width: 390, height: 844, coarse: true }).density).toBe('comfortable');
  });

  it('a finger gets 44 px targets, a mouse none', () => {
    expect(computeProfile({ width: 390, height: 844, coarse: true }).tapMin).toBe(44);
    expect(computeProfile({ width: 1366, height: 768, coarse: false }).tapMin).toBe(0);
  });

  it('the owner can override the kind and the density, and "auto" gives the choice back', () => {
    const p = computeProfile({ width: 1366, height: 768, coarse: false }, { kind: 'tv', density: 'comfortable' });
    expect(p).toMatchObject({ kind: 'tv', density: 'comfortable', gutter: 32 });
    expect(computeProfile({ width: 1366, height: 768, coarse: false }, { kind: 'auto', density: 'auto' }).kind).toBe('desktop');
  });
});

describe('the override is kept per machine', () => {
  it('round-trips, and ignores junk', () => {
    writeScreenOverride({ kind: 'tablet', density: 'compact' });
    expect(readScreenOverride()).toEqual({ kind: 'tablet', density: 'compact' });
    localStorage.setItem('dt-screen-override', JSON.stringify({ kind: 'banana', density: 'huge' }));
    expect(readScreenOverride()).toEqual({ kind: 'auto', density: 'auto' });
    localStorage.setItem('dt-screen-override', '{not json');
    expect(readScreenOverride()).toEqual({});
  });
  it('choosing auto for both removes it', () => {
    writeScreenOverride({ kind: 'tv' });
    writeScreenOverride({ kind: 'auto', density: 'auto' });
    expect(localStorage.getItem('dt-screen-override')).toBeNull();
  });
});

describe('it is written on <html>', () => {
  it('applyProfile sets the attributes and the three variables', () => {
    const root = document.createElement('html');
    applyProfile(root, computeProfile({ width: 390, height: 844, coarse: true }));
    expect(root.dataset).toMatchObject({ screen: 'phone', density: 'comfortable', pointer: 'coarse' });
    expect(root.style.getPropertyValue('--page-gutter')).toBe('12px');
    expect(root.style.getPropertyValue('--grid-min-card')).toBe('150px');
    expect(root.style.getPropertyValue('--tap-min')).toBe('44px');
  });

  it('installScreenProfile measures now, follows a resize and an override, and can be undone', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 1; });
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true });
    const off = installScreenProfile();
    expect(document.documentElement.dataset.screen).toBe('desktop');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.dataset.screen).toBe('phone');
    writeScreenOverride({ kind: 'tablet' });
    expect(document.documentElement.dataset.screen).toBe('tablet');
    off();
    Object.defineProperty(window, 'innerWidth', { value: 2560, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.dataset.screen).toBe('tablet');   // no longer listening
    raf.mockRestore();
  });
});

describe('the page frame', () => {
  it('PageHeader shows the title, subtitle and actions, and a labelled back button only when asked', () => {
    const back = vi.fn();
    const { rerender } = render(<PageHeader title="Customers" subtitle="Everyone who ordered" actions={<button>Add</button>} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Customers');
    expect(screen.getByText('Everyone who ordered')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    rerender(<PageHeader title="Order #1" onBack={back} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });

  it('the three states say what is happening, and Error offers a retry', () => {
    const retry = vi.fn();
    render(<><FilterBar label="Order filters"><input aria-label="Search" /></FilterBar><EmptyState title="No orders" hint="Orders show up here." /><LoadingState /><ErrorState hint="Check the connection." onRetry={retry} /></>);
    expect(screen.getByRole('search', { name: 'Order filters' })).toBeTruthy();
    expect(screen.getByTestId('empty-state').textContent).toContain('No orders');
    expect(screen.getByRole('status').textContent).toContain('Loading');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Could not load this');
  });
});

describe('the stylesheet only reads the profile and never sets a colour', () => {
  const css = readFileSync('src/styles/ui-screen.css', 'utf8');
  it('is imported by the app', () => { expect(readFileSync('src/styles.css', 'utf8')).toContain('ui-screen.css'); });
  it('uses the profile variables', () => {
    for (const v of ['--page-gutter', '--grid-min-card', '--tap-min']) expect(css).toContain(v);
    expect(css).toContain('data-screen="phone"');
    expect(css).toContain('data-pointer="coarse"');
    expect(css).toContain('prefers-reduced-motion');
  });
  it('turns a phone dialog into a bottom sheet (the translate property too, which Tailwind 4 uses)', () => {
    expect(css).toMatch(/data-screen="phone"\] \[data-slot="dialog-content"\][\s\S]*translate: none/);
  });
  it('changes sizes and arrangement only: no colour is set outside the muted subtitle', () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const colourDecls = noComments.match(/(?:^|[;{\s])(?:color|background(?:-color)?|border-color|fill|stroke)\s*:/g) || [];
    expect(colourDecls.length).toBe(1);   // [data-page-subtitle] { color: muted-foreground }
  });
  it('the page gutter in DT Refined follows the profile', () => {
    expect(readFileSync('src/styles/ui-refined-components.css', 'utf8')).toContain('padding: var(--page-gutter, 16px)');
  });
});

describe('Settings → Appearance → Screen', () => {
  it('shows what was measured and lets the owner override it, then go back to automatic', async () => {
    const { default: Card } = await import('@/components/settings/ScreenProfileCard');
    render(<Card />);
    expect(screen.getByTestId('screen-profile-now').textContent).toMatch(/Screen/);
    expect(screen.queryByTestId('screen-reset')).toBeNull();
    fireEvent.click(screen.getByTestId('screen-kind-tv'));
    expect(readScreenOverride().kind).toBe('tv');
    expect(screen.getByTestId('screen-kind-tv').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('screen-density-compact'));
    expect(readScreenOverride()).toEqual({ kind: 'tv', density: 'compact' });
    fireEvent.click(screen.getByTestId('screen-reset'));
    expect(localStorage.getItem('dt-screen-override')).toBeNull();
    expect(screen.queryByTestId('screen-reset')).toBeNull();
  });
  it('is mounted under Appearance', () => {
    expect(readFileSync('src/pages/SettingsPage.tsx', 'utf8')).toMatch(/<InterfaceStyleCard \/>\s*<ScreenProfileCard \/>/);
  });
});

// v1.103.0 — the colour scheme can be changed from the top bar (DT Refined), not only from Settings → Appearance.
// A scheme is only a page colour and an accent: nothing moves, so the owner's rule "themes change colours, not the UI" holds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HashRouter } from '@/lib/hash-router';
import { getAccentOverride, getRefinedSurface, setTheme, setUiStyle, setRefinedSurface, clearAccent } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { REFINED_SCHEMES, activeRefinedScheme, applyRefinedScheme } from '@/lib/refinedSchemes';

vi.mock('@/components/HeaderNotificationBar', () => ({ default: () => null }));
vi.mock('@/components/BillingStatusBar', () => ({ default: () => null }));
vi.mock('@/components/shell/HeaderClock', () => ({ default: () => null }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

const mount = async () => {
  const { default: ModernHeader } = await import('@/components/shell/ModernHeader');
  return render(
    <TooltipProvider><HashRouter>
      <ModernHeader title="Dashboard" collapsed={false} onToggleCollapse={() => {}} onOpenMobileMenu={() => {}} onOpenLauncher={() => {}} zoom={100} onZoom={() => {}} onResetZoom={() => {}} />
    </HashRouter></TooltipProvider>,
  );
};

describe('shared scheme logic', () => {
  beforeEach(() => { localStorage.clear(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); setRefinedSurface('lavender'); clearAccent(); });

  it('applying a scheme sets its page colour and accent; one without an accent restores the design package purple', () => {
    const sunrise = REFINED_SCHEMES.find(s => s.id === 'sunrise')!;
    applyRefinedScheme(sunrise);
    expect(getRefinedSurface()).toBe('warm');
    expect(getAccentOverride()).toBe('#d9480f');
    expect(activeRefinedScheme(getRefinedSurface(), getAccentOverride())?.id).toBe('sunrise');
    applyRefinedScheme(REFINED_SCHEMES.find(s => s.id === 'dt-purple')!);
    expect(getAccentOverride()).toBeNull();
    expect(activeRefinedScheme(getRefinedSurface(), getAccentOverride())?.id).toBe('dt-purple');
  });

  it('a surface or accent that no scheme describes reads as Custom (null)', () => {
    setRefinedSurface('cool');
    expect(activeRefinedScheme('cool', '#123456')).toBeNull();
  });
});

describe('the top bar switcher', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); });
  afterEach(() => cleanup());

  it('DT Refined: one click on a swatch changes the scheme and marks it in use', async () => {
    setUiStyle('modern'); setTheme(REFINED_THEME_ID); setRefinedSurface('lavender'); clearAccent();
    await mount();
    fireEvent.click(screen.getByTestId('scheme-switcher'));
    const group = await screen.findByRole('radiogroup', { name: 'Colour scheme' });
    expect(within(group).getAllByRole('radio')).toHaveLength(REFINED_SCHEMES.length);
    expect(within(group).getByRole('radio', { name: /DT Purple/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: /Berry/ }));
    expect(getAccentOverride()).toBe('#be185d');
    expect(getRefinedSurface()).toBe('white');
    expect(within(await screen.findByRole('radiogroup', { name: 'Colour scheme' })).getByRole('radio', { name: /Berry/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('every other theme: no switcher in the bar', async () => {
    setUiStyle('modern'); setTheme('ember');
    await mount();
    expect(screen.queryByTestId('scheme-switcher')).toBeNull();
  });
});

// v1.133.0 — the Menu screen is the design's (SW-13): a table of items with an Available switch, category pills, and the Edit item panel beside it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { HashRouter } from '@/lib/hash-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getMenuItems, getDeletedMenuItems } from '@/lib/store';
import { setTheme, setUiStyle } from '@/lib/uiStyle';
import { REFINED_THEME_ID } from '@/lib/uiThemes';
import { priceLabel, variantsLabel } from '@/pages/MenuManagerPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn(), loading: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
// Radix selects measure and scroll their list
(Element.prototype as any).scrollIntoView ??= () => {};
(Element.prototype as any).hasPointerCapture ??= () => false;
(Element.prototype as any).releasePointerCapture ??= () => {};

describe('what the table says', () => {
  it('Variants: size, inch, both, flavours, or a dash', () => {
    expect(variantsLabel({ sizeVariants: [{ name: 'S', price: 1 }] })).toBe('Size');
    expect(variantsLabel({ inchVariants: [{ name: '9"', price: 1 }] })).toBe('Inch');
    expect(variantsLabel({ sizeVariants: [{ name: 'S', price: 1 }], inchVariants: [{ name: '9"', price: 1 }] })).toBe('Size + Inch');
    expect(variantsLabel({ flavors: ['Spicy'] })).toBe('Flavors');
    expect(variantsLabel({})).toBe('—');
  });
  it('Price: the price, the cheapest size as "From", the rate per kg, or Manual', () => {
    expect(priceLabel({ pricingType: 'fixed', price: 1450 } as any)).toMatch(/1,450/);
    expect(priceLabel({ pricingType: 'size', price: 0, sizeVariants: [{ name: 'M', price: 1250 }, { name: 'S', price: 950 }] } as any)).toMatch(/^From .*950/);
    expect(priceLabel({ pricingType: 'weight', ratePerKg: 2200 } as any)).toMatch(/2,200\/kg$/);
    expect(priceLabel({ pricingType: 'manual' } as any)).toBe('Manual');
  });
});

describe('the Menu screen, mounted', () => {
  const reload = () => window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: 'test', to: 'test' } }));
  const seed = () => {
    localStorage.setItem('desi-pos-data', JSON.stringify({
      settings: { name: 'Sample', currencySymbol: 'Rs ' },
      users: [{ id: 'a1', name: 'Owner', username: 'owner', password: 'x', role: 'admin', isActive: true }],
      categories: [{ id: 'c1', name: 'Pizza', icon: '', sortOrder: 1 }, { id: 'c2', name: 'Burgers', icon: '', sortOrder: 2 }],
      menuItems: [
        { id: 'm1', name: 'Chicken Tikka Pizza', price: 1450, categoryId: 'c1', pricingType: 'size', sizeVariants: [{ name: 'Small', price: 950 }, { name: 'Large', price: 1450 }], isActive: true, kitchenId: 'k1' },
        { id: 'm2', name: 'Zinger Burger', price: 650, categoryId: 'c2', pricingType: 'fixed', isActive: true },
        { id: 'm3', name: 'Old Special', price: 300, categoryId: 'c2', pricingType: 'fixed', isActive: false },
      ],
      kitchens: [{ id: 'k1', name: 'Main kitchen' }], tables: [], floors: [], orders: [], waiters: [], riders: [], inventory: [], orderCounter: 10,
    }));
    localStorage.setItem('pos-user-id', 'a1'); localStorage.setItem('pos-user-role', 'admin'); localStorage.setItem('pos-user-name', 'Owner');
    reload();
  };
  const wide = () => { (window as any).matchMedia = (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }); };
  const mount = async () => {
    const { default: Page } = await import('@/pages/MenuManagerPage');
    window.location.hash = '#/menu';
    return render(<TooltipProvider><HashRouter><Page /></HashRouter></TooltipProvider>);
  };
  beforeEach(() => { cleanup(); localStorage.clear(); seed(); setUiStyle('modern'); setTheme(REFINED_THEME_ID); wide(); });
  afterEach(() => { cleanup(); delete (window as any).matchMedia; });
  const rows = (c: HTMLElement) => [...c.querySelectorAll('[data-menu-row]')].map(r => r.getAttribute('data-menu-row'));

  it('is titled Menu with its counts; Import Excel and Add item are the buttons, the rest is in ⋯', async () => {
    const { container } = await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Menu');
    expect(container.textContent).toMatch(/3 items · 2 categories/);
    const header = container.querySelector('[data-menu-header]') as HTMLElement;
    expect(within(header).getByRole('button', { name: /Import Excel/ })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /Add item/ })).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: /Delete All Menu/i })).toBeNull();
    fireEvent.click(within(header).getByRole('button', { name: 'More' }));
    expect([...document.querySelectorAll('[data-menu-more-item]')].map(b => b.getAttribute('data-menu-more-item'))).toEqual(['category', 'manage', 'images', 'recycle', 'delete-all']);
  });

  it('the table has the design\'s columns and a row per item, with variants, price and the Available switch', async () => {
    const { container } = await mount();
    expect([...container.querySelectorAll('thead th')].slice(1).map(t => t.textContent)).toEqual(['Item', 'Category', 'Price', 'Variants', 'Kitchen', 'Available']);
    expect(rows(container).sort()).toEqual(['m1', 'm2', 'm3']);
    const r = container.querySelector('[data-menu-row="m1"]') as HTMLElement;
    expect(r.textContent).toMatch(/Chicken Tikka Pizza/);
    expect(r.textContent).toMatch(/From .*950/);
    expect(r.textContent).toMatch(/Size/);
    expect(r.textContent).toMatch(/Main kitchen/);
  });

  it('the category pills filter; Hidden shows what is switched off; the search finds by name', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-menu-cat="c1"]')!);
    expect(rows(container)).toEqual(['m1']);
    fireEvent.click(container.querySelector('[data-menu-cat="hidden"]')!);
    expect(rows(container)).toEqual(['m3']);
    fireEvent.click(container.querySelector('[data-menu-cat="all"]')!);
    fireEvent.change(screen.getByLabelText('Search menu'), { target: { value: 'zinger' } });
    expect(rows(container)).toEqual(['m2']);
  });

  it('the Available switch saves at once and the item leaves the till', async () => {
    const { container } = await mount();
    fireEvent.click(within(container.querySelector('[data-menu-row="m2"]') as HTMLElement).getByRole('switch', { name: /Zinger Burger available/ }));
    await waitFor(() => expect(getMenuItems().find(i => i.id === 'm2')!.isActive).toBe(false));
  });

  it('a row opens the Edit item panel; changing the name and pressing Save item saves it', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-menu-row="m2"]')!);
    const panel = container.querySelector('[data-item-panel]') as HTMLElement;
    expect(panel.getAttribute('data-item-panel')).toBe('m2');
    expect(screen.getByRole('heading', { name: 'Edit item' })).toBeInTheDocument();
    expect(within(panel).getAllByRole('tab').map(t => t.textContent)).toEqual(['Fixed price', 'Sizes', 'Inch', 'By weight']);
    expect(within(panel).getByRole('switch', { name: 'Available' })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Zinger Burger XL' } });
    fireEvent.change(within(panel).getByLabelText('Price (PKR)'), { target: { value: '700' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(getMenuItems().find(i => i.id === 'm2')).toMatchObject({ name: 'Zinger Burger XL', price: 700 }));
  });

  it('the price kind tabs change how the item is priced', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-menu-row="m2"]')!);
    const panel = container.querySelector('[data-item-panel]') as HTMLElement;
    fireEvent.click(within(panel).getByRole('tab', { name: 'By weight' }));
    expect(within(panel).getByLabelText(/Rate per KG/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('tab', { name: 'Sizes' }));
    expect(within(panel).getByText('Size variants')).toBeInTheDocument();
  });

  it('everything the old form had is still in the panel, under More options', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-menu-row="m2"]')!);
    const more = container.querySelector('[data-item-more]') as HTMLElement;
    for (const w of ['Stock item link', 'Flavors', 'Sub-category', 'Description', 'Other price kinds']) expect(more.textContent).toContain(w);
  });

  it('Delete item moves the item to the recycle bin, as the row trash button did', async () => {
    const { container } = await mount();
    fireEvent.click(container.querySelector('[data-menu-row="m3"]')!);
    fireEvent.click(within(container.querySelector('[data-item-panel]') as HTMLElement).getByRole('button', { name: /Delete item/ }));
    await waitFor(() => expect(getMenuItems().some(i => i.id === 'm3')).toBe(false));
    expect(getDeletedMenuItems().some(i => i.id === 'm3')).toBe(true);
  });

  it('Add item opens an empty panel headed Add item', async () => {
    const { container } = await mount();
    fireEvent.click(within(container.querySelector('[data-menu-header]') as HTMLElement).getByRole('button', { name: /Add item/ }));
    expect(screen.getByRole('heading', { name: 'Add item' })).toBeInTheDocument();
    expect((within(container.querySelector('[data-item-panel]') as HTMLElement).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(container.querySelector('[data-item-delete]')).toBeNull();                      // nothing to delete yet
  });

  it('Manage categories shows rename / move / delete beside each pill, and hides them again', async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-menu-cat-tools]')).toBeNull();
    fireEvent.click(within(container.querySelector('[data-menu-header]') as HTMLElement).getByRole('button', { name: 'More' }));
    fireEvent.click(document.querySelector('[data-menu-more-item="manage"]')!);
    expect(container.querySelectorAll('[data-menu-cat-tools]')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Rename Pizza' })).toBeInTheDocument();
  });

  it('another look keeps the old page (no table of the design, the dialog form)', async () => {
    setTheme('ember');
    const { container } = await mount();
    expect(container.querySelector('[data-menu-table]')).toBeNull();
    expect(screen.getByRole('button', { name: /Delete All Menu/ })).toBeInTheDocument();
  });
});

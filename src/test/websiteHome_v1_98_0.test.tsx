// ============================================================
// v1.98.0 — the customer website's home (design package WEB-01): header with the Delivery / Pickup switch and search, a hero,
// category tiles, item cards and the cart bar. The page keeps every rule; these are the content rules and the building blocks.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Category, Deal, MenuItem } from '@/lib/types';
import { TONES, categoryTiles, heroFor, iconFor, priceLabel, toneIndex } from '@/lib/websiteHome';
import { CartBar, CategoryTiles, HeroBanner, ItemCard, SiteHeader, type SiteHeaderProps } from '@/components/website/siteBits';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const item = (id: string, categoryId: string, extra: Partial<MenuItem> = {}) => ({ id, name: id, categoryId, price: 100, isActive: true, ...extra }) as MenuItem;
const cat = (id: string, name: string, sortOrder: number, extra: Partial<Category> = {}) => ({ id, name, sortOrder, ...extra }) as Category;
const money = (n: number) => `Rs ${n.toLocaleString('en-US')}`;

describe('the hero', () => {
  const items = [item('m1', 'c1', { name: 'Zinger' }), item('d1', 'c2', { name: 'Family Deal' })];
  const deal = { id: 'd1', name: 'Family Deal', price: 3290, isActive: true, createdAt: '', items: [{ menuItemId: 'm1', quantity: 2 }] } as unknown as Deal;

  it('leads with the restaurant\'s own banner and tagline when it has uploaded one', () => {
    expect(heroFor({ banner: 'https://cdn/b.jpg', tagline: 'Fresh since 1999', name: 'Sample', deals: [deal], items }))
      .toMatchObject({ kind: 'banner', title: 'Fresh since 1999', subtitle: 'Sample', image: 'https://cdn/b.jpg' });
    expect(heroFor({ banner: 'data:image/png;base64,AAAA', name: 'Sample', deals: [], items })).toMatchObject({ kind: 'banner', title: 'Sample' });
  });

  it('else sells the first active deal that can be ordered, with what is in it', () => {
    const h = heroFor({ name: 'Sample', deals: [{ ...deal, id: 'gone', isActive: true } as Deal, deal], items });
    expect(h).toMatchObject({ kind: 'deal', title: 'Family Deal', dealId: 'd1', dealPrice: 3290, subtitle: '2× Zinger' });
    expect(heroFor({ name: 'Sample', deals: [{ ...deal, isActive: false } as Deal], items }).kind).toBe('brand');
  });

  it('else is the restaurant\'s name and tagline — and never an invented offer', () => {
    expect(heroFor({ name: ' Sample ', tagline: ' Good food ', deals: [], items: [] })).toEqual({ kind: 'brand', title: 'Sample', subtitle: 'Good food' });
    expect(heroFor({ name: '', deals: [], items: [] }).title).toBe('Restaurant');
    expect(heroFor({ banner: 'javascript:alert(1)', name: 'S', deals: [], items: [] }).kind).toBe('brand');   // only real image links
  });
});

describe('the category tiles', () => {
  it('only categories with something to order, in the restaurant\'s order, with counts', () => {
    const t = categoryTiles([cat('b', 'Burgers', 2), cat('a', 'Pizza', 1), cat('z', 'Empty', 3)], [item('1', 'a'), item('2', 'a'), item('3', 'b')]);
    expect(t.map(x => [x.id, x.count])).toEqual([['a', 2], ['b', 1]]);
  });
  it('a picture is used only when it is a real image link; icons follow the name; a name keeps its colour', () => {
    const t = categoryTiles([cat('a', 'Pizza', 1, { image: 'https://cdn/p.jpg' }), cat('b', 'Drinks', 2, { image: 'nonsense' })], [item('1', 'a'), item('2', 'b')]);
    expect(t[0].image).toBe('https://cdn/p.jpg');
    expect(t[1].image).toBeUndefined();
    expect([iconFor('Chicken Pizza'), iconFor('Zinger Burgers'), iconFor('Karahi & BBQ'), iconFor('Cold Drinks'), iconFor('Family Deals'), iconFor('Desserts'), iconFor('Misc')])
      .toEqual(['pizza', 'burger', 'pot', 'drink', 'gift', 'dessert', 'default']);
    expect(toneIndex('Pizza')).toBe(toneIndex('Pizza'));
    for (const n of ['A', 'Pizza', 'Karahi', '']) expect(toneIndex(n)).toBeLessThan(TONES.length);
  });
  it('a price reads "Rs 1,450", or "From Rs 950" for an item with sizes', () => {
    expect(priceLabel(money, 1450)).toBe('Rs 1,450');
    expect(priceLabel(money, 1450, 950)).toBe('From Rs 950');
  });
});

describe('the building blocks', () => {
  const header = (over: Partial<SiteHeaderProps> = {}): SiteHeaderProps => ({
    name: 'Sample', search: '', onSearch: vi.fn(), signedIn: false, showOrders: true, onProfile: vi.fn(), onOrders: vi.fn(), onLogin: vi.fn(), cartCount: 0, onCart: vi.fn(), ...over,
  });

  it('the header: brand, search, sign in, and a cart that counts', () => {
    const p = header({ cartCount: 3 });
    render(<SiteHeader {...p} />);
    expect(screen.getByRole('heading', { name: 'Sample' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search the menu'), { target: { value: 'pizza' } });
    expect(p.onSearch).toHaveBeenCalledWith('pizza');
    fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
    expect(p.onLogin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cart, 3 items' }));
    expect(p.onCart).toHaveBeenCalled();
    expect(document.querySelector('[data-cart-count]')!.textContent).toBe('3');
    expect(document.querySelector('[data-fulfilment-switch]')).toBeNull();      // no choice to make → no switch
  });

  it('the header: signed in shows the profile and orders; the Delivery / Pickup switch only when given, and it switches', () => {
    const onChange = vi.fn();
    const p = header({ signedIn: true, accountName: 'Sara', ordersCount: 2, fulfilment: { value: 'delivery', onChange } });
    render(<SiteHeader {...p} />);
    expect(screen.getByText('Sara')).toBeInTheDocument();
    expect(screen.getByText('My orders')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign in/ })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Delivery' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Pickup' }));
    expect(onChange).toHaveBeenCalledWith('pickup');
  });

  it('the hero: a deal hero offers Order now; a brand hero offers the menu', () => {
    const order = vi.fn();
    const { rerender } = render(<HeroBanner hero={{ kind: 'deal', title: 'Family Deal', subtitle: '2× Zinger', dealId: 'd1', dealPrice: 3290 }} price="Rs 3,290" onOrder={order} />);
    expect(screen.getByRole('heading', { name: 'Family Deal — Rs 3,290' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Order now' }));
    expect(order).toHaveBeenCalled();
    rerender(<HeroBanner hero={{ kind: 'brand', title: 'Sample' }} onOrder={order} />);
    expect(screen.getByRole('button', { name: 'See the menu' })).toBeInTheDocument();
    expect(document.querySelector('[data-hero="brand"]')).toBeTruthy();
  });

  it('the tiles open their category', () => {
    const pick = vi.fn();
    render(<CategoryTiles tiles={categoryTiles([cat('a', 'Pizza', 1)], [item('1', 'a'), item('2', 'a')])} onPick={pick} />);
    expect(screen.getByText('2 items')).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-category-tile="a"]')!);
    expect(pick).toHaveBeenCalledWith('a');
  });

  it('an item card is an Add button, a Choose-size button, or a quantity stepper', () => {
    const base = { id: 'm1', name: 'Zinger', priceText: 'Rs 650', icon: 'burger' as const, tone: 1, onAdd: vi.fn(), onMinus: vi.fn(), onPlus: vi.fn() };
    const { rerender } = render(<ItemCard {...base} mode="add" />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Zinger' }));
    expect(base.onAdd).toHaveBeenCalledTimes(1);
    rerender(<ItemCard {...base} mode="choose" priceText="From Rs 950" notes={['3 sizes']} />);
    expect(screen.getByText('From Rs 950')).toBeInTheDocument();
    expect(screen.getByText('3 sizes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose size' }));
    expect(base.onAdd).toHaveBeenCalledTimes(2);
    rerender(<ItemCard {...base} mode="stepper" quantity={2} />);
    expect(document.querySelector('[data-qty]')!.textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Add one Zinger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Zinger' }));
    expect(base.onPlus).toHaveBeenCalled(); expect(base.onMinus).toHaveBeenCalled();
  });

  it('the cart bar shows the count and the total and opens the cart', () => {
    const open = vi.fn();
    render(<>{CartBar({ count: 4, total: 'Rs 2,600', onOpen: open })}</>);
    expect(screen.getByText('Rs 2,600')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View cart/ }));
    expect(open).toHaveBeenCalled();
  });
});

describe('the page', () => {
  const page = read('src/pages/OnlineOrderPage.tsx');
  it('uses the new blocks, shows the hero and tiles only on the home view, and keeps its ordering rules', () => {
    for (const c of ['<SiteHeader', '<HeroBanner', '<CategoryRail', '<ItemCard', '<CartBar']) expect(page, c).toContain(c);
    expect(page).toContain("const isHome = activeCat === 'all' && !search.trim();");
    expect(page).toMatch(/\{isHome && !dineIn && menuItems\.length > 0 && \(\s*<HeroBanner/);
    // the switch in the header only when both ways are offered (v1.95.0)
    expect(page).toContain('fulfilment={!dineIn && fulfilOpts.delivery && fulfilOpts.pickup ?');
    // the cart, the sizes and the quantity helpers are the page's own, unchanged
    for (const k of ['addItem(m)', 'updateQty(inCart.id, -1)', 'variantInfo(m)', 'placeOrder']) expect(page, k).toContain(k);
    // the old Roman-Urdu card text is gone
    expect(page).not.toContain('Select karein');
  });
});

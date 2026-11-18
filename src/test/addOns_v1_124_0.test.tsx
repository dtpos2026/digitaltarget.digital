// v1.124.0 — product descriptions and add-on groups on the website: the rules, the owner's editor, the details sheet, the cart and the
// database function that prices it all on the server.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeGroups, addOnNote, checkChoice, cleanGroups, groupIssues, hasAddOns, liveOptions, maxOf, toggleChoice, type AddOnGroup } from '@/lib/addOns';
import { ItemDetailSheet, type DetailItem } from '@/components/website/siteViews';
import AddOnEditor from '@/components/menu/AddOnEditor';
import { rowFromDb, rowToDb } from '@/lib/supabaseStore';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');
const money = (n: number) => `Rs ${n.toLocaleString('en-US')}`;

const dip: AddOnGroup = { id: 'g-dip', name: 'Dip', required: true, max: 1, options: [{ id: 'o-ketchup', name: 'Ketchup', price: 0 }, { id: 'o-garlic', name: 'Garlic mayo', price: 30 }] };
const extras: AddOnGroup = { id: 'g-ex', name: 'Extras', max: 2, options: [
  { id: 'o-cheese', name: 'Extra cheese', price: 50 }, { id: 'o-jala', name: 'Jalapeno', price: 20 }, { id: 'o-bacon', name: 'Bacon', price: 80 }, { id: 'o-off', name: 'Retired', price: 10, isActive: false },
] };

describe('the add-on rules', () => {
  it('pick-one swaps the choice, a limit stops a further choice, un-ticking always works', () => {
    const groups = [dip, extras];
    let sel: string[] = [];
    sel = toggleChoice(groups, sel, 'o-ketchup');
    sel = toggleChoice(groups, sel, 'o-garlic');
    expect(sel).toEqual(['o-garlic']);                                       // pick one: the second replaces the first
    sel = toggleChoice(groups, sel, 'o-cheese');
    sel = toggleChoice(groups, sel, 'o-jala');
    sel = toggleChoice(groups, sel, 'o-bacon');
    expect(sel).toEqual(['o-garlic', 'o-cheese', 'o-jala']);                 // up to 2 extras: the third is ignored
    expect(toggleChoice(groups, sel, 'o-cheese')).toEqual(['o-garlic', 'o-jala']);
    expect(toggleChoice(groups, sel, 'nope')).toEqual(sel);                  // an unknown id changes nothing
  });
  it('a required group must be chosen; the price is the sum of what is chosen; retired options are never offered or counted', () => {
    expect(checkChoice([dip, extras], [])).toMatchObject({ ok: false, problems: [{ groupId: 'g-dip', message: 'Choose Dip' }], total: 0 });
    const c = checkChoice([dip, extras], ['o-garlic', 'o-cheese', 'o-off']);
    expect(c.ok).toBe(true);
    expect(c.total).toBe(80);                                                // 30 + 50; the retired option adds nothing
    expect(c.chosen.map(o => o.id)).toEqual(['o-garlic', 'o-cheese']);
    expect(liveOptions(extras).map(o => o.id)).toEqual(['o-cheese', 'o-jala', 'o-bacon']);
    expect(addOnNote(c.chosen)).toBe('+ Garlic mayo, + Extra cheese');
    // a group the owner already named "Choose a dip" is asked as it is
    expect(checkChoice([{ ...dip, name: 'Choose a dip' }], []).problems[0].message).toBe('Choose a dip');
    expect(checkChoice([{ ...dip, name: 'Pick your sauce' }], []).problems[0].message).toBe('Pick your sauce');
  });
  it('only groups with a name and a live option are shown; an item with none has no add-ons', () => {
    const dead: AddOnGroup = { id: 'x', name: 'Gone', options: [{ id: 'y', name: 'Old', price: 5, isActive: false }] };
    expect(activeGroups({ addOnGroups: [dip, dead, { id: 'z', name: ' ', options: [{ id: 'w', name: 'A', price: 1 }] }] }).map(g => g.id)).toEqual(['g-dip']);
    expect(hasAddOns({ addOnGroups: [dead] })).toBe(false);
    expect(hasAddOns({})).toBe(false);
    expect(hasAddOns(undefined)).toBe(false);
    expect(maxOf({ max: 0 })).toBe(0);
    expect(maxOf({ max: 2.7 })).toBe(2);
  });
  it('the owner’s save drops empty rows, trims names, never keeps a negative price, and gives every id once', () => {
    let n = 0;
    const out = cleanGroups([
      { id: 'a', name: '  Sauce ', required: true, max: 1, options: [{ id: 'a', name: ' Mayo ', price: -5 }, { id: 'a', name: 'Ketchup', price: 10.456 }, { id: 'e', name: '  ', price: 3 }] },
      { id: 'b', name: 'Empty', options: [] },
      { id: 'c', name: '', options: [{ id: 'q', name: 'Orphan', price: 1 }] },
    ], () => `new${++n}`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Sauce', required: true, max: 1 });
    expect(out[0].options.map(o => [o.name, o.price])).toEqual([['Mayo', 0], ['Ketchup', 10.46]]);
    const ids = [out[0].id, ...out[0].options.map(o => o.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(cleanGroups(undefined, () => 'x')).toEqual([]);
  });
  it('says what is wrong before it saves', () => {
    expect(groupIssues([{ id: 'a', name: 'Dip', options: [] }])).toEqual(['Dip has no options yet']);
    expect(groupIssues([{ id: 'a', name: '', options: [{ id: 'o', name: 'Mayo', price: 1 }] }])).toEqual(['Give each group a name']);
    expect(groupIssues([{ id: 'a', name: 'Dip', options: [{ id: 'o', name: 'Mayo', price: 1 }, { id: 'p', name: 'mayo', price: 2 }] }])).toEqual(['Dip has the same option twice']);
    expect(groupIssues([dip, extras])).toEqual([]);
  });
});

describe('the menu row keeps the description and the groups', () => {
  it('both go to the database columns and come back as the same fields', () => {
    const row = rowToDb('menuItems', { id: 'm1', name: 'Zinger', price: 500, description: '  Crispy fillet ', addOnGroups: [dip], isActive: true });
    expect(row.description).toBe('Crispy fillet');
    expect(row.add_on_groups).toEqual([dip]);
    const back = rowFromDb({ ...row, id: 'm1' }, 'menu_items') as { description?: string; addOnGroups?: AddOnGroup[] };
    expect(back.description).toBe('Crispy fillet');
    expect(back.addOnGroups).toEqual([dip]);
  });
  it('an item without them writes a null description and an empty list (the columns never get junk)', () => {
    const row = rowToDb('menuItems', { id: 'm2', name: 'Cola', price: 100, description: '   ', isActive: true });
    expect(row.description).toBeNull();
    expect(row.add_on_groups).toEqual([]);
  });
});

describe('the owner’s editor', () => {
  function Host({ initial, spy }: { initial: AddOnGroup[]; spy?: (g: AddOnGroup[]) => void }) {
    const [g, setG] = useState<AddOnGroup[]>(initial);
    return <AddOnEditor groups={g} onChange={x => { setG(x); spy?.(x); }} />;
  }
  it('adds a group and an option, names them, sets a price, a limit and "must choose"', () => {
    const spy = vi.fn();
    render(<Host initial={[]} spy={spy} />);
    expect(screen.getByText(/None\. Add a group/)).toBeInTheDocument();
    fireEvent.click(document.querySelector('[data-addon-add-group]')!);
    fireEvent.change(document.querySelector('[data-addon-group-name]')!, { target: { value: 'Choose a dip' } });
    fireEvent.change(document.querySelector('[data-addon-option-name]')!, { target: { value: 'Garlic mayo' } });
    fireEvent.change(document.querySelector('[data-addon-option-price]')!, { target: { value: '30' } });
    fireEvent.change(document.querySelector('[data-addon-max]')!, { target: { value: '1' } });
    fireEvent.click(document.querySelector('[data-addon-required]')!);
    fireEvent.click(document.querySelector('[data-addon-add-option]')!);
    const last = spy.mock.calls[spy.mock.calls.length - 1][0] as AddOnGroup[];
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ name: 'Choose a dip', required: true, max: 1 });
    expect(last[0].options).toHaveLength(2);
    expect(last[0].options[0]).toMatchObject({ name: 'Garlic mayo', price: 30 });
  });
  it('shows a problem as soon as one exists, and removes a group', () => {
    render(<Host initial={[{ id: 'a', name: 'Dip', options: [] }]} />);
    expect(document.querySelector('[data-addon-issues]')?.textContent).toContain('Dip has no options yet');
    fireEvent.click(screen.getByRole('button', { name: 'Remove group' }));
    expect(document.querySelector('[data-addon-group]')).toBeNull();
  });
});

describe('the details sheet on the website', () => {
  const burger: DetailItem = { id: 'm1', name: 'Zinger Burger', category: 'Burgers', icon: 'burger' as DetailItem['icon'], tone: 0, price: 500, flavors: [], variants: null, description: 'Crispy fillet, cheese and our house sauce', addOnGroups: [dip, extras] };
  const sheet = (onAdd = vi.fn(), item: DetailItem = burger) => { render(<ItemDetailSheet item={item} money={money} closed={false} onClose={() => {}} onAdd={onAdd} />); return onAdd; };

  it('shows the description under the name', () => {
    sheet();
    expect(document.querySelector('[data-detail-description]')?.textContent).toBe('Crispy fillet, cheese and our house sauce');
  });
  it('a required group blocks the add and names what to choose; then the price follows the choices and the quantity', () => {
    const add = sheet();
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).not.toHaveBeenCalled();
    expect(document.querySelector('[data-detail-add]')?.textContent).toBe('Choose Dip');
    fireEvent.click(document.querySelector('[data-detail-addon="o-garlic"]')!);
    fireEvent.click(document.querySelector('[data-detail-addon="o-cheese"]')!);
    expect(document.querySelector('[data-detail-price]')?.textContent).toBe('Rs 580');              // 500 + 30 + 50
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    expect(document.querySelector('[data-detail-add]')?.textContent).toBe('Add to cart — Rs 1,160');
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).toHaveBeenCalledWith(burger, { note: '', qty: 2, addOns: [{ id: 'o-garlic', name: 'Garlic mayo', price: 30 }, { id: 'o-cheese', name: 'Extra cheese', price: 50 }] });
  });
  it('pick-one is a radio group that swaps, extras are boxes with a limit, a retired option is not shown', () => {
    sheet();
    expect(document.querySelector('[data-detail-addon-group="g-dip"] [role="radiogroup"]')).not.toBeNull();
    expect(document.querySelector('[data-detail-addon-group="g-ex"] [role="group"]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-detail-addon="o-ketchup"]')!);
    fireEvent.click(document.querySelector('[data-detail-addon="o-garlic"]')!);
    expect(document.querySelector('[data-detail-addon="o-ketchup"]')?.getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('[data-detail-addon="o-garlic"]')?.getAttribute('aria-checked')).toBe('true');
    for (const id of ['o-cheese', 'o-jala', 'o-bacon']) fireEvent.click(document.querySelector(`[data-detail-addon="${id}"]`)!);
    expect(document.querySelector('[data-detail-addon="o-bacon"]')?.getAttribute('aria-checked')).toBe('false');     // the limit is 2
    expect(document.querySelector('[data-detail-addon="o-off"]')).toBeNull();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });
  it('the add-on price rides on top of a chosen size', () => {
    const pizza: DetailItem = { id: 'm2', name: 'Pizza', icon: 'pizza' as DetailItem['icon'], tone: 1, price: 1000, flavors: [], variants: { kind: 'size', list: [{ name: 'Small', price: 900 }, { name: 'Large', price: 1500 }] }, addOnGroups: [extras] };
    const add = sheet(vi.fn(), pizza);
    fireEvent.click(document.querySelector('[data-detail-size="Large"]')!);
    fireEvent.click(document.querySelector('[data-detail-addon="o-bacon"]')!);
    expect(document.querySelector('[data-detail-price]')?.textContent).toBe('Rs 1,580');
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).toHaveBeenCalledWith(pizza, { variant: { kind: 'size', name: 'Large', price: 1500 }, note: '', qty: 1, addOns: [{ id: 'o-bacon', name: 'Bacon', price: 80 }] });
  });
  it('an item without add-ons or a description looks and behaves as before', () => {
    const plain: DetailItem = { id: 'm3', name: 'Fries', icon: 'sides' as DetailItem['icon'], tone: 1, price: 250, flavors: [], variants: null };
    const add = sheet(vi.fn(), plain);
    expect(document.querySelector('[data-detail-description]')).toBeNull();
    expect(document.querySelector('[data-detail-addon-group]')).toBeNull();
    fireEvent.click(document.querySelector('[data-detail-add]')!);
    expect(add).toHaveBeenCalledWith(plain, { note: '', qty: 1 });
  });
});

describe('wiring', () => {
  const page = read('src/pages/OnlineOrderPage.tsx');
  it('an item with add-ons opens its details instead of going straight to the cart', () => {
    expect(page).toContain('if (hasAddOns(m)) { setDetailItem(m); return; }');
    expect(page).toContain('addOns: pick.addOns');
    expect(page).toContain('description: m.description?.trim() || undefined');
    expect(page).toContain('addOnGroups: activeGroups(m)');
  });
  it('two lines with different add-ons stay two lines; the chosen add-ons are on the cart line and shown in the cart', () => {
    expect(page).toContain("(c.addOns || []).map(a => a.id).sort().join(',') === addOnKey");
    expect(page).toContain('...(addOns.length ? { addOns } : {})');
    expect(page).toContain('data-cart-addons');
  });
  it('the menu manager has the description and the add-on editor, and checks them before it saves', () => {
    const mm = read('src/pages/MenuManagerPage.tsx');
    expect(mm).toContain('data-item-description');
    expect(mm).toContain('<AddOnEditor');
    expect(mm).toContain('groupIssues(editItem.addOnGroups || [])');
    expect(mm).toContain('addOnGroups: cleanGroups(editItem.addOnGroups, genId)');
  });
  it('the order goes to the server with the ids only — the price is the server’s', () => {
    const fn = read('src/lib/publicPortal.functions.ts');
    expect(fn).toContain("rpc('public_place_order'");
    expect(page).toContain('items: cart,');
  });
});

describe('the database', () => {
  const mig = 'supabase/migrations/20261118110000_v1_124_0_menu_description_addons.sql';
  const rb = 'docs/rollback/2026-11-18-v1_124_0-menu-addons-before.sql';
  it('the migration adds the two columns and prices add-ons from the menu item’s own groups', () => {
    expect(existsSync(resolve(__dirname, '../..', mig))).toBe(true);
    const s = read(mig);
    expect(s).toContain('add column if not exists description text');
    expect(s).toContain("add column if not exists add_on_groups jsonb not null default '[]'::jsonb");
    expect(s).toContain("(v_g->>'max')::integer");
    expect(s).toContain("raise exception 'an extra is no longer available");
    expect(s).toContain("raise exception 'choose % for %'");
    // the client price is never read: the add-on price comes from v_opt (the menu item's group), not from the order line
    expect(s).toContain("coalesce((v_opt->>'price')::numeric, 0)");
    expect(s).not.toMatch(/v_item->>'addOnPrice'|v_item->'addOns'->[^;]*price/);
  });
  it('keeps the earlier fixes: the settings read and the promo check are still in the function', () => {
    const s = read(mig);
    expect(s).toContain('from tenant_settings ts where ts.tenant_id = p_tenant');
    expect(s).toContain('public._promo_check(');
    expect(s).toContain("'deliveryCharge', v_dcharge");
  });
  it('has a rollback that restores the function as it was', () => {
    expect(existsSync(resolve(__dirname, '../..', rb))).toBe(true);
    const s = read(rb);
    expect(s.toLowerCase()).toContain('create or replace function public.public_place_order');
    expect(s).not.toContain('v_addons');
  });
});

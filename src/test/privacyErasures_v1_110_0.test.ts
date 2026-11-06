// v1.110.0 — an erase made on one device reaches the others: a one-way marker in the shared settings, applied on each device later.
import { describe, it, expect, beforeEach } from 'vitest';
import { applyPendingErasures, eraseEverywhere, hashPhoneKey } from '@/lib/privacyErasures';
import { phoneKey, ERASED_NAME } from '@/lib/privacy';
import { deleteCustomer, deleteOrder, findCustomerByPhone, getCustomers, getOrders, getSettings, saveOrder, saveSettings } from '@/lib/store';
import { archiveOrders, clearArchivedOrders, getArchivedOrders } from '@/lib/orderArchive';
import { getTenantId } from '@/lib/tenant';
import type { Order } from '@/lib/types';

const PHONE = '0300 7654321';
const order = (o: Partial<Order>): Order => ({
  id: 'o1', orderNumber: 1, orderType: 'delivery', status: 'running',
  items: [{ id: 'i', name: 'Karahi', quantity: 1, lineTotal: 1000 } as any], subtotal: 1000, discount: 0, tax: 0, serviceCharge: 0, grandTotal: 1000,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  customer: { id: 'c', name: 'Sana Malik', phone: PHONE, address: 'DHA' } as any, ...o,
} as Order);

beforeEach(() => {
  getOrders().forEach(o => deleteOrder(o.id)); getCustomers().forEach(c => deleteCustomer(c.id)); clearArchivedOrders();
  saveSettings({ ...getSettings(), privacyErasures: [] });
  try { localStorage.removeItem(`dt-erasures-applied::${getTenantId() || 'local'}`); } catch { /* */ }
});

describe('the marker', () => {
  it('is a fixed-length one-way hash that does not contain the number', async () => {
    const h = await hashPhoneKey(phoneKey(PHONE));
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashPhoneKey(phoneKey(PHONE))).toBe(h);
    expect(await hashPhoneKey(phoneKey('0300 7654322'))).not.toBe(h);
    expect(h).not.toContain('7654321');
  });
  it('is left in the shared settings by an erase, once, with the time and no phone number', async () => {
    saveOrder(order({}));
    const r = await eraseEverywhere(PHONE);
    expect(r.marked).toBe(true);
    expect(r.liveOrders).toBe(1);
    await eraseEverywhere(PHONE);
    const list = getSettings().privacyErasures || [];
    expect(list).toHaveLength(1);
    expect(list[0].h).toMatch(/^[0-9a-f]{32}$/);
    expect(Date.now() - new Date(list[0].at).getTime()).toBeLessThan(10000);
    expect(JSON.stringify(list)).not.toMatch(/7654321|Sana/);
  });
  it('does nothing for an empty number', async () => {
    expect((await eraseEverywhere('')).marked).toBe(false);
    expect(getSettings().privacyErasures || []).toHaveLength(0);
  });
});

describe('another device applies it', () => {
  it('removes the person from this device’s profile, live orders and archive, then does not repeat', async () => {
    // "device B": it holds the person, and the shared settings already carry the marker made on device A
    saveOrder(order({ id: 'live', orderNumber: 5 }));
    archiveOrders([order({ id: 'old', orderNumber: 2, status: 'paid' })]);
    saveOrder(order({ id: 'other', orderNumber: 6, customer: { id: 'x', name: 'Bilal', phone: '03111111111', address: 'F7' } as any }));
    const h = await hashPhoneKey(phoneKey(PHONE));
    saveSettings({ ...getSettings(), privacyErasures: [{ h, at: new Date().toISOString() }] });
    expect(findCustomerByPhone(PHONE)?.name).toBe('Sana Malik');

    expect(await applyPendingErasures()).toBe(1);
    expect(findCustomerByPhone(PHONE)).toBeUndefined();
    expect(getOrders().find(o => o.id === 'live')?.customer?.name).toBe(ERASED_NAME);
    expect(getArchivedOrders().find(o => o.id === 'old')?.customer?.name).toBe(ERASED_NAME);
    expect(getOrders().find(o => o.id === 'other')?.customer?.name).toBe('Bilal');
    expect(findCustomerByPhone('03111111111')?.name).toBe('Bilal');
    expect(await applyPendingErasures()).toBe(0);
  });
  it('leaves a customer who ordered again after the erase alone', async () => {
    const erasedAt = new Date(Date.now() - 1800000).toISOString();           // erased 30 minutes ago on another device
    saveOrder(order({ id: 'before', orderNumber: 7, createdAt: new Date(Date.now() - 7200000).toISOString() }));
    saveOrder(order({ id: 'after', orderNumber: 8, createdAt: new Date(Date.now() - 600000).toISOString() }));
    const h = await hashPhoneKey(phoneKey(PHONE));
    saveSettings({ ...getSettings(), privacyErasures: [{ h, at: erasedAt }] });
    await applyPendingErasures();
    expect(getOrders().find(o => o.id === 'before')?.customer?.name).toBe(ERASED_NAME);
    expect(getOrders().find(o => o.id === 'after')?.customer?.name).toBe('Sana Malik');
    expect(findCustomerByPhone(PHONE)?.name).toBe('Sana Malik');             // the newer customer keeps their profile
  });
  it('is quiet when there is nothing to apply', async () => {
    expect(await applyPendingErasures()).toBe(0);
  });
});

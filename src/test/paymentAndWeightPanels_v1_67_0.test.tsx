// ============================================================================
// v1.67.0 — the Payment screen and the weight panel, redesigned
//
// REQUESTED: the payment screen and the kilogram entry "like this" (reference
// screens: hero Total Payable card, method tiles, Amount Received with
// Exact/quick amounts, Change and Due cards, a footer with Back to cart and
// Complete Sale [Enter]; and a right-hand weight panel with By weight / By
// amount, a big readout, keypad, Quantity/Price and Add to cart [Enter]).
//
// This is a LAYOUT change. The guarantee these tests pin is that the money did
// not move: every payload PaymentDialog hands its caller, and every cart line
// WeightPanel hands back, is exactly what the old screens produced.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, byText, q, click, typeInto, press } from './_dom';

let accounts: any[] = [];
let settings: any = {};
vi.mock('@/lib/store', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getPaymentAccounts: () => accounts,
  findCustomerByPhone: () => null,
  getSettings: () => settings,
}));

const { default: PaymentDialog } = await import('@/components/PaymentDialog');
const { default: WeightPanel } = await import('@/components/WeightPanel');
const { money } = await import('@/lib/currency');
import { createElement as h } from 'react';

let view: ReturnType<typeof mount> | null = null;
afterEach(() => { view?.unmount(); view = null; document.body.innerHTML = ''; });
beforeEach(() => { accounts = []; settings = {}; });

function openPayment(over: Record<string, any> = {}) {
  const onConfirm = vi.fn(); const onClose = vi.fn();
  view = mount(h(PaymentDialog as any, { open: true, grandTotal: 1952, onConfirm, onClose, ...over }));
  return { onConfirm, onClose };
}
const completeBtn = () => byText('Complete Sale') || byText('Partial payment') || byText('Receive Payment');
const received = () => q<HTMLInputElement>('#pay-received')!;

describe('Payment screen — the layout the reference shows', () => {
  it('has the hero total, the method tiles and the two footer buttons', () => {
    openPayment();
    expect(document.body.textContent).toContain('Total payable');
    expect(document.body.textContent).toContain(money(1952));
    for (const t of ['Cash', 'Online', 'Split']) expect(byText(t), t).toBeTruthy();
    expect(byText('Back to cart')).toBeTruthy();
    expect(completeBtn()!.textContent).toContain('Enter');
  });
  it('shows Change and Due cards beside the amount received', () => {
    openPayment();
    expect(document.body.textContent).toContain('Change');
    expect(document.body.textContent).toContain('Due (credit)');
  });
  it('opens with the full amount already entered — Exact is the common case', () => {
    openPayment();
    expect(received().value).toBe('1952');
  });
  it('remaining-payment mode says so', () => {
    openPayment({ remainingMode: true });
    expect(document.body.textContent).toContain('Receive Remaining Payment');
    expect(document.body.textContent).toContain('Balance due');
    expect(byText('Cancel')).toBeTruthy();
  });
});

describe('Payment screen — the money is unchanged', () => {
  it('exact cash: one cash payment for the whole bill', () => {
    const { onConfirm } = openPayment();
    click(completeBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      method: 'cash', cashReceived: 1952,
      payments: [{ method: 'cash', amount: 1952 }], totalReceived: 1952,
    });
  });

  it('over-tender: change is NOT a payment, and the cards show it', () => {
    const { onConfirm } = openPayment();
    typeInto(received(), '2000');
    expect(document.body.textContent).toContain(money(48));          // Change
    click(completeBtn());
    const r = onConfirm.mock.calls[0][0];
    expect(r.cashReceived).toBe(2000);
    expect(r.payments).toEqual([{ method: 'cash', amount: 1952 }]);   // 1,952 not 2,000
    expect(r.totalReceived).toBe(1952);
  });

  it('partial: pays what was given, shows what is due, and says "Partial payment"', () => {
    const { onConfirm } = openPayment();
    typeInto(received(), '1000');
    expect(document.body.textContent).toContain(money(952));          // Due
    expect(completeBtn()!.textContent).toContain('Partial payment');
    click(completeBtn());
    const r = onConfirm.mock.calls[0][0];
    expect(r.payments).toEqual([{ method: 'cash', amount: 1000 }]);
    expect(r.totalReceived).toBe(1000);
  });

  it('nothing entered: the sale cannot be completed', () => {
    const { onConfirm } = openPayment();
    typeInto(received(), '');
    expect((completeBtn() as HTMLButtonElement).disabled).toBe(true);
    click(completeBtn());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('online: needs an account, then records the full amount against it', () => {
    accounts = [{ id: 'acc1', name: 'Meezan Bank', type: 'bank', isActive: true }];
    const { onConfirm } = openPayment();
    click(byText('Online'));
    expect((completeBtn() as HTMLButtonElement).disabled).toBe(true);   // no account chosen yet
    click(byText('Meezan Bank'));
    click(completeBtn());
    expect(onConfirm.mock.calls[0][0]).toMatchObject({
      method: 'online', accountId: 'acc1', accountName: 'Meezan Bank', totalReceived: 1952,
      payments: [{ method: 'online', accountId: 'acc1', accountName: 'Meezan Bank', amount: 1952 }],
    });
  });

  it('Online and Split are unavailable when the restaurant has no payment accounts', () => {
    openPayment();
    expect((byText('Online') as HTMLButtonElement).disabled).toBe(true);
    expect((byText('Split') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Back to cart closes without confirming anything', () => {
    const { onConfirm, onClose } = openPayment();
    click(byText('Back to cart'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('quick amounts fill the field; Exact restores the bill total', () => {
    openPayment();
    click(byText(money(5000)));
    expect(received().value).toBe('5000');
    click(byText('Exact'));
    expect(received().value).toBe('1952');
  });
});

describe('Payment screen — Enter completes the sale, safely', () => {
  it('Enter in the amount field confirms exactly once', () => {
    const { onConfirm } = openPayment();
    press(received(), 'Enter');
    press(received(), 'Enter');                  // a second press must not double-submit
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
  it('Enter on a button does not also confirm (that button handles its own press)', () => {
    const { onConfirm } = openPayment();
    press(byText('Exact'), 'Enter');
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it('Enter does nothing while the sale cannot be completed', () => {
    const { onConfirm } = openPayment();
    typeInto(received(), '');
    press(received(), 'Enter');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
const mutton: any = { id: 'm1', name: 'Mutton Karahi', pricingType: 'weight', ratePerKg: 3600, price: 0, categoryId: 'c1' };
function openWeight(item: any = mutton) {
  const onAdd = vi.fn(); const onClose = vi.fn();
  view = mount(h(WeightPanel as any, { item, onAdd, onClose }));
  return { onAdd, onClose };
}
const key = (k: string) => click(q(`[aria-label="${k}"]`));
const addBtn = () => byText('Add to cart') as HTMLButtonElement;

describe('Weight panel', () => {
  it('shows the item, its rate, both entry modes and a disabled Add button', () => {
    openWeight();
    expect(document.body.textContent).toContain('Mutton Karahi');
    expect(document.body.textContent).toContain(`${money(3600)} per kg`);
    expect(byText('By weight (kg)')).toBeTruthy();
    expect(byText('By amount')).toBeTruthy();
    expect(addBtn().disabled).toBe(true);
  });

  it('by weight: 1.5 kg at 3,600 adds a 5,400 line carrying 1,500 g and the "1.50 KG" note', () => {
    const { onAdd } = openWeight();
    key('1'); key('.'); key('5');
    expect(document.body.textContent).toContain(money(5400));
    click(addBtn());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0]).toBe(mutton);
    expect(onAdd.mock.calls[0][1]).toMatchObject({ price: 5400, grams: 1500, note: '1.50 KG' });
  });

  it('by amount: Rs. 500 of a 3,600/kg item charges exactly 500 and derives the weight', () => {
    const { onAdd } = openWeight();
    click(byText('By amount'));
    key('5'); key('0'); key('0');
    click(addBtn());
    expect(onAdd.mock.calls[0][1]).toMatchObject({ price: 500, grams: 139, note: '0.14 KG' });
  });

  it('grams and pao are still available', () => {
    const { onAdd } = openWeight();
    click(byText('pao'));
    key('3');                                     // 3 pao = 0.75 kg
    click(addBtn());
    expect(onAdd.mock.calls[0][1]).toMatchObject({ grams: 750, price: 2700 });
  });

  it('a quick pick fills the readout', () => {
    openWeight();
    click(byText('0.5'));
    expect(document.body.textContent).toContain('0.5');
    expect(document.body.textContent).toContain(money(1800));
  });

  it('keyboard: digits type, Backspace deletes, Enter adds', () => {
    const { onAdd } = openWeight();
    const dlg = q('[role="dialog"]');
    press(dlg, '2'); press(dlg, '5'); press(dlg, 'Backspace'); press(dlg, '1');   // "21" -> 2 then 1? 2,5 -> 25 -> 2 -> 21
    press(dlg, 'Enter');
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][1]).toMatchObject({ grams: 21000, price: 75600 });  // 21 kg
  });

  it('Add does nothing with an empty entry', () => {
    const { onAdd } = openWeight();
    press(q('[role="dialog"]'), 'Enter');
    click(addBtn());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('an item with no rate cannot be entered by amount (no division by zero)', () => {
    const { onAdd } = openWeight({ ...mutton, ratePerKg: 0 });
    expect((byText('By amount') as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toContain('no price per kg');
    click(byText('By amount'));                   // disabled: must stay on By weight
    key('1');
    click(addBtn());
    expect(onAdd.mock.calls[0][1]).toMatchObject({ price: 0 });
  });

  it('is closed when there is no item', () => {
    openWeight(null);
    expect(q('[role="dialog"]')).toBeNull();
  });

  it('opening a different item starts from an empty entry', () => {
    openWeight();
    key('7');
    view!.rerender(h(WeightPanel as any, { item: { ...mutton, id: 'm2', name: 'Chicken' }, onAdd: vi.fn(), onClose: vi.fn() }));
    expect(addBtn().disabled).toBe(true);
  });
});

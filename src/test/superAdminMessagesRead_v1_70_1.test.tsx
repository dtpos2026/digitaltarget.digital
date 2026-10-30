// v1.70.1 — the Super Admin inbox: opening a conversation clears its unread badge
// when the server confirms, and says so (once) when it does not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement as h } from 'react';
import { mount, q } from './_dom';

let inbox: ((list: any[]) => void) | null = null;
let markReadResult = true;
const markReadSpy = vi.fn(async () => markReadResult);
const toastError = vi.fn();

vi.mock('sonner', () => ({ toast: { error: (...a: any[]) => toastError(...a), success: vi.fn() } }));
vi.mock('@/lib/support', () => ({
  markRead: (...a: any[]) => (markReadSpy as any)(...a),
  fetchTenantPhone: async () => '',
  waLink: () => '#',
  uploadSupportImage: async () => '',
  listenGlobalSupportInbox: (cb: (list: any[]) => void) => { inbox = cb; return () => { inbox = null; }; },
}));
vi.mock('@/lib/supportOutbox', () => ({
  queueSupportMessage: vi.fn(), subscribeOutbox: () => () => {}, retryOutboxItem: vi.fn(), discardOutboxItem: vi.fn(),
}));
vi.mock('@/components/SupportImage', () => ({ default: () => null }));

const { default: SuperAdminMessages } = await import('@/components/SuperAdminMessages');

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const msg = (id: string, from: 'owner' | 'admin', read: boolean) =>
  ({ id, _tenantId: 't1', from, body: 'Printer is not working', read, createdAt: Date.now() });
const convoButton = () =>
  (Array.from(document.body.querySelectorAll('button')) as HTMLButtonElement[]).find(b => (b.textContent || '').includes('Butt BBQ'))!;
const badge = () => document.body.querySelector('span.bg-red-600');

let view: ReturnType<typeof mount> | null = null;
beforeEach(() => { markReadResult = true; markReadSpy.mockClear(); toastError.mockClear(); inbox = null; });
afterEach(() => { view?.unmount(); view = null; document.body.innerHTML = ''; });

async function open() {
  view = mount(h(SuperAdminMessages as any, { clients: [{ tenantId: 't1', name: 'Butt BBQ' }] }));
  await flush();
  await act(async () => { inbox!([msg('m1', 'owner', false), msg('m2', 'owner', false)]); });
}

describe('Super Admin inbox — read status', () => {
  it('a restaurant\'s unread messages are shown as a count', async () => {
    await open();
    expect(badge()?.textContent).toBe('2');
  });

  it('opening the conversation marks it read ON THE SERVER and clears the badge at once', async () => {
    await open();
    await act(async () => { convoButton().click(); });
    await flush();
    expect(markReadSpy).toHaveBeenCalledWith('t1', 'admin');
    expect(badge()).toBeNull();                       // no waiting for a realtime echo
    expect(toastError).not.toHaveBeenCalled();
  });

  it('if the server does NOT confirm, the badge stays and the Super Admin is told', async () => {
    markReadResult = false;
    await open();
    await act(async () => { convoButton().click(); });
    await flush();
    expect(badge()?.textContent).toBe('2');            // still unread — and it says so
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toMatch(/could not mark/i);
  });

  it('a message that arrives while the conversation is open is marked read too', async () => {
    await open();
    await act(async () => { convoButton().click(); });
    await flush();
    markReadSpy.mockClear();
    await act(async () => { inbox!([msg('m1', 'owner', true), msg('m2', 'owner', true), msg('m3', 'owner', false)]); });
    await flush();
    expect(markReadSpy).toHaveBeenCalledWith('t1', 'admin');
    expect(badge()).toBeNull();
  });

  it('only the restaurant\'s messages count — the admin\'s own replies never do', async () => {
    view = mount(h(SuperAdminMessages as any, { clients: [{ tenantId: 't1', name: 'Butt BBQ' }] }));
    await flush();
    await act(async () => { inbox!([msg('a1', 'admin', false), msg('o1', 'owner', true)]); });
    expect(badge()).toBeNull();
  });
});

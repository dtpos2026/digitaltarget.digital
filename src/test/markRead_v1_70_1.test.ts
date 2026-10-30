// ============================================================================
// v1.70.1 — "I opened the message and it still says unread"
//
// markRead awaited `sb().rpc('support_mark_read')` and threw the result away.
// supabase-js does not throw on a failed call: it resolves to { data, error }.
// So the surrounding try/catch never ran, and a refused or failed call left the
// messages unread on the server with nothing on screen or in the console.
// These tests drive markRead with a faithful model of that: a call that FAILS by
// RESOLVING with an error, which the old code treated as success.
// ============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let rpcImpl: (name: string, args: any) => Promise<any>;
const rpcSpy = vi.fn((name: string, args: any) => rpcImpl(name, args));

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  sb: () => ({ rpc: rpcSpy }),
}));

const { markRead } = await import('@/lib/support');

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { rpcSpy.mockClear(); errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errSpy.mockRestore(); });

describe('markRead', () => {
  it('reports success only when the server says ok', async () => {
    rpcImpl = async () => ({ data: { ok: true, updated: 2 }, error: null });
    expect(await markRead('t1', 'admin')).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('support_mark_read', { p_tenant: 't1', p_side: 'admin' });
  });

  it('the owner side asks for the owner side', async () => {
    rpcImpl = async () => ({ data: { ok: true, updated: 0 }, error: null });
    await markRead('t1', 'owner');
    expect(rpcSpy).toHaveBeenCalledWith('support_mark_read', { p_tenant: 't1', p_side: 'owner' });
  });

  it('a call that FAILS BY RESOLVING with an error is a failure — and is logged', async () => {
    rpcImpl = async () => ({ data: null, error: { message: 'permission denied for function', code: '42501' } });
    expect(await markRead('t1', 'admin')).toBe(false);          // the old code returned undefined here and moved on
    expect(errSpy).toHaveBeenCalled();
  });

  it('an { ok: false } answer is a failure too', async () => {
    rpcImpl = async () => ({ data: { ok: false, reason: 'tenant mismatch' }, error: null });
    expect(await markRead('t1', 'admin')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });

  it('a thrown network error is a failure', async () => {
    rpcImpl = async () => { throw new Error('Failed to fetch'); };
    expect(await markRead('t1', 'admin')).toBe(false);
    expect(errSpy).toHaveBeenCalled();
  });
});

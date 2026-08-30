// ============================================================================
// v1.29.3 — the recycle bin that was already there and nobody could open
//
// Deleting in DT POS has meant a TOMBSTONE since v1.26.0: `deleted_at` is set
// rather than the row destroyed, because a deletion has to REPLICATE to other
// tills — an absence cannot be told apart from "not synced yet", and guessing
// either way lost data both times it shipped.
//
// So every deleted row on the eleven tombstoned tables has been recoverable all
// along, and nothing ever offered to recover one. This is that surface.
//
// PURGE is deliberately not here. It is the one operation that cannot be
// undone, so recycle_bin_purge is granted to service_role alone and is run on a
// schedule, never by a browser.
// ============================================================================
import { sb, isSupabaseConfigured } from './supabase';

export interface BinTable {
  /** The Postgres table, e.g. 'orders'. */
  table: string;
  count: number;
}

export type BinResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'no_tenant' | 'unknown_table' | 'offline'; message: string };

const NOT_CONFIGURED = {
  ok: false as const,
  reason: 'offline' as const,
  message: 'This build has no server configured.',
};

/** What is currently recoverable, per table. Empty tables are omitted. */
export async function listRecycleBin(table?: string): Promise<BinResult<BinTable[]>> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  try {
    const { data, error } = await sb().rpc('recycle_bin_list' as never,
      { p_table: table ?? null, p_limit: 500 } as never);
    if (error) return { ok: false, reason: 'offline', message: error.message };
    const res = data as any;
    if (!res?.ok) {
      return {
        ok: false,
        reason: res?.reason === 'no_tenant' ? 'no_tenant' : 'offline',
        message: res?.reason === 'no_tenant'
          ? 'Sign in with the owner email to see the recycle bin.'
          : 'The server could not read the recycle bin.',
      };
    }
    return { ok: true, data: Array.isArray(res.tables) ? res.tables : [] };
  } catch (e: any) {
    return { ok: false, reason: 'offline', message: e?.message || 'Could not reach the server' };
  }
}

/**
 * Bring rows back. The deletion travelled to every till, and so does this.
 *
 * The restaurant is taken from the caller's own session inside the function, so
 * an id belonging to another restaurant restores nothing — verified against the
 * live database, where a batch of another tenant's ids restored 0.
 */
export async function restoreFromRecycleBin(table: string, ids: string[]): Promise<BinResult<number>> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  if (!ids.length) return { ok: true, data: 0 };
  try {
    const { data, error } = await sb().rpc('recycle_bin_restore' as never,
      { p_table: table, p_ids: ids } as never);
    if (error) return { ok: false, reason: 'offline', message: error.message };
    const res = data as any;
    if (!res?.ok) {
      return {
        ok: false,
        reason: res?.reason === 'unknown_table' ? 'unknown_table' : 'no_tenant',
        message: res?.reason === 'unknown_table'
          ? `${table} does not keep deleted rows, so there is nothing to restore from it.`
          : 'Sign in with the owner email to restore.',
      };
    }
    return { ok: true, data: Number(res.restored) || 0 };
  } catch (e: any) {
    return { ok: false, reason: 'offline', message: e?.message || 'Could not reach the server' };
  }
}

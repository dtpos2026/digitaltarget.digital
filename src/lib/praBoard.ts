// v1.147.0 — PRA fiscal invoicing as the design draws it (SW-37): "PRA fiscal invoicing — Disabled — enable only with your PRA registration", Enable, an honest
// "Not live" notice, three status cards (Submitted · Pending · Failed), the settings, and the invoices table with Retry. Pure: queue entries in, words out.
import type { PraQueueEntry } from './praQueue';

export type PraFilter = 'all' | 'failed' | 'pending' | 'sent';
export const PRA_FILTERS: { key: PraFilter; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'failed', label: 'Failed' }, { key: 'pending', label: 'Pending' }, { key: 'sent', label: 'Submitted' }];

/** The word on a row ("sent" is "Submitted" everywhere the design says it). */
export const PRA_STATUS_LABEL: Record<string, string> = { pending: 'Pending', sent: 'Submitted', failed: 'Failed', skipped: 'Skipped' };

export function praCounts(queue: Pick<PraQueueEntry, 'status'>[]): { submitted: number; pending: number; failed: number } {
  return { submitted: queue.filter(q => q.status === 'sent').length, pending: queue.filter(q => q.status === 'pending').length, failed: queue.filter(q => q.status === 'failed').length };
}

export function praRows(queue: PraQueueEntry[], f: PraFilter): PraQueueEntry[] {
  return queue.filter(q => f === 'all' || q.status === f).slice().sort((a, b) => (b.firstQueuedAt || 0) - (a.firstQueuedAt || 0));
}

/** "Disabled — enable only with your PRA registration" / "Enabled · Sandbox" / "Enabled · Production — real invoices". */
export function praSubtitle(enabled: boolean, environment: string): string {
  if (!enabled) return 'Disabled — enable only with your PRA registration';
  return environment === 'production' ? 'Enabled · Production — real invoices are recorded with the PRA' : 'Enabled · Sandbox';
}

/** The notice the design puts above the cards, in words that stay true until the contract is verified. */
export const PRA_NOT_LIVE = 'Not live: this build has not been tested against the PRA sandbox.';

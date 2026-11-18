// ============================================================================
// Rights rules and approvals (v1.118.0) — rights by branch, by hour and by date, and a second pair of eyes for the risky ones.
//
// A person's base rights (modules and actions) are the two lists the Rights grid edits. Rules sit on top of them:
//   LIMIT  narrows a right the person already has: "may give discounts only in DHA, 10:00–22:00, Monday to Saturday".
//          Outside that, the right is simply off. A limit can only ever take power away.
//   GRANT  gives a right for a time and place, then it ends by itself: "may void bills in Gulberg until 25 Nov" (a cover for leave).
//          A grant must have an end date — a permanent right is a change on the grid, not a grant.
// An admin always has everything and is never limited. Rules are checked where rights are checked (userHasFeature / userHasAccess),
// with the current branch and the clock; they are rules of the app, like the rest of the staff rights, not database row permissions.
//
// Approval: giving power is the risky direction. A person who is not an admin can edit rights only if they hold the right to manage
// users, and even then what adds a risky right (refunds, voids, price edits, settings, users, backup …), or anything for themselves,
// is not applied — it becomes a request an admin approves or rejects. Taking rights away never needs approval.
// Pure functions; the clock and the branch are passed in.
// ============================================================================
import type { User } from '@/lib/types';

export type RuleMode = 'limit' | 'grant';
export type RuleKind = 'page' | 'feature';

export interface RightsRule {
  id: string;
  userId: string;
  userName: string;
  mode: RuleMode;
  kind: RuleKind;
  key: string;
  /** the branches it covers; empty = every branch */
  branchIds?: string[];
  /** hours of the day, 'HH:MM'; from > to wraps past midnight (22:00–02:00); empty = all day */
  fromTime?: string;
  toTime?: string;
  /** weekdays, 0 = Sunday … 6 = Saturday; empty = every day */
  days?: number[];
  /** a grant's first and last day (YYYY-MM-DD, both inclusive) */
  validFrom?: string;
  validUntil?: string;
  reason?: string;
  createdBy?: string;
  createdAt: string;
  revokedAt?: string;
}

export type RuleDraft = Omit<RightsRule, 'id' | 'createdAt' | 'createdBy' | 'revokedAt'>;

export interface RightsContext { now: Date; branchId: string | null }

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minutes = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Is `now` inside the hours of the rule? No hours = always. The end minute itself is outside (10:00–22:00 stops at 22:00). */
export function inHours(fromTime: string | undefined, toTime: string | undefined, now: Date): boolean {
  if (!fromTime || !toTime) return true;
  const t = now.getHours() * 60 + now.getMinutes(), a = minutes(fromTime), b = minutes(toTime);
  if (a === b) return true;                                  // the same time twice = the whole day
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** Is the rule's place, day and hours right for this moment? (A grant's dates are checked too; a limit has none.) */
export function inScope(rule: RightsRule, ctx: RightsContext): boolean {
  if (rule.revokedAt) return false;
  if (rule.branchIds && rule.branchIds.length > 0 && !(ctx.branchId && rule.branchIds.includes(ctx.branchId))) return false;
  if (rule.days && rule.days.length > 0 && !rule.days.includes(ctx.now.getDay())) return false;
  if (!inHours(rule.fromTime, rule.toTime, ctx.now)) return false;
  if (rule.mode === 'grant') {
    const today = localDay(ctx.now);
    if (rule.validFrom && today < rule.validFrom) return false;
    if (rule.validUntil && today > rule.validUntil) return false;
  }
  return true;
}

/**
 * The right after the person's rules: base right AND every limit in scope, OR any grant in scope. `rules` are the ones for this
 * person and this right. With no rules the base right is returned untouched, so a restaurant that uses none pays nothing.
 */
export function effectiveRight(base: boolean, rules: RightsRule[], ctx: RightsContext): boolean {
  if (rules.length === 0) return base;
  const limits = rules.filter(r => r.mode === 'limit' && !r.revokedAt);
  const grants = rules.filter(r => r.mode === 'grant' && !r.revokedAt);
  const kept = base && limits.every(l => inScope(l, ctx));
  return kept || grants.some(g => inScope(g, ctx));
}

/** Why a rule cannot be saved yet (empty = fine). `today` is YYYY-MM-DD. */
export function ruleIssues(d: RuleDraft, target: Pick<User, 'role'> | undefined, today: string): string[] {
  const out: string[] = [];
  if (!target) out.push('Choose the person');
  else if (target.role === 'admin') out.push('An admin always has everything — a rule cannot change that');
  if (!d.key) out.push('Choose the module or action');
  if (!!d.fromTime !== !!d.toTime) out.push('Give both the first and the last hour, or neither');
  if (d.fromTime && !TIME.test(d.fromTime)) out.push('The first hour is not a time');
  if (d.toTime && !TIME.test(d.toTime)) out.push('The last hour is not a time');
  if (d.mode === 'grant') {
    if (!d.validUntil) out.push('A temporary right needs an end date');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(d.validUntil)) out.push('The end date is not a date');
    else if (d.validUntil < today) out.push('The end date is already past');
    if (d.validFrom && d.validUntil && d.validFrom > d.validUntil) out.push('The start date is after the end date');
  }
  return out;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Only in DHA · 10:00–22:00 · Mon–Sat" / "Until 25 Nov · Gulberg". */
export function describeScope(r: Pick<RightsRule, 'mode' | 'branchIds' | 'fromTime' | 'toTime' | 'days' | 'validFrom' | 'validUntil'>, branchName: (id: string) => string): string {
  const parts: string[] = [];
  if (r.mode === 'grant') parts.push(r.validFrom ? `${r.validFrom} to ${r.validUntil ?? '…'}` : `Until ${r.validUntil ?? '…'}`);
  if (r.branchIds && r.branchIds.length) parts.push(`${r.mode === 'limit' ? 'Only in ' : 'In '}${r.branchIds.map(branchName).join(', ')}`);
  if (r.fromTime && r.toTime) parts.push(`${r.fromTime}–${r.toTime}`);
  if (r.days && r.days.length) {
    const d = [...r.days].sort((a, b) => a - b);
    const run = d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1);
    parts.push(run ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d[d.length - 1]]}` : d.map(x => DAY_NAMES[x]).join(', '));
  }
  return parts.length ? parts.join(' · ') : r.mode === 'limit' ? 'No narrowing yet' : 'Always';
}

// ---------------------------------------------------------------- approvals

/** Rights that move money, stock or other people's rights. Giving any of them is never done on one person's say-so. */
export const RISKY_FEATURES = ['feat.bill.void', 'feat.bill.refund', 'feat.bill.price-edit', 'feat.bill.open-drawer', 'feat.discount.approve', 'feat.discount.complimentary', 'feat.cake.cancel'];
export const RISKY_PAGES = ['users', 'rights-matrix', 'settings', 'backup', 'day-close', 'accounts'];
export const isRisky = (kind: RuleKind, key: string): boolean => (kind === 'page' ? RISKY_PAGES.includes(key) : key.startsWith('feat.admin.') || RISKY_FEATURES.includes(key));

export interface RightsRequest {
  id: string;
  /** whose rights */
  userId: string;
  userName: string;
  requestedBy: string;
  requestedByName: string;
  /** one line for the list: "+ Refund · until 25 Nov, Gulberg" */
  summary: string;
  /** what applying it does: the person's new lists, or one rule */
  payload: { permissions?: string[]; featurePermissions?: string[]; rule?: RuleDraft };
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  decisionNote?: string;
}

/**
 * Does this change need an admin's say-so? `add` is what the change would give. An admin never does; nobody else may give themselves
 * anything; and giving a risky right to anyone needs approval. Taking rights away never does.
 */
export function needsApproval(actor: Pick<User, 'id' | 'role'>, target: Pick<User, 'id'>, add: { pages: string[]; features: string[] }): { needed: boolean; reason?: string } {
  if (actor.role === 'admin') return { needed: false };
  if (add.pages.length + add.features.length === 0) return { needed: false };
  if (actor.id === target.id) return { needed: true, reason: 'You cannot give yourself rights — an admin approves it' };
  const risky = [...add.pages.filter(k => isRisky('page', k)), ...add.features.filter(k => isRisky('feature', k))];
  return risky.length ? { needed: true, reason: 'This gives a right that moves money, stock or other people’s rights — an admin approves it' } : { needed: false };
}

/** A rule is a grant of power when it is a grant; a limit only narrows, so it never needs approval. */
export function ruleNeedsApproval(actor: Pick<User, 'id' | 'role'>, target: Pick<User, 'id'>, d: Pick<RuleDraft, 'mode' | 'kind' | 'key'>): { needed: boolean; reason?: string } {
  if (d.mode === 'limit') return { needed: false };
  return needsApproval(actor, target, { pages: d.kind === 'page' ? [d.key] : [], features: d.kind === 'feature' ? [d.key] : [] });
}

/** Only an admin decides; and nobody decides a request about their own rights. */
export function mayDecide(actor: Pick<User, 'id' | 'role'>, req: Pick<RightsRequest, 'status'>): { ok: boolean; reason?: string } {
  if (req.status !== 'pending') return { ok: false, reason: 'Already decided' };
  if (actor.role !== 'admin') return { ok: false, reason: 'Only an admin can approve or reject' };
  return { ok: true };
}

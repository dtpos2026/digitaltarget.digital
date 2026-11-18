// What the Users panel shows about one person (v1.125.1): how they sign in, the modules they can open and the actions they can take
// (grouped, in the order the sidebar and the Rights grid use), the rules on them (limits and temporary grants) and any change to their
// rights that is waiting for an admin. Pure functions over what the store already holds.
import type { User } from '@/lib/types';
import { FEATURE_GROUP_ORDER, FEATURE_PERMISSIONS, GROUP_ORDER, PAGES } from '@/lib/permissions';
import { effectiveFeatures, effectivePages } from '@/lib/rightsMatrix';
import { describeScope, type RightsRequest, type RightsRule } from '@/lib/rightsRules';

export interface Grouped { group: string; titles: string[] }

export interface UserPanelModel {
  /** how the person signs in */
  signIn: 'username' | 'phone';
  isAdmin: boolean;
  pages: Grouped[];
  pageCount: number;
  pageTotal: number;
  features: Grouped[];
  featureCount: number;
  featureTotal: number;
  rules: { id: string; mode: 'limit' | 'grant'; what: string; scope: string; reason?: string }[];
  waiting: { id: string; summary: string; by: string }[];
}

export const signInKind = (u: Pick<User, 'role'>): 'username' | 'phone' => (u.role === 'rider' || u.role === 'order_taker' ? 'phone' : 'username');

function groupPages(keys: string[]): Grouped[] {
  const set = new Set(keys);
  return GROUP_ORDER.map(g => ({ group: g as string, titles: PAGES.filter(p => p.group === g && set.has(p.key)).map(p => p.title) })).filter(g => g.titles.length > 0);
}
function groupFeatures(keys: string[]): Grouped[] {
  const set = new Set(keys);
  return FEATURE_GROUP_ORDER.map(g => ({ group: g as string, titles: FEATURE_PERMISSIONS.filter(f => f.group === g && set.has(f.key)).map(f => f.title) })).filter(g => g.titles.length > 0);
}

export const ruleLabel = (kind: 'page' | 'feature', key: string): string =>
  kind === 'page' ? (PAGES.find(p => p.key === key)?.title ?? key) : (FEATURE_PERMISSIONS.find(f => f.key === key)?.title ?? key);

export function userPanel(u: User, ctx: { rules: RightsRule[]; requests: RightsRequest[]; branchName: (id: string) => string }): UserPanelModel {
  const pages = effectivePages(u), features = effectiveFeatures(u);
  return {
    signIn: signInKind(u),
    isAdmin: u.role === 'admin',
    pages: groupPages(pages), pageCount: pages.length, pageTotal: PAGES.length,
    features: groupFeatures(features), featureCount: features.length, featureTotal: FEATURE_PERMISSIONS.length,
    rules: ctx.rules.filter(r => r.userId === u.id && !r.revokedAt).map(r => ({
      id: r.id, mode: r.mode, what: ruleLabel(r.kind, r.key), scope: describeScope(r, ctx.branchName), reason: r.reason,
    })),
    waiting: ctx.requests.filter(q => q.userId === u.id && q.status === 'pending').map(q => ({ id: q.id, summary: q.summary, by: q.requestedByName })),
  };
}

/** The sentence under the name: "Branch Manager · Gulberg", "Cashier · all branches". */
export function userLine(u: Pick<User, 'branchId'>, positionName: string | undefined, roleLabel: string, branchName: (id: string) => string): string {
  return [positionName || roleLabel, u.branchId ? branchName(u.branchId) : 'all branches'].join(' · ');
}

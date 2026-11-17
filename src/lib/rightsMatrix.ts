// ============================================================================
// Rights matrix (v1.116.0) — who can open which module and do which action, for every person, on one page.
//
// The software already stores rights per user: `permissions` (the modules they may open) and `featurePermissions` (the actions
// they may take: void, refund, discount, post a stock count …), each falling back to the role's defaults when empty. This file is
// the arithmetic the Rights page does on those two lists — nothing new is stored:
//   • an admin always has everything and cannot be edited here (as everywhere else in the software);
//   • changing one cell first writes down what the person effectively has (so "empty = defaults" never silently changes), then
//     adds or removes that one key — and an action list that would end up empty is stored as NO_FEATURES, because an empty list
//     means "the role's defaults" and would hand a void or refund right back;
//   • every change reports what it added and removed, for the audit log;
//   • a whole position (Branch Manager, Head Baker …) can be applied in one go.
// Pure functions.
// ============================================================================
import type { User } from '@/lib/types';
import { FEATURE_PERMISSIONS, PAGES, defaultFeaturePermissionsForRole, defaultPermissionsForRole } from '@/lib/permissions';
import { NO_FEATURES, presetPermissions, type RolePreset } from '@/lib/orgStructure';

/** Like NO_FEATURES: an empty page list means "the role's defaults", so a person with no module at all is stored with this marker. */
export const NO_PAGES = 'page.none';

export const effectivePages = (u: Pick<User, 'role' | 'permissions'>): string[] =>
  u.role === 'admin' ? PAGES.map(p => p.key) : (u.permissions && u.permissions.length ? u.permissions : defaultPermissionsForRole(u.role)).filter(k => k !== NO_PAGES);

export const effectiveFeatures = (u: Pick<User, 'role' | 'featurePermissions'>): string[] =>
  u.role === 'admin' ? FEATURE_PERMISSIONS.map(f => f.key) : (u.featurePermissions && u.featurePermissions.length ? u.featurePermissions : defaultFeaturePermissionsForRole(u.role)).filter(k => k !== NO_FEATURES);

export const isLocked = (u: Pick<User, 'role'>): boolean => u.role === 'admin';

export interface RightsChange { pagesAdded: string[]; pagesRemoved: string[]; featuresAdded: string[]; featuresRemoved: string[] }
export const noChange = (c: RightsChange): boolean => !c.pagesAdded.length && !c.pagesRemoved.length && !c.featuresAdded.length && !c.featuresRemoved.length;

export function diffRights(before: User, after: User): RightsChange {
  const bp = new Set(effectivePages(before)), ap = new Set(effectivePages(after));
  const bf = new Set(effectiveFeatures(before)), af = new Set(effectiveFeatures(after));
  return {
    pagesAdded: [...ap].filter(k => !bp.has(k)), pagesRemoved: [...bp].filter(k => !ap.has(k)),
    featuresAdded: [...af].filter(k => !bf.has(k)), featuresRemoved: [...bf].filter(k => !af.has(k)),
  };
}

/** One module on or off for one person. An admin is returned unchanged. */
export function setPage(u: User, pageKey: string, on: boolean): User {
  if (isLocked(u) || !PAGES.some(p => p.key === pageKey)) return u;
  const cur = effectivePages(u);
  const next = on ? (cur.includes(pageKey) ? cur : [...cur, pageKey]) : cur.filter(k => k !== pageKey);
  return { ...u, permissions: next.length ? next : [NO_PAGES] };
}

/** One action on or off for one person. */
export function setFeature(u: User, featureKey: string, on: boolean): User {
  if (isLocked(u) || !FEATURE_PERMISSIONS.some(f => f.key === featureKey)) return u;
  const cur = effectiveFeatures(u);
  const next = on ? (cur.includes(featureKey) ? cur : [...cur, featureKey]) : cur.filter(k => k !== featureKey);
  return { ...u, featurePermissions: next.length ? next : [NO_FEATURES] };
}

/**
 * A whole position at once (its pages and actions). The person's role is NOT changed here — the role decides how they sign in and
 * what a till shows them, and is set on the Users screen; the grid only offers positions of the person's own role. An admin is never changed.
 */
export function applyPreset(u: User, preset: RolePreset): User {
  if (isLocked(u) || preset.role !== u.role) return u;
  const p = presetPermissions(preset);
  return { ...u, permissions: p.permissions, featurePermissions: p.featurePermissions };
}

/** A line for the audit log: "+ Stock Count, Costing · − Void Bill". */
export function describeChange(c: RightsChange): string {
  const pageName = (k: string) => PAGES.find(p => p.key === k)?.title ?? k;
  const featName = (k: string) => FEATURE_PERMISSIONS.find(f => f.key === k)?.title ?? k;
  const parts = [
    ...c.pagesAdded.map(k => `+ ${pageName(k)}`), ...c.pagesRemoved.map(k => `− ${pageName(k)}`),
    ...c.featuresAdded.map(k => `+ ${featName(k)}`), ...c.featuresRemoved.map(k => `− ${featName(k)}`),
  ];
  return parts.join(' · ');
}

export interface MatrixCounts { pages: number; features: number }
export const countsFor = (u: User): MatrixCounts => ({ pages: effectivePages(u).length, features: effectiveFeatures(u).length });

/** The matrix as plain rows for a CSV: one row per module or action, one column per person (Yes / —). */
export function matrixCsv(users: User[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['Type', 'Module / action', ...users.map(u => `${u.name} (${u.role})`)].map(q).join(',');
  const pageSets = users.map(u => new Set(effectivePages(u))), featSets = users.map(u => new Set(effectiveFeatures(u)));
  const rows = [
    ...PAGES.map(p => ['Module', p.title, ...pageSets.map(s => (s.has(p.key) ? 'Yes' : '—'))]),
    ...FEATURE_PERMISSIONS.map(f => ['Action', f.title, ...featSets.map(s => (s.has(f.key) ? 'Yes' : '—'))]),
  ].map(r => r.map(q).join(','));
  return [head, ...rows].join('\n');
}

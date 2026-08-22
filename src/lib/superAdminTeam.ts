import { firestoreUnavailable, legacyRead } from './legacyFirebaseGuard';
// Super Admin Team — roles, permissions, Firestore helpers
import { fbDb } from './firebase';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, addDoc, query, orderBy, limit as fsLimit, writeBatch } from 'firebase/firestore';
import { SUPER_ADMIN_EMAILS } from './firebase';

export type SuperAdminRole =
  | 'owner'
  | 'support'
  | 'sales'
  | 'billing'
  | 'technical';

export interface TeamMember {
  email: string;          // lowercased; doc id
  name?: string;
  role: SuperAdminRole;
  active: boolean;
  createdAt?: any;
  createdBy?: string;
  lastLoginAt?: any;
}

export const ROLE_LABELS: Record<SuperAdminRole, string> = {
  owner: 'Owner Super Admin',
  support: 'Support Admin',
  sales: 'Sales Admin',
  billing: 'Billing Admin',
  technical: 'Technical Admin',
};

export const ROLE_DESCRIPTIONS: Record<SuperAdminRole, string> = {
  owner: 'Full access to everything',
  support: 'Restaurants, devices & modules',
  sales: 'Onboarding & new restaurants',
  billing: 'Plans, payments & expiry',
  technical: 'Errors, logs & system health',
};

export interface Permissions {
  manageTeam: boolean;
  manageRestaurants: boolean;
  manageDevices: boolean;
  managePlans: boolean;
  viewLogs: boolean;
  viewMap: boolean;
}

export function permissionsFor(role: SuperAdminRole): Permissions {
  switch (role) {
    case 'owner':
      return { manageTeam: true, manageRestaurants: true, manageDevices: true, managePlans: true, viewLogs: true, viewMap: true };
    case 'support':
      return { manageTeam: false, manageRestaurants: true, manageDevices: true, managePlans: false, viewLogs: true, viewMap: true };
    case 'sales':
      return { manageTeam: false, manageRestaurants: true, manageDevices: false, managePlans: false, viewLogs: false, viewMap: true };
    case 'billing':
      return { manageTeam: false, manageRestaurants: true, manageDevices: false, managePlans: true, viewLogs: true, viewMap: false };
    case 'technical':
      return { manageTeam: false, manageRestaurants: false, manageDevices: true, managePlans: false, viewLogs: true, viewMap: true };
  }
}

const TEAM_COL = 'superAdminTeam';
const ACTIVITY_COL = 'superAdminActivity';

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

export function isHardcodedOwner(email?: string | null): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase());
}

/** Returns the active super admin role for this email, or null if not a super admin. */
export async function fetchSuperAdminRole(email?: string | null): Promise<SuperAdminRole | null> {
  if (firestoreUnavailable()) return null as any;
  if (!email) return null;
  if (isHardcodedOwner(email)) return 'owner';

  // v1.18.1 — a super admin signed in through Supabase has no Firebase
  // session, so the Firestore read below returns nothing and the account
  // appears to have no role at all. Resolve from super_admins instead.
  try {
    const { usingSupabaseAuth } = await import('./authProvider');
    if (usingSupabaseAuth()) {
      const { sb } = await import('./supabase');
      const { data, error } = await sb()
        .from('super_admins')
        .select('can_manage_team, is_active')
        .eq('email', email.toLowerCase())
        .eq('is_active', true)
        .maybeSingle();
      if (error || !data) return null;
      return data.can_manage_team ? 'owner' : 'support';
    }
  } catch { /* fall through to the Firebase path */ }

  try {
    const snap = await getDoc(doc(fbDb(), TEAM_COL, emailKey(email)));
    if (!snap.exists()) return null;
    const data = snap.data() as TeamMember;
    if (data.active === false) return null;
    return data.role;
  } catch {
    return null;
  }
}

export async function listTeam(): Promise<TeamMember[]> {
  if (firestoreUnavailable()) {
    const { listTeam: sbListTeam } = await import('./superAdminSupabase');
    const rows: any[] = await sbListTeam();
    return rows.map(r => ({
      email: r.email, name: r.email, role: r.can_manage_team ? 'owner' : 'support',
      active: r.is_active !== false,
    })) as TeamMember[];
  }
  if (firestoreUnavailable()) return legacyRead([] as any, 'listTeam');

  const snap = await getDocs(collection(fbDb(), TEAM_COL));
  const list: TeamMember[] = [];
  snap.forEach(d => list.push({ email: d.id, ...(d.data() as any) }));
  list.sort((a, b) => a.email.localeCompare(b.email));
  return list;
}

export async function saveTeamMember(m: Omit<TeamMember, 'createdAt'> & { createdBy?: string }): Promise<void> {
  // Adding a team member wrote to Firestore, so it failed on a Supabase
  // session. The Supabase path goes through an RPC that checks can_manage_team
  // server-side rather than trusting the caller.
  if (firestoreUnavailable()) {
    const { addTeamMember } = await import('./superAdminSupabase');
    await addTeamMember(m.email, (m as any).role === 'owner');
    return;
  }
  const id = emailKey(m.email);
  const ref = doc(fbDb(), TEAM_COL, id);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    email: id,
    name: m.name || '',
    role: m.role,
    active: m.active !== false,
    createdAt: existing.exists() ? (existing.data() as any).createdAt : serverTimestamp(),
    createdBy: existing.exists() ? (existing.data() as any).createdBy : (m.createdBy || ''),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function removeTeamMember(email: string): Promise<void> {
  if (firestoreUnavailable()) {
    const { removeTeamMember: sbRemove } = await import('./superAdminSupabase');
    await sbRemove(email);
    return;
  }
  await deleteDoc(doc(fbDb(), TEAM_COL, emailKey(email)));
}

export async function setMemberActive(email: string, active: boolean): Promise<void> {
  if (firestoreUnavailable()) return;
  await setDoc(doc(fbDb(), TEAM_COL, emailKey(email)), { active, updatedAt: serverTimestamp() }, { merge: true });
}

export async function recordLogin(email: string): Promise<void> {
  if (firestoreUnavailable()) return;
  if (isHardcodedOwner(email)) return;
  try {
    await setDoc(doc(fbDb(), TEAM_COL, emailKey(email)), { lastLoginAt: serverTimestamp() }, { merge: true });
  } catch {}
}

export interface ActivityEntry {
  id?: string;
  actorEmail: string;
  actorRole?: SuperAdminRole;
  action: string;
  target?: string;
  meta?: any;
  at?: any;
}

export async function logActivity(entry: Omit<ActivityEntry, 'at' | 'id'>): Promise<void> {
  if (firestoreUnavailable()) return;
  try {
    await addDoc(collection(fbDb(), ACTIVITY_COL), { ...entry, at: serverTimestamp() });
  } catch {}
}

export async function recentActivity(max = 100): Promise<ActivityEntry[]> {
  if (firestoreUnavailable()) return [] as any;
  try {
    const q = query(collection(fbDb(), ACTIVITY_COL), orderBy('at', 'desc'), fsLimit(max));
    const snap = await getDocs(q);
    const list: ActivityEntry[] = [];
    snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
    return list;
  } catch {
    return [];
  }
}

export async function deleteActivity(id: string): Promise<void> {
  if (firestoreUnavailable()) return;
  await deleteDoc(doc(fbDb(), ACTIVITY_COL, id));
}

export async function clearAllActivity(): Promise<void> {
  if (firestoreUnavailable()) return;
  const snap = await getDocs(collection(fbDb(), ACTIVITY_COL));
  const batch = writeBatch(fbDb());
  snap.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

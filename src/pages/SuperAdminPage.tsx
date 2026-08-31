import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { fbAuth, fbDb } from '@/lib/firebase';
import { signOut, getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { usingSupabaseAuth, currentAuthUser, authSignOut } from '@/lib/authProvider';
import { initializeApp, deleteApp } from 'firebase/app';
import {
  collection, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc, serverTimestamp, collectionGroup,
} from 'firebase/firestore';
import {
  Shield, CheckCircle2, XCircle, RefreshCw, LogOut, Trash2, Smartphone, Store, MapPin, Wifi, Users, Receipt, Calendar, AlertTriangle, MessageCircle, Package, Download, FileSignature, Sparkles, Plus, KeyRound,
} from 'lucide-react';
import ReleaseManagerPage from '@/pages/ReleaseManagerPage';
import SuperAdminMonitoringPanel from '@/components/SuperAdminMonitoringPanel';
import dtLogo from '@/assets/digital-target-logo.png';
import PoweredByBrand from '@/components/PoweredByBrand';
import LeafletMap, { type MapMarker } from '@/components/LeafletMap';
import { isOnline, tsToMs } from '@/lib/geo';
import { PLAN_OPTIONS, getPlan, effectiveDeviceLimit } from '@/lib/plans';
import TeamPanel from '@/components/TeamPanel';
import { fetchSuperAdminRole, type SuperAdminRole } from '@/lib/superAdminTeam';
import FeatureControlDialog from '@/components/FeatureControlDialog';
import ClientBillingDialog from '@/components/ClientBillingDialog';
import ClientAgreementDialog from '@/components/ClientAgreementDialog';
import SuperAdminMessages from '@/components/SuperAdminMessages';
import SuperAdminReports from '@/components/SuperAdminReports';
import PackagesManager from '@/components/PackagesManager';
import CustomerAppsManager from '@/components/CustomerAppsManager';
import PlansManager from '@/components/PlansManager';
import BrandSignaturePanel from '@/components/BrandSignaturePanel';
import MarketingContactsPanel from '@/components/MarketingContactsPanel';
import { tsToDate, daysUntil, isExpired } from '@/lib/billing';
import { exportClientsToExcel, exportClientsToCSV, exportClientsToPDF } from '@/lib/clientExport';
import jsPDF from 'jspdf';
import { drawPdfHeader, drawPdfFooter } from '@/lib/pdfBrand';

// Module groups for Bulk Cleanup Mode — each label maps to one or more Firestore sub-collections under tenants/{tid}/
const MODULE_GROUPS: Record<string, string[]> = {
  ledger:      ['ledger', 'transactions', 'parties', 'creditPayments', 'dailyCashCloses', 'paymentAccounts'],
  invoices:    ['invoices', 'payments'],
  orders:      ['orders'],
  menu:        ['menuItems', 'categories', 'recipes'],
  customers:   ['customers', 'marketingContacts'],
  inventory:   ['inventory', 'stockLogs', 'wastages', 'receivingEntries'],
  hr:          ['employees', 'attendance', 'leaves', 'payslips', 'advances'],
  tables:      ['tables', 'floors', 'kitchens', 'waiters', 'riders', 'branches'],
  devices:     ['devices'],
  logs:        ['auditLogs', 'messages', 'serviceCalls', 'promoCodes'],
};
const MODULE_LABELS: Record<string, string> = {
  ledger: 'Ledger & Accounts',
  invoices: 'Invoices & Payments',
  orders: 'Orders / KOT',
  menu: 'Menu & Recipes',
  customers: 'Customers & Marketing',
  inventory: 'Inventory & Stock',
  hr: 'HR (Staff, Attendance, Payroll)',
  tables: 'Tables / Floors / Branches',
  devices: 'Devices',
  logs: 'Audit Logs & Messages',
};


interface IndexRow {
  id: string;
  tenantId: string;
  restaurantName?: string;
  email?: string;
  approved: boolean;
  createdAt?: any;
  plan?: string;
  customDeviceLimit?: number;
  featureOverrides?: Record<string, boolean>;
  premiumThemeAllowed?: boolean;
  planExpiryAt?: any;
  lastPaymentAt?: any;
  /**
   * v1.28.4 — the code the DT Rider / DT Order Taker / Customer apps use to
   * tell this restaurant apart from another with the same staff username.
   * Every tenant has had one since the tenants_workspace_code trigger, but the
   * panel never selected it, so the operator who creates the restaurant had no
   * way to read the code the staff apps then ask for.
   */
  workspaceCode?: string;
}

interface DeviceRow {
  tenantId: string;
  deviceId: string;
  hardwareId?: string;
  /** Which branch this device is registered against (devices.branch_id). */
  branchId?: string;
  branchName?: string;
  /**
   * v1.26.8 — the machine hint that lets one physical PC be one device even
   * when it is opened in several browsers. Surfaced so the operator can see
   * WHY a single row covers more than one browser profile, and audit it.
   */
  fingerprint?: string;
  mergedProfiles?: string[];
  lastLoginAt?: any;
  loginCount?: number;
  userId?: string;
  deviceName?: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
  platform?: 'electron' | 'web';
  appVersion?: string;
  approved?: boolean;
  createdAt?: any;
  restaurantName?: string;
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  isp?: string;
  screen?: string;
  timezone?: string;
  hostname?: string;
  osUser?: string;
  cpuModel?: string;
  cpuCores?: number;
  memoryGb?: number;
  connectionType?: string;
  downlinkMbps?: number;
  networkRtt?: number;
  saveData?: boolean;
  macAddresses?: string[];
  lat?: number;
  lng?: number;
  /** Reported accuracy radius in metres, when the browser supplied one. */
  accuracyM?: number;
  lastActiveAt?: any;
  lastActiveMs?: number;
  loginAt?: any;
  blocked?: boolean;
}

interface RestaurantLocation {
  tenantId: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  city?: string;
  address?: string;
  phone?: string;
  logo?: string;
  plan?: string;
}

interface Props { onLogout: () => void; }

export default function SuperAdminPage({ onLogout }: Props) {
  const [tab, setTab] = useState<'restaurants' | 'clients' | 'reports' | 'packages' | 'plans' | 'messages' | 'devices' | 'map' | 'team' | 'releases' | 'cleanup' | 'monitor' | 'customerApps'>('restaurants');
  const [rows, setRows] = useState<IndexRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [currentRole, setCurrentRole] = useState<SuperAdminRole>('owner');
  const [featuresFor, setFeaturesFor] = useState<IndexRow | null>(null);
  const [billingFor, setBillingFor] = useState<IndexRow | null>(null);
  const [agreementFor, setAgreementFor] = useState<IndexRow | null>(null);
  const [devicesFor, setDevicesFor] = useState<IndexRow | null>(null);

  // Bulk-select state (checkbox mode for Restaurants & Devices tabs)
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedR, setSelectedR] = useState<Set<string>>(new Set());
  const [selectedD, setSelectedD] = useState<Set<string>>(new Set()); // key = tid|did
  // Module-cleanup scope: 'full' wipes whole restaurant; 'modules' only purges selected sub-collections
  const [cleanupScope, setCleanupScope] = useState<'full' | 'modules'>('modules');
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(['ledger']));
  const toggleModule = (m: string) => setSelectedModules(prev => {
    const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n;
  });
  const toggleR = (id: string) => setSelectedR(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleD = (key: string) => setSelectedD(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  const clearSelection = () => { setSelectedR(new Set()); setSelectedD(new Set()); };

  // ===== Create New Restaurant dialog =====
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRest, setNewRest] = useState({ name: '', email: '', password: '', plan: 'trial' });

  const createRestaurant = async () => {
    const name = newRest.name.trim();
    const email = newRest.email.trim().toLowerCase();
    const password = newRest.password;
    if (!name || !email || password.length < 6) {
      toast.error('Restaurant name, email and a password of at least 6 characters are required.');
      return;
    }
    setCreating(true);

    // ===== v1.18.0 — Supabase path =====
    // Creating another user through Supabase's admin API requires the
    // service_role key, which bypasses RLS completely and must never reach a
    // browser bundle. The Firebase version avoided the problem with a
    // secondary app instance; there is no safe frontend equivalent.
    //
    // So the restaurant is pre-provisioned server-side (tenant + branch +
    // counters + settings) and the owner is linked automatically when they
    // sign up with that email. No privileged key leaves the server, and the
    // Super Admin's own session is untouched.
    if (usingSupabaseAuth()) {
      if (!newRest.password || newRest.password.length < 6) {
        toast.error('Set a password of at least 6 characters — the restaurant signs in with it');
        setCreating(false);
        return;
      }
      try {
        const { sb } = await import('@/lib/supabase');
        const { data, error } = await sb().rpc('sa_create_restaurant', {
          p_name: name, p_email: email, p_plan: newRest.plan,
        });
        if (error) throw error;
        const r = data as { tenant_id: string; slug: string; workspace_code?: string };

        // Keep the owner's email on record straight away. If provisioning
        // below fails, the panel still shows who this restaurant belongs to
        // instead of an empty row.
        await sb().from('pending_owners')
          .upsert({ tenant_id: r.tenant_id, email }, { onConflict: 'tenant_id' });

        // ===== v1.21.1 — CREATE THE OWNER'S ACCOUNT TOO =====
        // The form collected a password and then threw it away: the RPC only
        // allow-listed the email, so no Supabase account existed. The owner
        // was expected to "sign up themselves" — which nothing told them to
        // do, and which the Super Admin had no way to know had not happened.
        //
        // The restaurant therefore looked correctly created (tenant, branch,
        // counters, default POS user all present) while being impossible to
        // log into. That is exactly the "Invalid login credentials" dead end.
        //
        // signUp() is used rather than the admin API on purpose: the admin API
        // needs the service_role key, which must never reach the browser.
        let ownerCreated = false;
        let ownerError = '';
        try {
          const { provisionRestaurantOwner } = await import('@/lib/platform.functions');
          const payload = {
            data: {
              tenantId: r.tenant_id,
              email,
              password: newRest.password,
              displayName: name,
            },
          };
          try {
            await provisionRestaurantOwner(payload);
          } catch (first: any) {
            // A stale/expired Super Admin token is the one failure worth
            // retrying: refresh it once and provision again instead of
            // leaving the restaurant without an owner login.
            if (!/unauthor|authorization|jwt|token/i.test(first?.message ?? '')) throw first;
            await sb().auth.refreshSession();
            await provisionRestaurantOwner(payload);
          }
          ownerCreated = true;
        } catch (suErr: any) {
          const raw = suErr?.message ?? String(suErr);
          ownerError = /unauthor|authorization/i.test(raw)
            ? 'Super Admin session expired — sign in again, then use "Fix Owner Login" on this restaurant.'
            : raw;
          console.error('[superadmin] owner provisioning failed', suErr);
        }



        // v1.28.4 — say the Workspace Code out loud at the one moment it is
        // needed. It has always been minted at INSERT, but nothing displayed
        // it, so creating a restaurant looked like it produced no code at all
        // and the staff apps then asked for one that could not be found.
        const wsCode = r.workspace_code ?? '';
        const wsLine = wsCode
          ? ` Workspace Code: ${wsCode} — the Rider / Order Taker / Customer apps ask for this.`
          : '';
        toast.success(
          ownerCreated
            ? `✅ ${name} created. The owner can sign in now with ${email} and the password you set. POS user: admin.${wsLine}`
            : `⚠️ ${name} created, but the owner account could not be made${ownerError ? `: ${ownerError}` : ''}.${wsLine}`,

          { duration: 15000 },
        );
        setNewRest({ name: '', email: '', password: '', plan: 'trial' });
        setShowCreate(false);
        load();
      } catch (e: any) {
        toast.error(e?.message || 'Could not create the restaurant');
      } finally {
        setCreating(false);
      }
      return;
    }

    // Cloud is the only backend. Without a cloud session there is nothing to
    // create against, so say so instead of hitting a dead code path.
    toast.error('Sign in to the cloud as Super Admin to create a restaurant');
    setCreating(false);
  };


  useEffect(() => {
    // v1.18.1 — read identity from the auth adapter, not fbAuth().
    // A super admin signed in through Supabase has NO Firebase user, so
    // fbAuth().currentUser was null: the panel showed a blank email and the
    // role lookup silently failed, leaving the account with no powers.
    const email = (currentAuthUser()?.email || '').toLowerCase();
    setCurrentEmail(email);
    if (email) fetchSuperAdminRole(email).then(r => { if (r) setCurrentRole(r); });
  }, []);

  /**
   * v1.19.2 — load the restaurant list from whichever backend this session
   * belongs to.
   *
   * ===== THE BUG THIS FIXES =====
   * This went straight to Firestore's `userIndex` with no backend check. A
   * Super Admin authenticated against Supabase has no Firebase identity at
   * all, so Firestore answered "Missing or insufficient permissions" — the
   * error reported right after a restaurant was created successfully.
   *
   * The creation had worked (it went through the Supabase RPC); only the
   * refresh afterwards was still pointed at Firebase. So the panel looked
   * broken even though the restaurant existed.
   */
  const loadFromSupabase = async () => {
    const { sb } = await import('@/lib/supabase');

    // Tenants + their owner email (pending or claimed).
    const [tRes, pRes, dRes, bRes, sRes] = await Promise.all([
      sb().from('tenants').select('id,name,slug,plan,plan_expires_at,is_active,created_at,custom_device_limit,workspace_code'),
      sb().from('pending_owners').select('email,tenant_id,claimed_at'),
      sb().from('devices').select('id,tenant_id,branch_id,device_label,hardware_id,fingerprint,platform,app_version,approved,blocked,blocked_at,last_seen_at,lat,lng,accuracy_m,ip,meta,last_login_at,login_count'),
      sb().from('branches').select('id,tenant_id,name,lat,lng,is_active,address,phone'),
      // ===== v1.29.6 — the map pin showed a letter, never the logo =====
      //
      // REPORTED: "Super Admin map par restaurant ka apna logo aana chahiye,
      // ye 'B' wala generic marker nahi."
      //
      // The pin has drawn r.logo since it was built, with the first letter of
      // the name only as a fallback. It always drew the letter, because this
      // asked for a column that does not exist: tenant_settings has
      // (tenant_id, branch_id, settings, updated_at) — no `data`. Line 680 of
      // this same file already selects 'settings' correctly.
      //
      // PostgREST answers 42703 for an unknown column, so sRes.data was null on
      // every load. Nothing noticed, because only tRes.error was ever checked:
      // the map lost every logo, every phone number, and the
      // restaurantLat/Lng fallback that puts a single-branch shop on the map at
      // all — silently, for as long as this line has existed.
      sb().from('tenant_settings').select('tenant_id,settings'),
    ]);
    if (tRes.error) throw tRes.error;
    // The other four are not fatal — the panel is still useful without devices
    // or branches — but they must not fail in silence again. A wrong column or
    // a denied policy now says so by name.
    for (const [label, res] of [
      ['pending_owners', pRes], ['devices', dRes],
      ['branches', bRes], ['tenant_settings', sRes],
    ] as const) {
      if (res.error) console.error(`[SuperAdmin] ${label} query failed:`, res.error.message ?? res.error);
    }

    const emailByTenant: Record<string, string> = {};
    for (const p of (pRes.data ?? []) as any[]) emailByTenant[p.tenant_id] = p.email;

    const list: IndexRow[] = ((tRes.data ?? []) as any[]).map(t => ({
      id: t.id,
      tenantId: t.id,
      restaurantName: t.name,
      email: emailByTenant[t.id] ?? '',
      // On Supabase a tenant exists only once provisioned, so it is approved
      // by definition. Firebase used `approved` as a manual gate.
      approved: t.is_active !== false,
      plan: t.plan,
      planExpiryAt: t.plan_expires_at,
      customDeviceLimit: t.custom_device_limit ?? undefined,
      createdAt: t.created_at,
      workspaceCode: t.workspace_code ?? undefined,
    }));
    list.sort((a, b) => Number(a.approved) - Number(b.approved));
    setRows(list);

    const nameByTid: Record<string, string> = {};
    for (const r of list) nameByTid[r.tenantId] = r.restaurantName || r.email || r.tenantId;

    // devices.branch_id was fetched but never resolved, so the Devices screen
    // could not say which branch a device belonged to — the one field a
    // multi-branch operator needs most when deciding whether to approve it.
    const branchNameById: Record<string, string> = {};
    for (const b of ((bRes.data ?? []) as any[])) branchNameById[b.id] = b.name;

    const dList: DeviceRow[] = ((dRes.data ?? []) as any[]).map(d => ({
      tenantId: d.tenant_id,
      deviceId: d.id,
      restaurantName: nameByTid[d.tenant_id] || d.tenant_id,
      deviceName: d.device_label,
      approved: !!d.approved,
      blocked: !!d.blocked,
      platform: d.platform,
      appVersion: d.app_version,
      lastSeen: d.last_seen_at,
      // v1.27.1 — every online check on this page reads lastActiveAt, and the
      // Supabase mapping only ever set lastSeen. So the Live Map, the device
      // badges and the monitor all showed "offline" for every device on every
      // Supabase deployment, no matter how recently it had checked in.
      lastActiveAt: d.last_seen_at,
      lat: d.lat, lng: d.lng, accuracyM: d.accuracy_m ?? undefined,
      hardwareId: d.hardware_id,
      branchId: d.branch_id ?? undefined,
      branchName: d.branch_id ? branchNameById[d.branch_id] : undefined,
      fingerprint: d.fingerprint ?? undefined,
      mergedProfiles: Array.isArray(d.meta?.mergedProfiles) ? d.meta.mergedProfiles : undefined,
      userId: d.meta?.userId ?? d.meta?.osUser ?? undefined,
      ip: d.ip ?? d.meta?.ip,
      city: d.meta?.city, region: d.meta?.region, country: d.meta?.country, isp: d.meta?.isp,
      browser: d.meta?.browser, browserVersion: d.meta?.browserVersion,
      os: d.meta?.os, deviceType: d.meta?.deviceType,
      screen: d.meta?.screen, timezone: d.meta?.timezone, hostname: d.meta?.hostname,
      osUser: d.meta?.osUser, cpuModel: d.meta?.cpuModel,
      cpuCores: d.meta?.cpuCores, memoryGb: d.meta?.memoryGb,
      lastLoginAt: d.last_login_at, loginCount: d.login_count,
    })) as any;
    dList.sort((a, b) => Number(a.approved) - Number(b.approved));
    setDevices(dList);

    // ===== v1.27.1 — the Live Map had no restaurants on it, ever =====
    //
    // This said "no locations state to hold it" and threw the branch GPS away.
    // The state existed; only the Firebase loader ever filled it, and Firebase
    // is stubbed out in this build — so on every Supabase deployment the map
    // showed devices floating with no restaurant pin behind them.
    //
    // Same rule the Firebase path used: the first active branch that has
    // coordinates is the restaurant's position, falling back to the legacy
    // settings.restaurantLat/Lng for a single-branch shop that never created
    // a branch row.
    const settingsByTid: Record<string, any> = {};
    for (const r of ((sRes.data ?? []) as any[])) settingsByTid[r.tenant_id] = r.settings ?? {};

    const branchesByTid: Record<string, any[]> = {};
    for (const b of ((bRes.data ?? []) as any[])) {
      (branchesByTid[b.tenant_id] ||= []).push(b);
    }

    const locs: RestaurantLocation[] = [];
    for (const row of list) {
      const tid = row.tenantId;
      const st = settingsByTid[tid] ?? {};
      const branch = (branchesByTid[tid] ?? []).find(
        b => typeof b.lat === 'number' && typeof b.lng === 'number' && b.is_active !== false,
      );
      const lat = branch?.lat ?? (typeof st.restaurantLat === 'number' ? st.restaurantLat : null);
      const lng = branch?.lng ?? (typeof st.restaurantLng === 'number' ? st.restaurantLng : null);
      if (lat == null || lng == null) continue;   // nothing to pin — say so, do not guess
      locs.push({
        tenantId: tid,
        name: st.name || row.restaurantName || tid,
        lat, lng,
        label: branch?.name || st.restaurantLocationLabel,
        city: st.city,
        address: branch?.address || st.address,
        phone: branch?.phone || st.phone1,
        logo: st.appLogo || st.logo || st.webPortalLogo || '',
        plan: row.plan || 'trial',
      });
    }
    setRestaurants(locs);
  };

  const load = async () => {
    setLoading(true);
    try {
      if (usingSupabaseAuth()) {
        await loadFromSupabase();
        return;
      }
      const snap = await getDocs(collection(fbDb(), 'userIndex'));
      const list: IndexRow[] = [];
      const nameByTid: Record<string, string> = {};
      snap.forEach(d => {
        const data = d.data() as any;
        list.push({ id: d.id, ...data });
        nameByTid[d.id] = data.restaurantName || data.email || d.id;
      });
      list.sort((a, b) => Number(a.approved) - Number(b.approved));
      setRows(list);

      // Devices — collectionGroup query
      try {
        const dSnap = await getDocs(collectionGroup(fbDb(), 'devices'));
        const dList: DeviceRow[] = [];
        dSnap.forEach(d => {
          const parts = d.ref.path.split('/'); // tenants/{tid}/devices/{did}
          const tid = parts[1];
          const data = d.data() as any;
          dList.push({
            tenantId: tid,
            deviceId: d.id,
            restaurantName: nameByTid[tid] || tid,
            ...data,
          });
        });
        dList.sort((a, b) => Number(a.approved) - Number(b.approved));
        setDevices(dList);
      } catch (e) {
        console.warn('collectionGroup devices failed', e);

        const fallbackResults = await Promise.allSettled(
          list.map(async (row) => {
            const tenantId = row.tenantId || row.id;
            const tenantDevices = await getDocs(collection(fbDb(), 'tenants', tenantId, 'devices'));
            const tenantRows: DeviceRow[] = [];

            tenantDevices.forEach((deviceDoc) => {
              tenantRows.push({
                tenantId,
                deviceId: deviceDoc.id,
                restaurantName: nameByTid[tenantId] || tenantId,
                ...(deviceDoc.data() as any),
              });
            });

            return tenantRows;
          }),
        );

        const fallbackDevices = fallbackResults
          .filter((result): result is PromiseFulfilledResult<DeviceRow[]> => result.status === 'fulfilled')
          .flatMap(result => result.value);

        fallbackDevices.sort((a, b) => Number(a.approved) - Number(b.approved));
        setDevices(fallbackDevices);
      }

      // Restaurant physical locations — prefer first active branch with GPS,
      // fallback to legacy settings.restaurantLat/Lng.
      try {
        const { collection, getDocs } = await import('firebase/firestore');
        const locResults = await Promise.allSettled(
          list.map(async (row) => {
            const tenantId = row.tenantId || row.id;
            const sSnap = await getDoc(doc(fbDb(), 'tenants', tenantId, 'meta', 'settings'));
            const s = sSnap.exists() ? (sSnap.data() as any) : {};
            let lat: number | null = null;
            let lng: number | null = null;
            let label: string | undefined;
            let address: string | undefined = s.address;
            // 1) Try first branch with GPS
            try {
              const bSnap = await getDocs(collection(fbDb(), 'tenants', tenantId, 'branches'));
              const branch = bSnap.docs.map(d => d.data() as any)
                .find(b => typeof b.lat === 'number' && typeof b.lng === 'number' && b.isActive !== false);
              if (branch) {
                lat = branch.lat; lng = branch.lng;
                label = branch.name;
                address = branch.address || address;
              }
            } catch {}
            // 2) Fallback to legacy restaurant settings
            if (lat == null || lng == null) {
              if (typeof s.restaurantLat === 'number' && typeof s.restaurantLng === 'number') {
                lat = s.restaurantLat; lng = s.restaurantLng;
                label = label || s.restaurantLocationLabel;
              }
            }
            if (lat == null || lng == null) return null;
            return {
              tenantId,
              name: s.name || nameByTid[tenantId] || tenantId,
              lat, lng, label, address,
              phone: s.phone1,
              logo: s.appLogo || s.logo || s.webPortalLogo || '',
              plan: row.plan || 'trial',
            } as RestaurantLocation;
          })
        );
        const locs = locResults
          .filter((r): r is PromiseFulfilledResult<RestaurantLocation | null> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter((x): x is RestaurantLocation => !!x);
        setRestaurants(locs);
      } catch (e) {
        console.warn('restaurant locations load failed', e);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load');
    } finally {
      // ===== v1.19.8 — the spinner that never stopped =====
      // setLoading(false) used to sit AFTER the try block, on the normal
      // fall-through path. The Supabase branch returns early, so that line was
      // never reached: the data arrived (the header counters showed the right
      // numbers) while `loading` stayed true forever and the tab body kept
      // spinning. Nothing could be clicked because the list never rendered.
      //
      // A `finally` cannot be skipped by an early return, so the flag now
      // clears on every path — Supabase, Firebase, success or throw.
      setLoading(false);
    }
  };


  useEffect(() => { load(); }, []);

  // v1.19.2 — every Super Admin action below now checks the backend first.
  // Each one used to go straight to Firestore, so on a Supabase session they
  // all failed with "Missing or insufficient permissions" — the same root
  // cause as the restaurant list.

  const approve = async (r: IndexRow) => {
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        const { error } = await sb().from('tenants')
          .update({ is_active: true }).eq('id', r.tenantId || r.id);
        if (error) throw error;
        toast.success(`${r.restaurantName || r.email} approved`);
        load();
      } catch (e: any) { toast.error(e?.message || 'Approve failed'); }
      return;
    }
    try {
      await updateDoc(doc(fbDb(), 'userIndex', r.id), {
        approved: true,
        restaurantApproved: true,
        approvedAt: serverTimestamp(),
      });
      toast.success(`${r.restaurantName || r.email} approved`);
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  // Repair path for restaurants whose owner login never got created (or whose
  // password was lost). Reuses the same server-side provisioning as creation.
  const fixOwnerLogin = async (r: IndexRow) => {
    const tid = r.tenantId || r.id;
    const email = (prompt(`Owner email for ${r.restaurantName || tid}:`, r.email || '') || '').trim();
    if (!email) return;
    const password = (prompt('Set a password for the owner (min 6 characters):', '') || '').trim();
    if (password.length < 6) { toast.error('Password kam se kam 6 characters ka hona chahiye'); return; }
    try {
      const { sb } = await import('@/lib/supabase');
      const { provisionRestaurantOwner } = await import('@/lib/platform.functions');

      const payload = { data: { tenantId: tid, email, password, displayName: r.restaurantName || email } };
      try {
        await provisionRestaurantOwner(payload);
      } catch (first: any) {
        if (!/unauthor|authorization|jwt|token/i.test(first?.message ?? '')) throw first;
        await sb().auth.refreshSession();
        await provisionRestaurantOwner(payload);
      }
      await sb().from('pending_owners').upsert({ tenant_id: tid, email }, { onConflict: 'tenant_id' });
      toast.success(`✅ Owner login ready — ${email} ab sign in kar sakta hai`, { duration: 8000 });
      load();
    } catch (e: any) {
      const raw = e?.message ?? String(e);
      toast.error(/unauthor|authorization/i.test(raw)
        ? 'Super Admin session expire ho gayi — dobara sign in karein.'
        : raw);
    }
  };


  const revoke = async (r: IndexRow) => {
    if (!confirm(`Revoke access for ${r.restaurantName || r.email}?`)) return;
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        // Deactivate, never delete: the restaurant's orders, payments and
        // audit history must survive a billing dispute.
        const { error } = await sb().from('tenants')
          .update({ is_active: false }).eq('id', r.tenantId || r.id);
        if (error) throw error;
        toast.success('Revoked');
        load();
      } catch (e: any) { toast.error(e?.message || 'Revoke failed'); }
      return;
    }
    try {
      await updateDoc(doc(fbDb(), 'userIndex', r.id), { approved: false, restaurantApproved: false });
      toast.success('Revoked');
      load();
    } catch (e: any) { toast.error(e?.message); }
  };
  const togglePremiumTheme = async (r: IndexRow) => {
    const next = !r.premiumThemeAllowed;
    const tid = r.tenantId || r.id;
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        const { data: cur } = await sb().from('tenant_settings')
          .select('settings').eq('tenant_id', tid)
          .eq('branch_id', '00000000-0000-0000-0000-000000000000').maybeSingle();
        const merged = {
          ...((cur?.settings as any) ?? {}),
          premiumThemeAllowed: next,
          ...(next ? {} : { premiumThemeEnabled: false }),
        };
        const { error } = await sb().from('tenant_settings').upsert(
          { tenant_id: tid, branch_id: '00000000-0000-0000-0000-000000000000', settings: merged },
          { onConflict: 'tenant_id,branch_id' });
        if (error) throw error;
        toast.success(next
          ? `👑 Premium UI allotted to ${r.restaurantName || r.email}`
          : `Premium UI revoked from ${r.restaurantName || r.email}`);
        load();
      } catch (e: any) { toast.error(e?.message || 'Toggle failed'); }
      return;
    }
    try {
      await updateDoc(doc(fbDb(), 'userIndex', r.id), { premiumThemeAllowed: next });
      // Mirror to tenant settings so restaurant app reads it via cached settings
      try {
        const sRef = doc(fbDb(), 'tenants', tid, 'meta', 'settings');
        const sSnap = await getDoc(sRef);
        if (sSnap.exists()) {
          await updateDoc(sRef, { premiumThemeAllowed: next, ...(next ? {} : { premiumThemeEnabled: false }) });
        } else {
          await setDoc(sRef, { premiumThemeAllowed: next }, { merge: true });
        }
      } catch (e) { console.warn('mirror premium theme failed', e); }
      toast.success(next ? `👑 Premium UI allotted to ${r.restaurantName || r.email}` : `Premium UI revoked from ${r.restaurantName || r.email}`);
      load();
    } catch (e: any) { toast.error(e?.message || 'Toggle failed'); }
  };


  const remove = async (r: IndexRow) => {
    const name = r.restaurantName || r.email || r.id;
    if (!confirm(`DELETE ${name}?\n\nThis will PERMANENTLY purge:\n• userIndex entry\n• ALL invoices, payments, devices\n• ALL orders, menu, customers, branches\n\n(the Firebase Auth user must be deleted separately)`)) return;
    if (!confirm(`Last warning! "${name}" — all data will be wiped. Continue?`)) return;
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        // One statement, not 34. Every child table declares
        // `on delete cascade` against tenants, so Postgres removes the whole
        // restaurant atomically — no half-purged tenant if the connection
        // drops midway, which the Firestore loop below could easily leave.
        const { error } = await sb().from('tenants').delete().eq('id', r.tenantId || r.id);
        if (error) throw error;
        toast.success(`Purged ${name} — tenant and all related records deleted`);
        load();
      } catch (e: any) { toast.error(e?.message || 'Delete failed'); }
      return;
    }
    try {
      const tid = r.tenantId || r.id;
      // Sub-collections to purge under tenants/{tid}/
      const subCols = [
        'invoices', 'payments', 'devices', 'orders', 'menuItems', 'categories',
        'customers', 'tables', 'floors', 'kitchens', 'waiters', 'riders',
        'branches', 'inventory', 'stockLogs', 'employees', 'attendance',
        'leaves', 'payslips', 'advances', 'transactions', 'parties', 'ledger',
        'dailyCashCloses', 'receivingEntries', 'marketingContacts', 'recipes',
        'wastages', 'creditPayments', 'promoCodes', 'paymentAccounts',
        'auditLogs', 'messages', 'serviceCalls',
      ];
      let purged = 0;
      for (const c of subCols) {
        try {
          const snap = await getDocs(collection(fbDb(), 'tenants', tid, c));
          for (const d of snap.docs) {
            await deleteDoc(d.ref);
            purged++;
          }
        } catch {}
      }
      // Root tenant doc + userIndex
      try { await deleteDoc(doc(fbDb(), 'tenants', tid)); } catch {}
      await deleteDoc(doc(fbDb(), 'userIndex', r.id));
      toast.success(`Purged ${name} — ${purged} sub-docs deleted`);
      load();
    } catch (e: any) { toast.error(e?.message || 'Delete failed'); }
  };

  const approveDevice = async (d: DeviceRow) => {
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        const { error } = await sb().from('devices')
          .update({ approved: true, approved_at: new Date().toISOString() })
          .eq('id', d.deviceId);
        if (error) throw error;
        toast.success('Device approved — the ledger PDF is downloading');
        generateSuperAdminDeviceLedger(d, currentEmail);
        load();
      } catch (e: any) { toast.error(e?.message || 'Approve failed'); }
      return;
    }
    toast.error('Sign in to the cloud to approve devices');
  };

  const rejectDevice = async (d: DeviceRow) => {
    if (!confirm(`Reject device "${d.deviceName || d.deviceId}"?`)) return;
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        const { error } = await sb().from('devices').delete().eq('id', d.deviceId);
        if (error) throw error;
        toast.success('Device removed');
        load();
      } catch (e: any) { toast.error(e?.message || 'Remove failed'); }
      return;
    }
    toast.error('Sign in to the cloud to remove devices');
  };

  // ===== BULK DELETE =====
  const bulkDeleteRestaurants = async () => {
    const ids = Array.from(selectedR);
    if (!ids.length) return toast.error('No restaurant selected');

    // Build the list of sub-collections to purge based on scope
    let subCols: string[] = [];
    if (cleanupScope === 'full') {
      subCols = [
        'invoices', 'payments', 'devices', 'orders', 'menuItems', 'categories',
        'customers', 'tables', 'floors', 'kitchens', 'waiters', 'riders',
        'branches', 'inventory', 'stockLogs', 'employees', 'attendance',
        'leaves', 'payslips', 'advances', 'transactions', 'parties', 'ledger',
        'dailyCashCloses', 'receivingEntries', 'marketingContacts', 'recipes',
        'wastages', 'creditPayments', 'promoCodes', 'paymentAccounts',
        'auditLogs', 'messages', 'serviceCalls',
      ];
    } else {
      // modules mode — expand selected groups into actual sub-collection names
      const expanded = new Set<string>();
      Array.from(selectedModules).forEach(m => {
        (MODULE_GROUPS[m] || [m]).forEach(c => expanded.add(c));
      });
      subCols = Array.from(expanded);
      if (!subCols.length) return toast.error('No module selected');
    }

    const names = ids.map(id => {
      const r = rows.find(x => x.id === id);
      return r?.restaurantName || r?.email || id.slice(0, 8);
    }).slice(0, 5).join(', ');

    const scopeLabel = cleanupScope === 'full'
      ? 'PURE restaurant (userIndex + saara data wipe)'
      : `selected modules only: ${subCols.join(', ')}`;
    if (!confirm(`CLEAN ${ids.length} restaurant(s)?\n\n${names}${ids.length > 5 ? '…' : ''}\n\nScope: ${scopeLabel}`)) return;
    if (cleanupScope === 'full' && !confirm(`LAST WARNING — all data for ${ids.length} restaurants will be wiped. Continue?`)) return;

    let ok = 0, fail = 0, purged = 0;
    for (const id of ids) {
      try {
        const tid = id;
        for (const c of subCols) {
          try {
            const snap = await getDocs(collection(fbDb(), 'tenants', tid, c));
            for (const d of snap.docs) { await deleteDoc(d.ref); purged++; }
          } catch {}
        }
        if (cleanupScope === 'full') {
          try { await deleteDoc(doc(fbDb(), 'tenants', tid)); } catch {}
          await deleteDoc(doc(fbDb(), 'userIndex', id));
        }
        ok++;
      } catch (e) { fail++; console.warn('bulk-clean restaurant', id, e); }
    }
    const verb = cleanupScope === 'full' ? 'Deleted' : 'Cleaned';
    toast.success(`${verb} ${ok}/${ids.length} restaurants · ${purged} docs purged${fail ? ` · ${fail} failed` : ''}`);
    clearSelection();
    setBulkMode(false);
    load();
  };

  const bulkDeleteDevices = async () => {
    const keys = Array.from(selectedD);
    if (!keys.length) return toast.error('No device selected');
    if (!confirm(`DELETE ${keys.length} device(s)?\n\nThey will be unapproved and removed. Restaurant data stays safe.`)) return;
    let ok = 0, fail = 0;
    for (const k of keys) {
      const [tid, did] = k.split('|');
      try {
        const { sb } = await import('@/lib/supabase');
        const { error } = await sb().from('devices').delete().eq('id', did);
        if (error) throw error;
        ok++;
      } catch (e) { fail++; console.warn('bulk-del device', k, e); }
    }
    toast.success(`Deleted ${ok}/${keys.length} devices${fail ? ` · ${fail} failed` : ''}`);
    clearSelection();
    setBulkMode(false);
    load();
  };


  const toggleBlockDevice = async (d: DeviceRow) => {
    try {
      const { sb } = await import('@/lib/supabase');
      const { error } = await sb().from('devices').update({
        blocked: !d.blocked,
        blocked_at: !d.blocked ? new Date().toISOString() : null,
        // Blocking must also revoke sync rights straight away.
        ...(d.blocked ? {} : { approved: false }),
      }).eq('id', d.deviceId);
      if (error) throw error;
      toast.success(`Device ${d.blocked ? 'unblocked' : 'blocked'}`);
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  const setRestaurantPlan = async (r: IndexRow, planId: string) => {
    try {
      const { setTenantPlan } = await import('@/lib/superAdminSupabase');
      await setTenantPlan(r.id, planId);
      toast.success(`Plan set to ${getPlan(planId).name}`);
      load();
    } catch (e: any) { toast.error(e?.message ?? 'Could not change the plan'); }
  };


  const setCustomLimit = async (r: IndexRow, limit: number | null) => {
    try {
      const { sb } = await import('@/lib/supabase');
      const { error } = await sb().from('tenants')
        .update({ custom_device_limit: limit, updated_at: new Date().toISOString() })
        .eq('id', r.id);
      if (error) throw error;
      toast.success(limit ? `Custom limit set: ${limit}` : 'Custom limit removed');
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  const doLogout = async () => {
    // Ends the session on whichever backend the adapter is using, and clears
    // the local cache even if the network call fails — otherwise the UI would
    // keep showing a signed-in state that no longer exists.
    try { await authSignOut(); } catch { /* ignore */ }
    onLogout();
  };

  const visible = rows.filter(r =>
    !filter || (r.restaurantName || '').toLowerCase().includes(filter.toLowerCase())
            || (r.email || '').toLowerCase().includes(filter.toLowerCase())
  );
  const pending = visible.filter(r => !r.approved);
  const approved = visible.filter(r => r.approved);

  const visibleDevices = devices.filter(d =>
    !filter || (d.restaurantName || '').toLowerCase().includes(filter.toLowerCase())
            || (d.deviceName || '').toLowerCase().includes(filter.toLowerCase())
  );
  const pendingDev = visibleDevices.filter(d => !d.approved);
  const approvedDev = visibleDevices.filter(d => d.approved);

  const totalPendingR = rows.filter(r => !r.approved).length;
  const totalApprovedR = rows.filter(r => r.approved).length;
  const totalPendingD = devices.filter(d => !d.approved).length;
  const totalApprovedD = devices.filter(d => d.approved).length;

  return (
    <div className="admin-shell min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      {/* Header bar */}
      <div className="admin-header border-b border-border/60 bg-card/40 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl flex items-center justify-center shadow-md overflow-hidden" style={{ background: '#3c096c' }}>
              <img src={dtLogo} alt="Digital Target" className="h-9 w-9 object-contain" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold leading-tight">Super Admin Console</h1>
              <p className="text-[11px] opacity-80 flex items-center gap-1.5">
                <Shield className="h-3 w-3" /> DT POS · by Digital Target
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <AdminBgToggle />
            <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
            <Button variant="outline" size="sm" onClick={doLogout}><LogOut className="h-4 w-4 mr-1" />Logout</Button>
          </div>
        </div>
      </div>


      <div className="max-w-[1600px] mx-auto p-4 sm:p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={<Store className="h-4 w-4" />} label="Pending Restaurants" value={totalPendingR} tone="amber" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Approved Restaurants" value={totalApprovedR} tone="green" />
          <StatCard icon={<Smartphone className="h-4 w-4" />} label="Pending Devices" value={totalPendingD} tone="amber" />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Approved Devices" value={totalApprovedD} tone="green" />
        </div>

        {/* Tabs + search — responsive scroll strip (redesign v1) */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] items-center gap-3 mb-5">
          <div className="min-w-0 -mx-1 px-1 overflow-x-auto pos-scrollbar">
            <div className="inline-flex gap-1 p-1 bg-muted/60 rounded-full border border-border/60 whitespace-nowrap">
              {([
                { id: 'restaurants', label: 'Restaurants', icon: <Store className="h-4 w-4" />, badge: totalPendingR },
                { id: 'clients', label: 'Clients', icon: <Receipt className="h-4 w-4" /> },
                { id: 'messages', label: 'Messages', icon: <MessageCircle className="h-4 w-4" /> },
                { id: 'reports', label: 'Reports & Ledger', icon: <Receipt className="h-4 w-4" /> },
                { id: 'packages', label: 'Packages', icon: <Package className="h-4 w-4" /> },
                { id: 'plans', label: 'Plans', icon: <Package className="h-4 w-4" /> },
                { id: 'customerApps', label: 'Customer Apps', icon: <Smartphone className="h-4 w-4" /> },
                { id: 'devices', label: 'Devices', icon: <Smartphone className="h-4 w-4" />, badge: totalPendingD },
                { id: 'map', label: 'Live Map', icon: <MapPin className="h-4 w-4" /> },
                { id: 'team', label: 'Team', icon: <Users className="h-4 w-4" /> },
                { id: 'monitor', label: 'Monitor', icon: <Wifi className="h-4 w-4" /> },
                { id: 'releases', label: 'Releases', icon: <Sparkles className="h-4 w-4" /> },
                ...(currentRole === 'owner'
                  ? [{ id: 'cleanup', label: 'Cleanup', icon: <Trash2 className="h-4 w-4" /> }]
                  : []),
              ] as Array<{ id: any; label: string; icon: ReactNode; badge?: number }>).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-3.5 py-1.5 text-sm font-semibold rounded-full flex items-center gap-1.5 transition-smooth ${
                    tab === t.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-card'
                  }`}
                >
                  {t.icon}
                  <span className="hidden sm:inline">{t.label}</span>
                  {!!t.badge && t.badge > 0 && (
                    <span className="ml-0.5 num text-[10px] bg-status-warning text-status-warning-foreground rounded-full px-1.5 py-0.5">
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <Input
            placeholder="Search by name or email…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full lg:max-w-none"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tab === 'restaurants' ? (
          <>
            {/* Add New Restaurant */}
            <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm text-muted-foreground">
                Naya restaurant manually add karein — owner ko email + password de dein, woh foran login kar sakega.
              </div>
              <Button onClick={() => setShowCreate(s => !s)} className="bg-violet-600 hover:bg-violet-700 text-white">
                <Plus className="h-4 w-4 mr-1" />{showCreate ? 'Cancel' : 'Add New Restaurant'}
              </Button>
            </div>
            {showCreate && (
              <div className="mb-5 p-4 border-2 border-violet-500/30 bg-violet-500/5 rounded-lg space-y-3">
                <div className="font-bold text-violet-700 dark:text-violet-300 flex items-center gap-2">
                  <Store className="h-4 w-4" /> Create New Restaurant Account
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold">Restaurant Name *</label>
                    <Input value={newRest.name} onChange={e => setNewRest({ ...newRest, name: e.target.value })} placeholder="e.g. Al-Madina Restaurant" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold">Owner Email *</label>
                    <Input type="email" value={newRest.email} onChange={e => setNewRest({ ...newRest, email: e.target.value })} placeholder="owner@example.com" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold">Password * (min 6 chars)</label>
                    <Input type="text" value={newRest.password} onChange={e => setNewRest({ ...newRest, password: e.target.value })} placeholder="Owner ka login password" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold">Plan</label>
                    <select
                      value={newRest.plan}
                      onChange={e => setNewRest({ ...newRest, plan: e.target.value })}
                      className="h-10 w-full border rounded px-2 bg-card text-sm"
                    >
                      {PLAN_OPTIONS.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.deviceLimit === 0 ? '∞' : p.deviceLimit} devices)</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating}>Cancel</Button>
                  <Button onClick={createRestaurant} disabled={creating} className="bg-green-600 hover:bg-green-700 text-white">
                    {creating ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Creating…</> : <><CheckCircle2 className="h-4 w-4 mr-1" />Create & Approve</>}
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {/* v1.31.1 — this used to advertise one shared staff password.
                    * It was true: every restaurant this panel created opened with that
                    * password, and both live restaurants still did. sa_create_restaurant
                    * now generates a random one per restaurant and returns it once —
                    * there is no shared constant left to print here. */}
                  A one-time password is generated for the <b>admin</b> POS login and shown
                  once, after the restaurant is created. Write it down — it is not stored
                  anywhere readable, and the owner must change it at first sign-in.
                </div>
              </div>
            )}

            <BulkBar
              mode={bulkMode}
              setMode={(v) => { setBulkMode(v); if (!v) clearSelection(); }}
              count={selectedR.size}
              total={rows.length}
              onSelectAll={() => setSelectedR(new Set(rows.map(r => r.id)))}
              onClear={clearSelection}
              onDelete={bulkDeleteRestaurants}
              kind="restaurants"
              scope={cleanupScope}
              setScope={setCleanupScope}
              selectedModules={selectedModules}
              toggleModule={toggleModule}
            />


            <Section title={`Pending Approval (${pending.length})`} accent="text-amber-500">
              {pending.length === 0 && <Empty>Koi pending request nahi</Empty>}
              {pending.map(r => (
                <RestaurantRow key={r.id} r={r}
                  selectable={bulkMode}
                  checked={selectedR.has(r.id)}
                  onToggle={() => toggleR(r.id)}>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approve(r)}>
                    <CheckCircle2 className="h-4 w-4 mr-1" />Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                    <Trash2 className="h-4 w-4 mr-1" />Reject
                  </Button>
                </RestaurantRow>
              ))}
            </Section>


            <Section title={`Approved Restaurants (${approved.length})`} accent="text-green-600">
              {approved.length === 0 && <Empty>Abhi koi approved restaurant nahi</Empty>}
              {approved.map(r => {
                const usedDevices = devices.filter(d => d.tenantId === r.id && d.approved && !d.blocked).length;
                const limit = effectiveDeviceLimit(r.plan, r.customDeviceLimit);
                const limitLabel = limit === Infinity ? '∞' : String(limit);
                const plan = getPlan(r.plan);
                return (
                  <RestaurantRow key={r.id} r={r}
                    selectable={bulkMode}
                    checked={selectedR.has(r.id)}
                    onToggle={() => toggleR(r.id)}>

                    <div className="flex flex-col items-stretch gap-1 mr-2 min-w-[200px]">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] uppercase font-bold text-muted-foreground">Plan:</span>
                        <select
                          value={r.plan || 'trial'}
                          onChange={(e) => setRestaurantPlan(r, e.target.value)}
                          className="h-7 text-xs border rounded px-1 bg-card flex-1"
                        >
                          {PLAN_OPTIONS.map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.deviceLimit === 0 ? '∞' : p.deviceLimit})</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-bold ${usedDevices >= limit ? 'text-red-500' : 'text-muted-foreground'}`}>
                          📱 {usedDevices}/{limitLabel}
                        </span>
                        <input
                          type="number"
                          min={0}
                          placeholder="Custom"
                          defaultValue={r.customDeviceLimit || ''}
                          onBlur={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!e.target.value) setCustomLimit(r, null);
                            else if (v > 0 && v !== r.customDeviceLimit) setCustomLimit(r, v);
                          }}
                          className="h-6 w-16 text-[10px] border rounded px-1 bg-card"
                          title="Custom device limit (overrides plan)"
                        />
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="border-sky-500/40 text-sky-600 hover:bg-sky-500/10" onClick={() => setDevicesFor(r)}>
                      <Smartphone className="h-4 w-4 mr-1" />
                      Devices
                      <span className="ml-1 text-[9px] bg-sky-500 text-white rounded-full px-1.5 font-bold">
                        {usedDevices}/{limitLabel}
                      </span>
                    </Button>
                    <Button size="sm" variant="outline" className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10" onClick={() => setBillingFor(r)}>
                      <Receipt className="h-4 w-4 mr-1" />
                      Billing
                    </Button>
                    <Button size="sm" variant="outline" className="border-violet-500/40 text-violet-600 hover:bg-violet-500/10" onClick={() => setFeaturesFor(r)}>
                      <Shield className="h-4 w-4 mr-1" />
                      Features
                      {r.featureOverrides && Object.keys(r.featureOverrides).length > 0 && (
                        <span className="ml-1 text-[9px] bg-amber-500 text-white rounded-full px-1.5 font-bold">
                          {Object.keys(r.featureOverrides).length}
                        </span>
                      )}
                    </Button>
                    <Button size="sm" variant="outline" className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10" onClick={() => setAgreementFor(r)}>
                      <FileSignature className="h-4 w-4 mr-1" />
                      Agreement
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={r.premiumThemeAllowed
                        ? "border-fuchsia-500 bg-fuchsia-500/15 text-fuchsia-700 hover:bg-fuchsia-500/25 font-semibold"
                        : "border-fuchsia-500/40 text-fuchsia-600 hover:bg-fuchsia-500/10"}
                      onClick={() => togglePremiumTheme(r)}
                      title="VINCE Premium UI (allot/revoke)"
                    >
                      👑 Premium UI{r.premiumThemeAllowed ? ' ✓' : ''}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => fixOwnerLogin(r)} title="Owner ka login banayein / password reset karein">
                      <KeyRound className="h-4 w-4 mr-1" />Fix Owner Login
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => revoke(r)}>
                      <XCircle className="h-4 w-4 mr-1" />Revoke
                    </Button>

                    <Button size="sm" variant="destructive" onClick={() => remove(r)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </RestaurantRow>
                );
              })}
            </Section>
          </>
        ) : tab === 'clients' ? (
          <ClientsTab rows={approved} devices={devices} restaurants={restaurants} onOpen={setBillingFor} />
        ) : tab === 'messages' ? (
          <SuperAdminMessages clients={approved.map(r => ({
            tenantId: r.id,
            name: r.restaurantName || r.email || r.id,
            email: r.email,
            plan: r.plan,
          }))} />
        ) : tab === 'reports' ? (
          <SuperAdminReports clients={approved.map(r => ({
            tenantId: r.id,
            name: r.restaurantName || r.email || r.id,
            email: r.email,
            plan: r.plan,
            planExpiryAt: r.planExpiryAt,
          }))} />
        ) : tab === 'customerApps' ? (
          <CustomerAppsManager
            restaurants={rows.map(r => ({
              tenantId: r.tenantId || r.id,
              name: r.restaurantName || r.email || (r.tenantId || r.id),
            }))}
          />
        ) : tab === 'packages' ? (
          <div className="space-y-4">
            <BrandSignaturePanel />
            <PackagesManager />
          </div>
        ) : tab === 'plans' ? (
          <PlansManager />
        ) : tab === 'map' ? (
          <SuperAdminLiveMap devices={devices} restaurants={restaurants} />
        ) : tab === 'team' ? (
          <TeamPanel currentEmail={currentEmail} currentRole={currentRole} />
        ) : tab === 'releases' ? (
          <ReleaseManagerPage />
        ) : tab === 'monitor' ? (
          <SuperAdminMonitoringPanel devices={devices} restaurants={approved} />
        ) : tab === 'cleanup' ? (
          <SuperAdminCleanupPanel />
        ) : (
          <>
            <BulkBar
              mode={bulkMode}
              setMode={(v) => { setBulkMode(v); if (!v) clearSelection(); }}
              count={selectedD.size}
              total={visibleDevices.length}
              onSelectAll={() => setSelectedD(new Set(visibleDevices.map(d => `${d.tenantId}|${d.deviceId}`)))}
              onClear={clearSelection}
              onDelete={bulkDeleteDevices}
              kind="devices"
            />

            <Section title={`Pending Devices (${pendingDev.length})`} accent="text-amber-500">
              {pendingDev.length === 0 && <Empty>Koi pending device request nahi</Empty>}
              {pendingDev.map(d => {
                const k = `${d.tenantId}|${d.deviceId}`;
                return (
                  <DeviceRowView key={k} d={d}
                    selectable={bulkMode}
                    checked={selectedD.has(k)}
                    onToggle={() => toggleD(k)}>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => approveDevice(d)}>
                      <CheckCircle2 className="h-4 w-4 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => rejectDevice(d)}>
                      <Trash2 className="h-4 w-4 mr-1" />Reject
                    </Button>
                  </DeviceRowView>
                );
              })}
            </Section>

            <Section title={`Approved Devices (${approvedDev.length})`} accent="text-green-600">
              {approvedDev.length === 0 && <Empty>Abhi koi approved device nahi</Empty>}
              {approvedDev.map(d => {
                const k = `${d.tenantId}|${d.deviceId}`;
                return (
                  <DeviceRowView key={k} d={d}
                    selectable={bulkMode}
                    checked={selectedD.has(k)}
                    onToggle={() => toggleD(k)}>
                    {d.blocked ? (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => toggleBlockDevice(d)}>
                        <CheckCircle2 className="h-4 w-4 mr-1" />Unblock
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="border-red-500/40 text-red-600 hover:bg-red-500/10" onClick={() => toggleBlockDevice(d)}>
                        <Shield className="h-4 w-4 mr-1" />Block
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => rejectDevice(d)}>
                      <Trash2 className="h-4 w-4 mr-1" />Remove
                    </Button>
                  </DeviceRowView>
                );
              })}
            </Section>
          </>
        )}

        <div className="mt-10 max-w-md mx-auto">
          <PoweredByBrand />
        </div>
      </div>

      {featuresFor && (
        <FeatureControlDialog
          tenantId={featuresFor.id}
          restaurantName={featuresFor.restaurantName || featuresFor.email || featuresFor.id}
          planId={featuresFor.plan || 'trial'}
          overrides={featuresFor.featureOverrides || {}}
          onClose={() => setFeaturesFor(null)}
          onSaved={load}
        />
      )}
      {billingFor && (
        <ClientBillingDialog
          tenantId={billingFor.id}
          restaurantName={billingFor.restaurantName || billingFor.email || billingFor.id}
          email={billingFor.email}
          planId={billingFor.plan || 'trial'}
          planExpiryAt={billingFor.planExpiryAt}
          onClose={() => setBillingFor(null)}
          onSaved={load}
        />
      )}
      <ClientAgreementDialog
        open={!!agreementFor}
        onClose={() => setAgreementFor(null)}
        restaurant={agreementFor}
        devices={agreementFor ? devices.filter(d => d.tenantId === agreementFor.id) : []}
      />
      {devicesFor && (
        <RestaurantDevicesDialog
          restaurant={devicesFor}
          devices={devices.filter(d => d.tenantId === devicesFor.id)}
          onClose={() => setDevicesFor(null)}
          onApprove={approveDevice}
          onReject={rejectDevice}
          onToggleBlock={toggleBlockDevice}
          onSetCustomLimit={(limit) => setCustomLimit(devicesFor, limit)}
        />
      )}
    </div>
  );
}

function ClientsTab({ rows, devices, restaurants, onOpen }: { rows: IndexRow[]; devices: DeviceRow[]; restaurants: RestaurantLocation[]; onOpen: (r: IndexRow) => void }) {
  const sorted = [...rows].sort((a, b) => {
    const ea = tsToDate(a.planExpiryAt)?.getTime() || Infinity;
    const eb = tsToDate(b.planExpiryAt)?.getTime() || Infinity;
    return ea - eb;
  });
  const totalActive = rows.length;
  const expiredCount = rows.filter(r => isExpired(r.planExpiryAt)).length;
  const dueSoon = rows.filter(r => {
    const d = daysUntil(r.planExpiryAt);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  const restById: Record<string, RestaurantLocation | undefined> = {};
  restaurants.forEach(rr => { restById[rr.tenantId] = rr; });
  const buildExportRows = () => sorted.map(r => {
    const loc = restById[r.id];
    const exp = tsToDate(r.planExpiryAt);
    const days = daysUntil(r.planExpiryAt);
    const usedDevices = devices.filter(d => d.tenantId === r.id && d.approved && !d.blocked).length;
    return {
      restaurantName: r.restaurantName || '(no name)',
      ownerEmail: r.email || '',
      phone: loc?.phone || '',
      city: loc?.city || '',
      address: loc?.address || '',
      plan: getPlan(r.plan).name,
      planExpiry: exp ? exp.toLocaleDateString() : '—',
      daysLeft: exp ? (isExpired(r.planExpiryAt) ? `Expired ${Math.abs(days || 0)}d` : `${days}d`) : '—',
      activeDevices: usedDevices,
      tenantId: r.id,
    };
  });
  const onExcel = () => { if (sorted.length === 0) { toast.error('No clients'); return; } exportClientsToExcel(buildExportRows()); toast.success('Excel downloaded'); };
  const onCSV   = () => { if (sorted.length === 0) { toast.error('No clients'); return; } exportClientsToCSV(buildExportRows());   toast.success('CSV downloaded'); };
  const onPDF   = () => { if (sorted.length === 0) { toast.error('No clients'); return; } exportClientsToPDF(buildExportRows());   toast.success('PDF downloaded'); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground">Active Clients</div><div className="text-xl font-extrabold">{totalActive}</div></div>
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />Due in 7 days</div><div className="text-xl font-extrabold text-amber-600">{dueSoon}</div></div>
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-500" />Expired</div><div className="text-xl font-extrabold text-red-600">{expiredCount}</div></div>
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground">No Expiry Set</div><div className="text-xl font-extrabold text-muted-foreground">{rows.filter(r => !r.planExpiryAt).length}</div></div>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-muted/40 border rounded-lg p-2.5">
        <div className="text-[10px] uppercase font-bold text-muted-foreground mr-2">Export Client List:</div>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onExcel}>
          <Download className="h-3.5 w-3.5 mr-1" /> Excel (.xlsx)
        </Button>
        <Button size="sm" variant="outline" onClick={onCSV}>
          <Download className="h-3.5 w-3.5 mr-1" /> CSV
        </Button>
        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={onPDF}>
          <Download className="h-3.5 w-3.5 mr-1" /> PDF
        </Button>
        <span className="text-[10px] text-muted-foreground ml-auto">
          Name · Email · Phone · City · Address · Plan · Expiry · Devices
        </span>
      </div>

      {/* Manually added marketing contacts (Digital Target marketing list) */}
      <MarketingContactsPanel />

      <div className="text-[10px] uppercase font-bold text-muted-foreground px-1">Active Restaurant Clients (sorted by expiry — urgent first)</div>

      {sorted.length === 0 && <div className="text-xs text-muted-foreground italic px-4 py-6 bg-muted/30 rounded-lg border border-dashed text-center">No approved clients yet</div>}

      {sorted.map(r => {
        const exp = tsToDate(r.planExpiryAt);
        const days = daysUntil(r.planExpiryAt);
        const expired = isExpired(r.planExpiryAt);
        const usedDevices = devices.filter(d => d.tenantId === r.id && d.approved && !d.blocked).length;
        const plan = getPlan(r.plan);
        const tone = expired ? 'red' : (days !== null && days <= 7 ? 'amber' : (exp ? 'green' : 'gray'));
        const toneCls: any = {
          red: 'border-red-500/40 bg-red-500/5',
          amber: 'border-amber-500/40 bg-amber-500/5',
          green: 'border-green-500/30',
          gray: 'border-border',
        };
        return (
          <div key={r.id} className={`border-2 rounded-xl p-3 flex items-center justify-between gap-3 hover:shadow-sm transition ${toneCls[tone]}`}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-10 w-10 rounded-lg bg-gradient-gold flex items-center justify-center font-bold text-primary shrink-0">
                {(r.restaurantName || r.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold truncate flex items-center gap-2">
                  {r.restaurantName || '(no name)'}
                  <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${plan.color} border border-current/30 bg-current/10`}>{plan.name}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{r.email}</div>
                <div className="flex flex-wrap gap-2 mt-1 text-[10px]">
                  <span className="text-muted-foreground">📱 {usedDevices} active</span>
                  {exp ? (
                    <span className={`font-bold ${expired ? 'text-red-600' : (days !== null && days <= 7 ? 'text-amber-600' : 'text-green-600')}`}>
                      <Calendar className="h-3 w-3 inline mr-0.5" />
                      {expired ? `Expired ${Math.abs(days || 0)}d ago` : `${days}d left (${exp.toLocaleDateString()})`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">No expiry set</span>
                  )}
                </div>
              </div>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0" onClick={() => onOpen(r)}>
              <Receipt className="h-4 w-4 mr-1" /> Manage Billing
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function SuperAdminLiveMap({ devices, restaurants }: { devices: DeviceRow[]; restaurants: RestaurantLocation[] }) {
  // Build quick lookup from tenantId → restaurant location (for GPS fallback)
  const restByTid = new Map<string, RestaurantLocation>();
  restaurants.forEach(r => restByTid.set(r.tenantId, r));

  // Devices: use own GPS if present, otherwise fallback to restaurant GPS so
  // green/gray dot still appears on the map even when device GPS was skipped.
  // ===== v1.26.9 — a pin must not claim a position the device never sent =====
  //
  // A device with no location of its own was silently drawn at the RESTAURANT's
  // coordinates, with nothing in the popup saying so. That is not a small
  // cosmetic issue: it shows a device sitting at an address it never reported,
  // which is exactly the kind of thing someone would act on. The fallback is
  // still useful — it puts the device roughly where it probably is — but it
  // has to be labelled as an assumption rather than a reading.
  //
  // Browser geolocation is network/wifi-derived indoors and is accurate to
  // tens or hundreds of metres, so even a real reading is reported as
  // approximate, never as GPS.
  const mapped = devices
    .map(d => {
      const own = typeof d.lat === 'number' && typeof d.lng === 'number';
      let lat = own ? d.lat : undefined;
      let lng = own ? d.lng : undefined;
      let positionSource: 'device' | 'restaurant' = 'device';
      if (!own) {
        const r = restByTid.get(d.tenantId);
        if (r) { lat = r.lat; lng = r.lng; positionSource = 'restaurant'; }
      }
      return (lat != null && lng != null) ? { ...d, lat, lng, positionSource } : null;
    })
    .filter((d) => d != null) as (DeviceRow & { positionSource: 'device' | 'restaurant' })[];
  const onlineCount = mapped.filter(d => isOnline(tsToMs(d.lastActiveAt))).length;
  const deviceMarkers: MapMarker[] = mapped.map((d, idx) => {
    const on = isOnline(tsToMs(d.lastActiveAt));
    const last = tsToMs(d.lastActiveAt);
    // Slight jitter so multiple devices at same restaurant GPS don't overlap exactly
    const jitter = (i: number) => (((i * 37) % 11) - 5) * 0.00015;
    return {
      id: 'dev-' + d.tenantId + d.deviceId, lat: d.lat! + jitter(idx), lng: d.lng! + jitter(idx + 7),
      title: d.deviceName || d.deviceId,
      // Blocked reads as a state the operator must notice, not as "offline".
      color: d.blocked ? 'red' : on ? 'green' : 'gray',
      popupHtml: `<div style="font-family:system-ui;font-size:12px;min-width:240px">
        <div style="font-weight:700;font-size:13px">📱 ${escape(d.restaurantName || d.tenantId)}</div>
        <div style="color:#555;margin-bottom:4px">${escape(d.deviceName || d.browser || '')}</div>
        ${d.branchName ? `<div>🏬 Branch: <strong>${escape(d.branchName)}</strong></div>` : ''}
        <div>Status: <strong style="color:${on ? '#16a34a' : '#6b7280'}">${on ? '🟢 Online' : '⚪ Offline'}</strong></div>
        <div>Approval: <strong style="color:${d.blocked ? '#dc2626' : d.approved ? '#16a34a' : '#d97706'}">${d.blocked ? '⛔ Blocked' : d.approved ? '✔ Approved' : '⏳ Pending'}</strong></div>
        ${d.ip ? `<div>📡 ${escape(d.ip)} <span style="color:#999">(network metadata, not identity)</span></div>` : ''}
        ${(d.city || d.country) ? `<div>📍 ${escape([d.city, d.country].filter(Boolean).join(', '))}</div>` : ''}
        ${d.positionSource === 'restaurant'
          ? `<div style="margin-top:5px;padding:4px 6px;background:#fef3c7;border-radius:4px;color:#92400e">
               ⚠ This device reported no location. The pin shows the <strong>restaurant's</strong> address, not the device's position.
             </div>`
          : `<div style="margin-top:5px;color:#666">
               Approximate location${d.accuracyM ? ` · &plusmn;${Math.round(d.accuracyM)} m` : ''}
               <span style="color:#999">(browser/network derived, not GPS)</span>
             </div>`}
        ${last ? `<div style="color:#666;margin-top:3px">Last: ${new Date(last).toLocaleString()}</div>` : ''}
      </div>`,
    };
  });

  // ===== v1.27.1 — a restaurant is "online" when one of ITS devices is =====
  //
  // The map already knew which devices were online and which restaurant each
  // belonged to, but never joined the two, so every restaurant pin was the same
  // violet whether the shop was trading or had been dark for a week. That is
  // the one thing a monitoring screen exists to show.
  const statusByTenant = new Map<string, { online: number; total: number; lastSeen: number }>();
  for (const d of devices) {
    const cur = statusByTenant.get(d.tenantId) ?? { online: 0, total: 0, lastSeen: 0 };
    cur.total += 1;
    const seen = tsToMs(d.lastActiveAt);
    if (isOnline(seen)) cur.online += 1;
    if (seen > cur.lastSeen) cur.lastSeen = seen;
    statusByTenant.set(d.tenantId, cur);
  }
  const statusOf = (tid: string) => statusByTenant.get(tid) ?? { online: 0, total: 0, lastSeen: 0 };

  const liveRestaurants = restaurants
    .map(r => ({ r, s: statusOf(r.tenantId) }))
    .sort((a, b) =>
      (b.s.online > 0 ? 1 : 0) - (a.s.online > 0 ? 1 : 0)
      || b.s.lastSeen - a.s.lastSeen
      || a.r.name.localeCompare(b.r.name));
  const onlineRestaurants = liveRestaurants.filter(x => x.s.online > 0).length;

  const restaurantMarkers: MapMarker[] = restaurants.map(r => {
    const planName = getPlan(r.plan).name;
    const st = statusOf(r.tenantId);
    const live = st.online > 0;
    // Green means trading right now. Grey means the shop is dark — an
    // always-green pin would make the whole screen meaningless.
    const ring = live ? '#16a34a' : '#94a3b8';
    const logoHtml = r.logo
      ? `<img src="${escape(r.logo)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'" />`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;background:linear-gradient(135deg,#7c3aed,#c026d3);color:#fff;font-weight:800">${escape((r.name || '?').charAt(0).toUpperCase())}</div>`;
    const iconHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;font-family:system-ui;pointer-events:auto">
        <div style="background:#fff;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;color:#0f172a;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;border:1px solid ${ring}55">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${ring};margin-right:4px;vertical-align:middle"></span>${escape(r.name)}
        </div>
        <div style="width:2px;height:4px;background:${ring}"></div>
        <div style="width:46px;height:46px;border-radius:50%;background:#fff;border:3px solid ${ring};box-shadow:0 4px 10px rgba(0,0,0,.35);overflow:hidden">${logoHtml}</div>
        <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid ${ring};margin-top:-1px"></div>
      </div>`;
    return {
      id: 'rest-' + r.tenantId, lat: r.lat, lng: r.lng,
      title: r.name,
      iconHtml,
      iconSize: [160, 90],
      iconAnchor: [80, 90],
      popupHtml: `<div style="font-family:system-ui;font-size:12px;min-width:240px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          ${r.logo ? `<img src="${escape(r.logo)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;border:1px solid #ddd" />` : ''}
          <div>
            <div style="font-weight:700;font-size:14px;color:#3c096c">🏪 ${escape(r.name)}</div>
            <div style="font-size:10px;color:#7c3aed;font-weight:600;text-transform:uppercase">${escape(planName)} Plan</div>
            <div style="font-size:11px;font-weight:700;color:${ring}">${live ? `🟢 Online — ${st.online} of ${st.total} device(s)` : st.total ? '⚪ Offline' : '⚪ No device yet'}</div>
          </div>
        </div>
        ${r.label ? `<div style="color:#555">${escape(r.label)}</div>` : ''}
        ${r.address ? `<div style="color:#666;margin-top:4px">📍 ${escape(r.address)}</div>` : ''}
        ${r.phone ? `<div style="color:#666">📞 ${escape(r.phone)}</div>` : ''}
        ${st.lastSeen ? `<div style="color:#666">🕒 Last seen ${escape(new Date(st.lastSeen).toLocaleString())}</div>` : ''}
        <div style="margin-top:4px;font-size:10px;color:#888">Tenant: ${escape(r.tenantId.slice(0, 10))}…</div>
      </div>`,
    } as MapMarker;
  });
  const markers = [...restaurantMarkers, ...deviceMarkers];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Store className="h-3 w-3 text-green-600"/>Restaurants Online</div><div className="text-xl font-extrabold text-green-600">{onlineRestaurants}<span className="text-sm font-semibold text-muted-foreground"> / {restaurants.length}</span></div></div>
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground">Devices on Map</div><div className="text-xl font-extrabold">{mapped.length}</div></div>
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Wifi className="h-3 w-3 text-green-600"/>Online Now</div><div className="text-xl font-extrabold text-green-600">{onlineCount}</div></div>
        <div className="bg-card border rounded-lg p-3"><div className="text-[10px] uppercase text-muted-foreground">Offline</div><div className="text-xl font-extrabold">{mapped.length - onlineCount}</div></div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground px-1">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-600" /> Restaurant trading now</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> Restaurant dark</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Device online</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-gray-400" /> Device offline</span>
      </div>

      {/* Map and roster side by side. On a wall screen the roster is the thing
          that is actually read; the map answers "where" once you have picked a
          name out of it. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bg-card border rounded-xl p-2 overflow-hidden">
          <LeafletMap markers={markers} height={620} />
        </div>

        <div className="bg-card border rounded-xl flex flex-col overflow-hidden xl:h-[636px]">
          <div className="px-3 py-2 border-b flex items-center justify-between shrink-0">
            <div className="text-sm font-bold flex items-center gap-2">
              <Wifi className="h-4 w-4 text-green-600" /> Live Restaurants
            </div>
            <span className="text-[11px] font-semibold text-green-600">{onlineRestaurants} online</span>
          </div>

          <div className="overflow-y-auto pos-scrollbar divide-y">
            {liveRestaurants.map(({ r, s: st }) => {
              const live = st.online > 0;
              return (
                <div key={r.tenantId} className={`px-3 py-2.5 flex items-start gap-2.5 ${live ? '' : 'opacity-60'}`}>
                  <div className={`mt-0.5 h-9 w-9 rounded-lg overflow-hidden border-2 shrink-0 ${live ? 'border-green-600' : 'border-slate-300'}`}>
                    {r.logo
                      ? <img src={r.logo} alt="" className="h-full w-full object-cover" />
                      : <div className="h-full w-full flex items-center justify-center text-xs font-extrabold bg-muted">
                          {(r.name || '?').charAt(0).toUpperCase()}
                        </div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${live ? 'bg-green-600' : 'bg-slate-400'}`} />
                      <span className="text-sm font-semibold truncate">{r.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[r.city, r.address].filter(Boolean).join(' · ') || r.label || 'No address saved'}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {getPlan(r.plan).name} · {st.total
                        ? `${st.online}/${st.total} device${st.total === 1 ? '' : 's'} online`
                        : 'no device yet'}
                      {st.lastSeen ? ` · seen ${new Date(st.lastSeen).toLocaleTimeString()}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}

            {liveRestaurants.length === 0 && (
              <div className="p-6 text-center text-xs text-muted-foreground">
                No restaurant has a saved location yet.
              </div>
            )}
          </div>
        </div>
      </div>
      {markers.length === 0 && (
        <div className="text-xs text-muted-foreground italic text-center bg-muted/30 rounded-lg p-4 border border-dashed">
          Abhi koi device aur koi restaurant location set nahi. Tenants Settings → Restaurant Physical Location set karein, ya devices login par browser GPS permission de.
        </div>
      )}
    </div>
  );
}

function escape(s: string) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!)); }

function StatCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'amber' | 'green' }) {
  const toneClasses = tone === 'amber'
    ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
    : 'text-green-600 bg-green-500/10 border-green-500/20';
  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
          <div className="text-2xl font-extrabold mt-1">{value}</div>
        </div>
        <div className={`h-9 w-9 rounded-lg border flex items-center justify-center ${toneClasses}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function BulkBar({
  mode, setMode, count, total, onSelectAll, onClear, onDelete, kind,
  scope, setScope, selectedModules, toggleModule,
}: {
  mode: boolean; setMode: (v: boolean) => void;
  count: number; total: number;
  onSelectAll: () => void; onClear: () => void; onDelete: () => void;
  kind: 'restaurants' | 'devices';
  scope?: 'full' | 'modules';
  setScope?: (s: 'full' | 'modules') => void;
  selectedModules?: Set<string>;
  toggleModule?: (m: string) => void;
}) {
  const showModules = mode && kind === 'restaurants' && scope === 'modules' && !!selectedModules && !!toggleModule;
  return (
    <div className={`mb-3 rounded-xl border p-3 ${mode ? 'bg-red-500/5 border-red-500/40' : 'bg-muted/30 border-border/60'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer text-xs font-bold">
            <input type="checkbox" checked={mode} onChange={(e) => setMode(e.target.checked)}
              className="h-4 w-4 accent-red-600" />
            Bulk Select / Cleanup Mode
          </label>
          {mode && (
            <span className="text-[11px] text-muted-foreground">
              ({count} of {total} {kind} selected)
            </span>
          )}
          {mode && kind === 'restaurants' && setScope && (
            <div className="flex items-center gap-1 text-[11px] bg-background border border-border/60 rounded-lg p-1">
              <button
                className={`px-2 py-0.5 rounded-md ${scope === 'modules' ? 'bg-amber-500/20 text-amber-700 font-bold' : 'text-muted-foreground'}`}
                onClick={() => setScope('modules')}
                type="button"
              >Clean Modules</button>
              <button
                className={`px-2 py-0.5 rounded-md ${scope === 'full' ? 'bg-red-500/20 text-red-700 font-bold' : 'text-muted-foreground'}`}
                onClick={() => setScope('full')}
                type="button"
              >Delete Fully</button>
            </div>
          )}
        </div>
        {mode && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onSelectAll}>Select All</Button>
            <Button size="sm" variant="outline" onClick={onClear} disabled={count === 0}>Clear</Button>
            <Button size="sm" variant="destructive" onClick={onDelete} disabled={count === 0}>
              <Trash2 className="h-4 w-4 mr-1" />
              {scope === 'full' || kind === 'devices' ? 'Delete Selected' : 'Clean Modules'} ({count})
            </Button>
          </div>
        )}
      </div>
      {showModules && (
        <div className="mt-3 pt-3 border-t border-red-500/20">
          <div className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
            Kin modules ko clean karna hai? (selected restaurants par apply hoga)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {Object.keys(MODULE_LABELS).map(m => {
              const checked = selectedModules!.has(m);
              return (
                <label key={m}
                  className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${checked ? 'bg-amber-500/15 border-amber-500/50 font-semibold' : 'bg-background border-border/60 hover:border-amber-500/40'}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleModule!(m)}
                    className="h-3.5 w-3.5 accent-amber-600" />
                  {MODULE_LABELS[m]}
                </label>
              );
            })}
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">
            Note: "Clean Modules" sirf checked data wipe karega — restaurant account, login aur baaki modules safe rahenge.
          </div>
        </div>
      )}
    </div>
  );
}


function Section({ title, accent, children }: any) {
  return (
    <div className="mb-6">
      <h2 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2 ${accent}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${accent === 'text-amber-500' ? 'bg-amber-500' : 'bg-green-600'}`} />
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function Empty({ children }: any) {
  return <div className="text-xs text-muted-foreground italic px-4 py-6 bg-muted/30 rounded-lg border border-dashed border-border/60 text-center">{children}</div>;
}
function RestaurantRow({ r, children, selectable, checked, onToggle }: {
  r: IndexRow; children: React.ReactNode;
  selectable?: boolean; checked?: boolean; onToggle?: () => void;
}) {
  const initial = (r.restaurantName || r.email || '?').charAt(0).toUpperCase();
  return (
    <div className={`flex items-center justify-between bg-card border rounded-xl p-4 gap-3 hover:border-primary/40 hover:shadow-sm transition-all ${checked ? 'border-red-500/60 bg-red-500/5' : 'border-border/60'}`}>
      <div className="flex items-center gap-3 min-w-0">
        {selectable && (
          <input type="checkbox" checked={!!checked} onChange={onToggle}
            className="h-5 w-5 accent-red-600 cursor-pointer shrink-0" />
        )}
        <div className="h-10 w-10 rounded-lg bg-gradient-gold flex items-center justify-center font-bold text-primary shrink-0">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="font-semibold truncate">{r.restaurantName || '(no name)'}</div>
          <div className="text-xs text-muted-foreground truncate">{r.email}</div>
          <div className="text-[10px] text-muted-foreground/70 font-mono truncate">uid: {r.id}</div>
          {/* v1.28.4 — the code the staff apps ask for, where the operator who
              hands it out is already looking. Click to copy. */}
          {r.workspaceCode && (
            <button
              type="button"
              title="Copy Workspace Code"
              onClick={(e) => {
                e.stopPropagation();
                void navigator.clipboard?.writeText(r.workspaceCode!);
                toast.success(`Workspace Code ${r.workspaceCode} copied`);
              }}
              className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-mono font-bold tracking-[0.2em] text-primary hover:underline"
            >
              <KeyRound className="h-3 w-3" /> {r.workspaceCode}
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-2 shrink-0">{children}</div>
    </div>
  );
}
function DeviceRowView({ d, children, selectable, checked, onToggle }: {
  d: DeviceRow; children: React.ReactNode;
  selectable?: boolean; checked?: boolean; onToggle?: () => void;
}) {
  const location = [d.city, d.region, d.country].filter(Boolean).join(', ');
  return (
    <div className={`bg-card border rounded-xl p-4 hover:border-primary/40 hover:shadow-sm transition-all ${checked ? 'border-red-500/60 bg-red-500/5' : 'border-border/60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {selectable && (
            <input type="checkbox" checked={!!checked} onChange={onToggle}
              className="h-5 w-5 mt-1 accent-red-600 cursor-pointer shrink-0" />
          )}
          <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Smartphone className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate flex items-center gap-1.5">
              {d.deviceType === 'mobile' ? '📱' : d.deviceType === 'tablet' ? '📲' : '🖥️'}
              {d.hostname || d.deviceName || `${d.browser || '?'} / ${d.os || '?'}`}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {d.restaurantName}
              {d.osUser && <span className="ml-2">👤 {d.osUser}</span>}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.branchName && <Chip tone="blue">🏬 {d.branchName}</Chip>}
              {/* v1.26.8 — one physical machine can now be one device even when
                  staff open it in several browsers. Show that plainly, so a
                  single row covering three profiles is explained rather than
                  mysterious. */}
              {d.mergedProfiles && d.mergedProfiles.length > 0 && (
                <Chip tone="cyan">🔗 {d.mergedProfiles.length + 1} browser profiles · same machine</Chip>
              )}
              {d.deviceType && <Chip tone="violet">{d.deviceType === 'mobile' ? '📱 Mobile' : d.deviceType === 'tablet' ? '📲 Tablet' : '🖥️ PC / Laptop'}</Chip>}
              {d.platform && <Chip tone={d.platform === 'electron' ? 'green' : undefined}>{d.platform === 'electron' ? '⚡ Desktop App' : '🌐 Web Browser'}</Chip>}
              {d.browser && <Chip>🌐 {d.browser}{d.browserVersion ? ` ${d.browserVersion.split('.')[0]}` : ''}</Chip>}
              {d.os && <Chip>💻 {d.os}</Chip>}
              {d.appVersion && <Chip tone="violet">v{d.appVersion}</Chip>}
              {d.screen && <Chip>🖥️ {d.screen}</Chip>}
              {d.ip && <Chip tone="blue">📡 {d.ip}</Chip>}
              {location && <Chip tone="green">📍 {location}</Chip>}
              {d.isp && <Chip tone="amber">🏢 {d.isp}</Chip>}
              {d.connectionType && <Chip tone="cyan">📶 {d.connectionType.toUpperCase()}{d.downlinkMbps ? ` · ${d.downlinkMbps}Mbps` : ''}</Chip>}
              {(d.cpuCores || d.memoryGb) && <Chip>🧠 {d.cpuCores ? `${d.cpuCores} cores` : ''}{d.cpuCores && d.memoryGb ? ' · ' : ''}{d.memoryGb ? `${d.memoryGb}GB` : ''}</Chip>}
              {d.cpuModel && <Chip>⚙️ {d.cpuModel.split('@')[0].trim().slice(0, 32)}</Chip>}
              {d.macAddresses && d.macAddresses[0] && <Chip tone="amber">🆔 MAC {d.macAddresses[0]}</Chip>}
              {d.timezone && <Chip>🕐 {d.timezone}</Chip>}
              {typeof d.loginCount === 'number' && d.loginCount > 0 && <Chip tone="violet">🔑 {d.loginCount} logins</Chip>}
              {d.lastLoginAt && <Chip tone="green">🕘 Last login {new Date(d.lastLoginAt).toLocaleString()}</Chip>}
            </div>

            <div className="text-[10px] text-muted-foreground/70 font-mono truncate mt-2">
              device: {d.deviceId.slice(0, 12)}… · machine: {(d.hardwareId || '—').slice(0, 14)}… · tid: {d.tenantId.slice(0, 10)}…
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">{children}</div>
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'violet' | 'amber' | 'cyan' }) {
  const cls =
    tone === 'blue'   ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
    tone === 'green'  ? 'bg-green-500/10 text-green-600 border-green-500/20' :
    tone === 'violet' ? 'bg-violet-500/10 text-violet-600 border-violet-500/20' :
    tone === 'amber'  ? 'bg-amber-500/10 text-amber-700 border-amber-500/20' :
    tone === 'cyan'   ? 'bg-cyan-500/10 text-cyan-700 border-cyan-500/20' :
    'bg-muted text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {children}
    </span>
  );
}

function RestaurantDevicesDialog({
  restaurant, devices, onClose, onApprove, onReject, onToggleBlock, onSetCustomLimit,
}: {
  restaurant: IndexRow;
  devices: DeviceRow[];
  onClose: () => void;
  onApprove: (d: DeviceRow) => void;
  onReject: (d: DeviceRow) => void;
  onToggleBlock: (d: DeviceRow) => void;
  onSetCustomLimit: (limit: number | null) => void;
}) {
  const plan = getPlan(restaurant.plan);
  const limit = effectiveDeviceLimit(restaurant.plan, restaurant.customDeviceLimit);
  const limitLabel = limit === Infinity ? '∞' : String(limit);
  const used = devices.filter(d => d.approved && !d.blocked).length;
  const pending = devices.filter(d => !d.approved && !d.blocked);
  const approvedList = devices.filter(d => d.approved && !d.blocked);
  const blockedList = devices.filter(d => d.blocked);
  const isFull = limit !== Infinity && used >= limit;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b flex items-start justify-between gap-3 bg-gradient-to-r from-sky-500/10 to-transparent">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="h-5 w-5 text-sky-600" />
              <h2 className="text-lg font-extrabold truncate">{restaurant.restaurantName || restaurant.email}</h2>
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
              <span className={`font-bold ${plan.color}`}>{plan.name}</span>
              <span>·</span>
              <span className={isFull ? 'text-red-600 font-bold' : 'font-bold'}>{used}/{limitLabel} devices used</span>
              {restaurant.customDeviceLimit ? <span className="text-amber-600">· custom limit</span> : null}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none">×</button>
        </div>

        <div className="px-6 py-3 border-b bg-muted/30 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Device Limit:</span>
          <input
            type="number"
            min={0}
            placeholder={`Plan: ${plan.deviceLimit === 0 ? '∞' : plan.deviceLimit}`}
            defaultValue={restaurant.customDeviceLimit || ''}
            onBlur={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!e.target.value) onSetCustomLimit(null);
              else if (v > 0 && v !== restaurant.customDeviceLimit) onSetCustomLimit(v);
            }}
            className="h-8 w-24 text-xs border rounded px-2 bg-card"
            title="Custom device limit override"
          />
          <span className="text-[10px] text-muted-foreground">(blank = use plan default)</span>
          {isFull && (
            <span className="ml-auto text-[11px] text-red-600 font-bold flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Limit reached — naye devices approval ke liye yahan aayenge
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {pending.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-2">
                Pending Approval ({pending.length}) — limit se zyada, aapki manzoori chahiye
              </h3>
              <div className="space-y-2">
                {pending.map(d => (
                  <MiniDeviceRow key={d.deviceId} d={d}>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onApprove(d)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onReject(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </MiniDeviceRow>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <h3 className="text-xs font-bold uppercase tracking-wider text-green-600">
                Approved ({approvedList.length})
              </h3>
              {approvedList.length > 0 && (
                <Button
                  size="sm"
                  className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => generateApprovedDevicesLedger(restaurant, approvedList)}
                >
                  <Download className="h-3 w-3 mr-1" /> Download Devices Ledger PDF
                </Button>
              )}
            </div>
            {approvedList.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">No approved devices</div>
            ) : (
              <div className="space-y-2">
                {approvedList.map(d => (
                  <MiniDeviceRow key={d.deviceId} d={d}>
                    <Button size="sm" variant="outline" className="border-red-500/40 text-red-600 hover:bg-red-500/10" onClick={() => onToggleBlock(d)}>
                      <Shield className="h-3.5 w-3.5 mr-1" />Block
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onReject(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </MiniDeviceRow>
                ))}
              </div>
            )}
          </div>

          {blockedList.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-red-500 mb-2">
                Blocked ({blockedList.length})
              </h3>
              <div className="space-y-2">
                {blockedList.map(d => (
                  <MiniDeviceRow key={d.deviceId} d={d}>
                    <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => onToggleBlock(d)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Unblock
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => onReject(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </MiniDeviceRow>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t bg-muted/30 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function MiniDeviceRow({ d, children }: { d: DeviceRow; children: React.ReactNode }) {
  const loc = [d.city, d.country].filter(Boolean).join(', ');
  const on = isOnline(tsToMs(d.lastActiveAt));
  return (
    <div className="bg-card border rounded-lg p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={`h-2 w-2 rounded-full shrink-0 ${on ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
        <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{d.deviceName || `${d.browser || '?'} / ${d.os || '?'}`}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {d.ip || ''} {loc && `· ${loc}`} {d.isp && `· ${d.isp}`}
          </div>
          <div className="text-[9px] text-muted-foreground/60 font-mono truncate">id: {d.deviceId.slice(0, 16)}…</div>
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">{children}</div>
    </div>
  );
}

function generateSuperAdminDeviceLedger(d: DeviceRow, approverEmail?: string) {
  try {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const now = new Date();
    const fmt = (t: any) => {
      const ms = typeof t === 'number' ? t : tsToMs(t);
      return ms ? new Date(ms).toLocaleString() : '—';
    };

    const headerEnd = drawPdfHeader(pdf, {
      title: 'Device Authorization Ledger',
      subtitle: `Restaurant: ${d.restaurantName || d.tenantId}`,
    });
    let y = headerEnd + 4;

    pdf.setFontSize(12); pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(22, 163, 74);
    pdf.text('Status: APPROVED', 15, y);
    pdf.setTextColor(0, 0, 0);
    y += 8;

    pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
    pdf.text(`Dear ${d.restaurantName || 'Restaurant Owner'},`, 15, y); y += 6;
    const intro = pdf.splitTextToSize(
      'The device listed below has been officially approved and authorised for the DT POS system by the Digital Target Super Admin. This ledger is for your records.',
      180,
    );
    pdf.text(intro, 15, y); y += 6 * intro.length + 2;

    const rows: [string, string][] = [
      ['Restaurant', d.restaurantName || '—'],
      ['Tenant ID', d.tenantId],
      ['Device Name', d.deviceName || '—'],
      ['Device ID', d.deviceId],
      ['Browser', d.browser || '—'],
      ['Operating System', d.os || '—'],
      ['Screen', d.screen || '—'],
      ['Timezone', d.timezone || '—'],
      ['Hostname', d.hostname || '—'],
      ['IP Address', d.ip || '—'],
      ['Location', [d.city, d.region, d.country].filter(Boolean).join(', ') || '—'],
      ['ISP', d.isp || '—'],
      ['GPS', d.lat && d.lng ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : '—'],
      ['Created', fmt(d.createdAt)],
      ['Approved At', now.toLocaleString()],
      ['Last Login', fmt(d.loginAt)],
      ['Last Active', fmt(d.lastActiveMs || d.lastActiveAt)],
    ];

    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    rows.forEach(([k, v]) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      pdf.setFont('helvetica', 'bold'); pdf.text(`${k}:`, 18, y);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(String(v), 120);
      pdf.text(lines, 60, y);
      y += 6 * Math.max(1, lines.length);
    });

    y += 6;
    pdf.setDrawColor(180); pdf.line(15, y, 195, y); y += 8;
    pdf.setFontSize(9); pdf.setFont('helvetica', 'italic');
    pdf.text('This ledger certifies that the above device has been registered and authorized', 15, y);
    pdf.text('for the tenant on DT POS Cloud by Digital Target.', 15, y + 5);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    pdf.text('Authorized by: Digital Target — Super Admin', 15, y + 13);
    if (approverEmail) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      pdf.text(`(${approverEmail})`, 15, y + 18);
    }

    drawPdfFooter(pdf, 'Powered by Digital Target — DT POS Cloud  |  Contact: 0345-1873354');

    pdf.save(`device-ledger-${(d.restaurantName || d.tenantId).replace(/[^a-z0-9]/gi, '_')}-${(d.deviceName || d.deviceId).replace(/[^a-z0-9]/gi, '_')}.pdf`);
  } catch (e: any) {
    toast.error(e?.message || 'The PDF was not generated');
  }
}

// ============================================================
// All approved devices ledger (multi-device, Super Admin only)
// ============================================================
function generateApprovedDevicesLedger(restaurant: IndexRow, devices: DeviceRow[]) {
  try {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const fmt = (t: any) => {
      const ms = typeof t === 'number' ? t : tsToMs(t);
      return ms ? new Date(ms).toLocaleString() : '—';
    };
    const fmtDate = (t: any) => {
      const ms = typeof t === 'number' ? t : tsToMs(t);
      return ms ? new Date(ms).toLocaleDateString() : '—';
    };

    const plan = getPlan(restaurant.plan);
    const expiry = restaurant.planExpiryAt;
    const headerEnd = drawPdfHeader(pdf, {
      title: 'Approved Devices Ledger',
      subtitle: `${restaurant.restaurantName || restaurant.email || restaurant.id}`,
    });
    let y = headerEnd + 4;

    // Client / restaurant block
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
    pdf.text('Client / Restaurant Details', 15, y); y += 6;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    const clientRows: [string, string][] = [
      ['Restaurant', restaurant.restaurantName || '—'],
      ['Email', restaurant.email || '—'],
      ['Tenant ID', restaurant.tenantId],
      ['Subscription Plan', plan.name],
      ['Plan Expiry', fmtDate(expiry)],
      ['Last Payment', fmtDate(restaurant.lastPaymentAt)],
      ['Approved Devices', String(devices.length)],
      ['Ledger Generated', new Date().toLocaleString()],
    ];
    clientRows.forEach(([k, v]) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      pdf.setFont('helvetica', 'bold'); pdf.text(`${k}:`, 18, y);
      pdf.setFont('helvetica', 'normal');
      const lines = pdf.splitTextToSize(String(v), 130);
      pdf.text(lines, 60, y);
      y += 5.5 * Math.max(1, lines.length);
    });

    y += 4;
    pdf.setDrawColor(139, 92, 246); pdf.setLineWidth(0.4);
    pdf.line(15, y, 195, y); y += 6;

    // Devices table
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold');
    pdf.text(`Approved Devices (${devices.length})`, 15, y); y += 6;

    // Table header
    const cols = [
      { label: '#', x: 15, w: 8 },
      { label: 'Device Name', x: 23, w: 45 },
      { label: 'Type / OS', x: 68, w: 32 },
      { label: 'Device ID', x: 100, w: 40 },
      { label: 'Approved At', x: 140, w: 32 },
      { label: 'Status', x: 172, w: 23 },
    ];
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
    pdf.setFillColor(139, 92, 246); pdf.setTextColor(255, 255, 255);
    pdf.rect(15, y - 4, 180, 6, 'F');
    cols.forEach(c => pdf.text(c.label, c.x + 1, y));
    y += 4;
    pdf.setTextColor(0, 0, 0);
    pdf.setFont('helvetica', 'normal');

    devices.forEach((d, idx) => {
      if (y > 265) { pdf.addPage(); y = 20; }
      const rowH = 6;
      if (idx % 2 === 1) {
        pdf.setFillColor(245, 243, 255);
        pdf.rect(15, y - 4, 180, rowH, 'F');
      }
      const name = (d.deviceName || `${d.browser || '?'}/${d.os || '?'}`).slice(0, 28);
      const type = `${d.browser || '?'} / ${d.os || '?'}`.slice(0, 22);
      const id = d.deviceId.slice(0, 22);
      const approved = fmt((d as any).approvedAt || d.createdAt).split(',')[0];
      const status = d.blocked ? 'Blocked' : 'Active';

      pdf.text(String(idx + 1), cols[0].x + 1, y);
      pdf.text(name, cols[1].x + 1, y);
      pdf.text(type, cols[2].x + 1, y);
      pdf.text(id, cols[3].x + 1, y);
      pdf.text(approved, cols[4].x + 1, y);
      if (status === 'Active') pdf.setTextColor(22, 163, 74);
      else pdf.setTextColor(220, 38, 38);
      pdf.text(status, cols[5].x + 1, y);
      pdf.setTextColor(0, 0, 0);
      y += rowH;
    });

    y += 6;
    pdf.setDrawColor(180); pdf.line(15, y, 195, y); y += 6;

    // Certification + signature
    if (y > 250) { pdf.addPage(); y = 20; }
    pdf.setFontSize(9); pdf.setFont('helvetica', 'italic');
    const cert = pdf.splitTextToSize(
      'This ledger certifies that the above devices have been officially registered and authorized for the above restaurant on DT POS Cloud by Digital Target.',
      180,
    );
    pdf.text(cert, 15, y); y += 5 * cert.length + 6;

    // Company block (left) + signature (right)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    pdf.text('Digital Target', 15, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
    pdf.text('Contact: +92 345 1873354, +92 332 2373354', 15, y + 5);
    pdf.text('Email: digitaltarget.digital@gmail.com', 15, y + 10);

    // Signature box
    pdf.setDrawColor(120); pdf.line(130, y + 12, 190, y + 12);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9);
    pdf.text('Authorized Signature', 130, y + 17);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Hafiz Muhammad Taimoor Younas', 130, y + 22);
    pdf.text('Digital Target', 130, y + 26);

    drawPdfFooter(pdf, 'Powered by Digital Target — DT POS Cloud  |  digitaltarget.digital@gmail.com');

    const safe = (restaurant.restaurantName || restaurant.email || restaurant.tenantId).replace(/[^a-z0-9]/gi, '_');
    pdf.save(`approved-devices-ledger-${safe}.pdf`);
    toast.success('Devices ledger PDF generated');
  } catch (e: any) {
    toast.error(e?.message || 'The PDF was not generated');
  }
}

function AdminBgToggle() {
  const [mode, setMode] = useState<'light' | 'dark' | 'purple'>(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem('admin-bg-mode')) as any;
    return saved === 'dark' || saved === 'purple' ? saved : 'light';
  });
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'purple-mode');
    if (mode === 'dark') root.classList.add('dark');
    else if (mode === 'purple') root.classList.add('purple-mode');
    localStorage.setItem('admin-bg-mode', mode);
  }, [mode]);
  const opts: Array<{ k: typeof mode; label: string; title: string }> = [
    { k: 'light', label: '☀️', title: 'Light' },
    { k: 'dark', label: '🌙', title: 'Dark' },
    { k: 'purple', label: '🟣', title: 'Purple Gradient' },
  ];
  return (
    <div className="admin-mode-toggle" role="group" aria-label="Background mode">
      {opts.map(o => (
        <button
          key={o.k}
          type="button"
          title={o.title}
          onClick={() => setMode(o.k)}
          className={`admin-mode-btn ${mode === o.k ? 'active' : ''}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Super Admin Cleanup Panel
// ----------------------------------------------------------------------------
// Owner-only. Wipes Super Admin-level Firestore data (NOT tenant restaurant
// data). Each module is a checkbox; only checked ones get cleaned.
// ============================================================================

const SA_CLEANUP_MODULES: { key: string; label: string; desc: string; collections: string[]; group?: 'top' | 'tenantSub' | 'ledger' }[] = [
  { key: 'packages',   label: 'Packages',           desc: 'adminPackages',     collections: ['adminPackages'],     group: 'top' },
  { key: 'plans',      label: 'Plans',              desc: 'adminPlans',        collections: ['adminPlans'],        group: 'top' },
  { key: 'marketing',  label: 'Marketing Contacts', desc: 'marketingContacts', collections: ['marketingContacts'], group: 'top' },
  { key: 'releases',   label: 'Releases',           desc: 'systemReleases',    collections: ['systemReleases'],    group: 'top' },
  { key: 'activity',   label: 'Activity Log',       desc: 'superAdminActivity',collections: ['superAdminActivity'],group: 'top' },
  { key: 'team',       label: 'Team Members',       desc: 'superAdminTeam (hardcoded owner safe)', collections: ['superAdminTeam'], group: 'top' },
  { key: 'invoices',   label: 'All Invoices',       desc: 'tenants/*/invoices (collectionGroup)',  collections: ['invoices'],  group: 'tenantSub' },
  { key: 'payments',   label: 'All Payments',       desc: 'tenants/*/payments (collectionGroup)',  collections: ['payments'],  group: 'tenantSub' },
  { key: 'support',    label: 'Support Messages',   desc: 'tenants/*/support (collectionGroup)',   collections: ['support'],   group: 'tenantSub' },
  { key: 'ledger',     label: 'Reports / Ledger (Full Reset)', desc: 'Invoices + Payments wipe + planExpiry/lastPayment reset on userIndex', collections: ['invoices','payments'], group: 'ledger' },
];

function SuperAdminCleanupPanel() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const toggle = (k: string) => setSelected(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const selectAll = () => setSelected(new Set(SA_CLEANUP_MODULES.map(m => m.key)));
  const clearAll = () => setSelected(new Set());

  const run = async () => {
    if (selected.size === 0) { toast.error('Select modules first'); return; }
    if (confirmText.trim().toUpperCase() !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    if (!confirm(`Do you really want to permanently delete the data for ${selected.size} module(s)? This cannot be undone.`)) return;
    setBusy(true);
    let total = 0;
    try {
      const { collectionGroup, getDocs, collection, deleteDoc, writeBatch, updateDoc, doc } = await import('firebase/firestore');
      for (const key of selected) {
        const mod = SA_CLEANUP_MODULES.find(m => m.key === key); if (!mod) continue;
        for (const col of mod.collections) {
          try {
            const snap = (mod.group === 'tenantSub' || mod.group === 'ledger')
              ? await getDocs(collectionGroup(fbDb(), col))
              : await getDocs(collection(fbDb(), col));
            // Chunked batch delete
            const docs = snap.docs;
            for (let i = 0; i < docs.length; i += 400) {
              const batch = writeBatch(fbDb());
              for (const d of docs.slice(i, i + 400)) {
                if (col === 'superAdminTeam') {
                  // never delete hardcoded owners
                  const email = (d.id || '').toLowerCase();
                  const { SUPER_ADMIN_EMAILS } = await import('@/lib/firebase');
                  if (SUPER_ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)) continue;
                }
                batch.delete(d.ref); total++;
              }
              await batch.commit();
            }
          } catch (e: any) {
            console.error('wipe failed', col, e);
            toast.error(`${mod.label} (${col}): ${e?.message || 'failed'}`);
          }
        }
        // Ledger module also resets planExpiryAt / lastPaymentAt on every userIndex doc
        if (mod.group === 'ledger') {
          try {
            const idx = await getDocs(collection(fbDb(), 'userIndex'));
            for (let i = 0; i < idx.docs.length; i += 400) {
              const batch = writeBatch(fbDb());
              for (const d of idx.docs.slice(i, i + 400)) {
                batch.update(d.ref, { planExpiryAt: null, lastPaymentAt: null });
              }
              await batch.commit();
            }
          } catch (e: any) {
            console.error('userIndex reset failed', e);
            toast.error(`Ledger expiry reset: ${e?.message || 'failed'}`);
          }
        }
      }
      toast.success(`${total} document(s) cleaned. Reloading the page…`);
      setSelected(new Set()); setConfirmText('');
      setTimeout(() => { try { window.location.reload(); } catch {} }, 1200);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-500/30 bg-red-50 dark:bg-red-950/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <h3 className="font-semibold text-red-700 dark:text-red-300">Super Admin Cleanup / Reset Mode</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Sirf checked modules ka data Firestore se permanently delete hoga. Restaurants ka apna POS data is se affect nahi hota — sirf Super Admin level data (packages, plans, invoices, messages, activity logs etc.) clean hota hai.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {selected.size} of {SA_CLEANUP_MODULES.length} module(s) selected
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={selectAll} disabled={busy}>Select All</Button>
          <Button size="sm" variant="outline" onClick={clearAll} disabled={busy}>Clear</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {SA_CLEANUP_MODULES.map(m => {
          const checked = selected.has(m.key);
          return (
            <label key={m.key} className={`flex items-start gap-2 p-3 rounded-md border cursor-pointer transition ${checked ? 'border-red-500 bg-red-500/10' : 'border-border bg-card hover:bg-muted/50'}`}>
              <input type="checkbox" className="mt-1" checked={checked} onChange={() => toggle(m.key)} disabled={busy} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-muted-foreground truncate">{m.desc}</div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Confirm Wipe</div>
        <p className="text-xs text-muted-foreground">Permanently delete karne ke liye neeche <b>DELETE</b> type karen, phir button daban.</p>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Type DELETE to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={busy}
            className="max-w-xs"
          />
          <Button
            variant="destructive"
            disabled={busy || selected.size === 0 || confirmText.trim().toUpperCase() !== 'DELETE'}
            onClick={run}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {busy ? 'Cleaning…' : `Wipe Selected (${selected.size})`}
          </Button>
        </div>
      </div>
    </div>
  );
}

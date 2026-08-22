import { useState, useEffect, lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { toast } from "sonner";
import { applyTheme, getActiveTheme } from '@/lib/themes';
import { enforcePremiumThemeGate } from '@/lib/premiumTheme';
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route, Navigate } from '@/lib/hash-router';
import AppLayout from "@/components/AppLayout";
import SplashScreen from '@/components/SplashScreen';
import LoginPage from "@/pages/LoginPage";
import BusinessTypeSetupScreen from "@/components/BusinessTypeSetupScreen";
import { getSettings, onLowStock } from "@/lib/store";
import OwnerLoginPage from "@/pages/OwnerLoginPage";
import POSScreen from "@/pages/POSScreen";
// Heavy / rarely-used pages — code-split to keep initial bundle small
const TablesPage = lazy(() => import("@/pages/TablesPage"));
const RunningBillsPage = lazy(() => import("@/pages/RunningBillsPage"));
const DeliveryBoardPage = lazy(() => import("@/pages/DeliveryBoardPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const MenuManagerPage = lazy(() => import("@/pages/MenuManagerPage"));
const BackupRestorePage = lazy(() => import("@/pages/BackupRestorePage"));
const UsersRolesPage = lazy(() => import("@/pages/UsersRolesPage"));
const ReceivingPage = lazy(() => import("@/pages/ReceivingPage"));
const KitchenDisplayPage = lazy(() => import("@/pages/KitchenDisplayPage"));
const KdsTvPage = lazy(() => import("@/pages/KdsTvPage"));
const InventoryPage = lazy(() => import("@/pages/InventoryPage"));
const SuperAdminPage = lazy(() => import("@/pages/SuperAdminPage"));
const HRPage = lazy(() => import("@/pages/HRPage"));
const AccountsPage = lazy(() => import("@/pages/AccountsPage"));
const PartyMasterPage = lazy(() => import("@/pages/PartyMasterPage"));
const WhatsAppPage = lazy(() => import("@/pages/WhatsAppPage"));
const DevicesPage = lazy(() => import("@/pages/DevicesPage"));
const MarketingPage = lazy(() => import("@/pages/MarketingPage"));
const RecipesPage = lazy(() => import("@/pages/RecipesPage"));
const RetrayPage = lazy(() => import("@/pages/RetrayPage"));
const TokensPage = lazy(() => import("@/pages/TokensPage"));
const ItemSalesReportPage = lazy(() => import("@/pages/ItemSalesReportPage"));
const PraEimsSettingsPage = lazy(() => import("@/pages/PraEimsSettingsPage"));
const ModuleManagementPage = lazy(() => import("@/pages/ModuleManagementPage"));
const ShiftPage = lazy(() => import("@/pages/ShiftPage"));
const DataIntegrityPage = lazy(() => import("@/pages/DataIntegrityPage"));
const RefundPage = lazy(() => import("@/pages/RefundPage"));
const BarcodeManagerPage = lazy(() => import("@/pages/BarcodeManagerPage"));
const PendingPaymentsPage = lazy(() => import("@/pages/PendingPaymentsPage"));
const CustomerMapPage = lazy(() => import("@/pages/CustomerMapPage"));
const WastagePage = lazy(() => import("@/pages/WastagePage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const BranchesPage = lazy(() => import("@/pages/BranchesPage"));
const ProfitabilityPage = lazy(() => import("@/pages/ProfitabilityPage"));
const VariationsDealsPage = lazy(() => import("@/pages/VariationsDealsPage"));
const CrmInsightsPage = lazy(() => import("@/pages/CrmInsightsPage"));
const CostingReportsPage = lazy(() => import("@/pages/CostingReportsPage"));
const CreditsPage = lazy(() => import("@/pages/CreditsPage"));
const CreditCustomersPage = lazy(() => import("@/pages/CreditCustomersPage"));
const PromoCodesPage = lazy(() => import("@/pages/PromoCodesPage"));
const VoidBillsPage = lazy(() => import("@/pages/VoidBillsPage"));
const ReportsCenterPage = lazy(() => import("@/pages/ReportsCenterPage"));
const BranchesMapPage = lazy(() => import("@/pages/BranchesMapPage"));
const LiveMapPage = lazy(() => import("@/pages/LiveMapPage"));
const LiveRidersMapPage = lazy(() => import("@/pages/LiveRidersMapPage"));
const RiderAppPage = lazy(() => import("@/pages/RiderAppPage"));
const PickupOrdersPage = lazy(() => import("@/pages/PickupOrdersPage"));
const RidersListPage = lazy(() => import("@/pages/RidersListPage"));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const OnlineOrderPage = lazy(() => import("@/pages/OnlineOrderPage"));
const TrackOrderPage = lazy(() => import("@/pages/TrackOrderPage"));
const OnlinePortalPage = lazy(() => import("@/pages/OnlinePortalPage"));
const OrderTakerPortalPage = lazy(() => import("@/pages/OrderTakerPortalPage"));
const PrintingCenterPage = lazy(() => import("@/pages/PrintingCenterPage"));
const AdminSalesHistoryPage = lazy(() => import("@/pages/AdminSalesHistoryPage"));
const AuditHistoryPage = lazy(() => import("@/pages/AuditHistoryPage"));
const StaffAuditLogPage = lazy(() => import("@/pages/StaffAuditLogPage"));
const StaffLocationHistoryPage = lazy(() => import("@/pages/StaffLocationHistoryPage"));
const BillEditorPage = lazy(() => import("@/pages/BillEditorPage"));
const OnlineOrderApprovalPage = lazy(() => import("@/pages/OnlineOrderApprovalPage"));
const BlockedCustomersPage = lazy(() => import("@/pages/BlockedCustomersPage"));
const BlockedLocationsPage = lazy(() => import("@/pages/BlockedLocationsPage"));
const DailyWagesPage = lazy(() => import("@/pages/DailyWagesPage"));
const BillReprintPage = lazy(() => import("@/pages/BillReprintPage"));
const FoodpandaOrdersPage = lazy(() => import("@/pages/FoodpandaOrdersPage"));
const AdvancedReportsPage = lazy(() => import("@/pages/AdvancedReportsPage"));
const SuperAdminPortfolioPage = lazy(() => import("@/pages/SuperAdminPortfolioPage"));
const SuperAdminVersionsPage = lazy(() => import("@/pages/SuperAdminVersionsPage"));
const SuperAdminAIAssistantPage = lazy(() => import("@/pages/SuperAdminAIAssistantPage"));
const TenantVersionPage = lazy(() => import("@/pages/TenantVersionPage"));
const SuperAdminUpdateSafetyPage = lazy(() => import("@/pages/SuperAdminUpdateSafetyPage"));
const UpdateSafetyPage = lazy(() => import("@/pages/UpdateSafetyPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
import CloudPrintHost from '@/components/CloudPrintHost';
import VersionUpdateBanner from '@/components/VersionUpdateBanner';
import PostUpdateRestartBanner from '@/components/PostUpdateRestartBanner';
import { initStore } from '@/lib/store';
import { isCloudConfigured } from '@/lib/cloudMode';
import { isFirebaseConfigured, fbAuth } from '@/lib/firebase';
import { getTenantId, clearTenant } from '@/lib/tenant';
import { isPublicTenantRoute, applyPublicTenantFromUrl } from '@/lib/publicTenant';
import { verifyStartupAuth } from '@/lib/startupVerify';
import { forceLogoutAndWipe } from '@/lib/sessionIsolation';
// v1.18.0 — auth now goes through the backend-agnostic adapter.
import { onAuthUserChanged, authSignOut, initAuth, syncBackendFlagFromSettings } from '@/lib/authProvider';

const PageFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground text-sm">
    <div className="animate-pulse">Loading…</div>
  </div>
);

const queryClient = new QueryClient();

const App = () => {
  // ===== v1.24.1 — cloud mode is no longer "is Firebase configured" =====
  // This read isFirebaseConfigured(), which became permanently FALSE the
  // moment the Firebase config was emptied. cloudMode gates 15 things in this
  // file — including whether the email/password screen renders at all — so the
  // whole app silently fell back to single-device local mode and the owner
  // login screen never appeared. The POS user screen still worked, which is
  // why it looked like "only user login shows".
  //
  // Cloud mode now means "a cloud backend is configured", whichever one that is.
  const cloudMode = isCloudConfigured();
  // Public ordering / tracking / rider portal — bypass all auth gates, tenant comes from URL
  const isPublicOrderRoute = typeof window !== 'undefined' && isPublicTenantRoute();
  if (isPublicOrderRoute) applyPublicTenantFromUrl();

  // ===== v1.24.2 — the email login screen that never came back =====
  //
  // tenantReady decided "has the owner signed in?" from a CACHED tenant id
  // alone. A tenant id is written to localStorage on first login and never
  // expires, so from then on the app skipped Stage 1 permanently — the
  // email/password screen simply stopped appearing. The POS user screen still
  // worked, which is why the software looked fine while the Super Admin panel
  // became unreachable: the only route to it is that email screen.
  //
  // A cached tenant id is a hint, not proof of a session. It is trusted only
  // while an actual auth session exists; the effect below re-checks that once
  // auth has resolved and sends the user back to Stage 1 if it has not.
  // A super admin has NO tenant id, so a reload used to fail the tenantReady
  // check and drop the operator back to the marketing page. Read the persisted
  // super-admin flag first and treat it as a valid Stage-1 pass.
  const superAdminCached = (() => {
    try { return sessionStorage.getItem('pos-super-admin') === '1'; } catch { return false; }
  })();

  const [tenantReady, setTenantReady] = useState<boolean>(
    () => !cloudMode || superAdminCached || !!getTenantId(),
  );

  // Super-admin status was reset to false on every mount, so a refresh dropped
  // the operator out of the panel with no way back except signing in again.
  // Persist it for the session so a reload lands where it left off.
  const [superAdmin, setSuperAdmin] = useState<boolean>(superAdminCached);


  // Verify the cached tenant against a real session, once auth has resolved.
  useEffect(() => {
    if (!cloudMode || isPublicOrderRoute) return;
    let cancelled = false;
    void (async () => {
      const { waitForAuthReady, currentAuthUser } = await import('@/lib/authProvider');
      await waitForAuthReady();
      if (cancelled) return;
      if (!currentAuthUser()) {
        // Cached tenant, no session: show the email screen again rather than
        // dropping straight to the POS user prompt.
        setTenantReady(false);
        setSuperAdmin(false);
        try { sessionStorage.removeItem('pos-super-admin'); } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [cloudMode, isPublicOrderRoute]);
  // Stage 2 — staff sign-in (existing PIN/username flow)
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem('pos-user-id'));
  const [userRole, setUserRole] = useState(() => localStorage.getItem('pos-user-role') || '');
  const [ready, setReady] = useState(false);
  // v1.10.0 — business type setup gate (admin only; re-checked each render
  // via settings, not cached in state, so completing it elsewhere in the
  // same session — e.g. another tab — is picked up immediately).
  const [businessSetupDismissed, setBusinessSetupDismissed] = useState(false);

  // v1.14.1 — surface low stock the moment a sale causes it. The threshold
  // field existed for a long time but nothing ever read it, so no warning
  // could fire; the client reported exactly that.
  useEffect(() => onLowStock(items => {
    const safeItems = Array.isArray(items) ? items : [];
    const names = safeItems.slice(0, 3).map(i => `${i.name} (${i.quantity})`).join(', ');
    const more = safeItems.length > 3 ? ` +${safeItems.length - 3} more` : '';
    if (safeItems.length === 0) return;
    toast.warning(`Low stock: ${names}${more}`, { duration: 8000 });
  }), []);
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('pos-splash-seen'));
  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const onHash = () => setHashTick(t => t + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    applyTheme(getActiveTheme());
    // Auto-revert premium theme if Super Admin revoked allotment
    setTimeout(() => enforcePremiumThemeGate(), 3000);
    // Startup auth verification — kicks invalid/deleted/disabled accounts out
    // before they ever see UI. Safe no-op if not signed in.
    if (cloudMode && !isPublicOrderRoute) {
      void verifyStartupAuth();
    }
  }, [cloudMode, isPublicOrderRoute]);

  // ===== KDS Auto-Launch =====
  // If this device is registered as a Kitchen Screen (set from Devices page),
  // jump straight to /kds-tv on every boot — perfect for Smart TVs / Android TVs
  // booting into the browser. Reads device doc once tenant is ready.
  useEffect(() => {
    if (!tenantReady || superAdmin || !ready || !loggedIn) return;
    const hash = window.location.hash || '';
    if (hash.startsWith('#/kds-tv')) return; // already there
    // Fast path: local flag (set when this device was assigned)
    const localFlag = localStorage.getItem('pos-kds-device') === '1';
    if (localFlag) {
      const k = localStorage.getItem('pos-kds-device-kitchen') || 'all';
      window.location.hash = `#/kds-tv?kitchen=${encodeURIComponent(k)}`;
      return;
    }
    // Slow path: check Firestore (handles devices assigned remotely from another machine)
    if (!cloudMode) return;
    (async () => {
      try {
        const { fbDb } = await import('@/lib/firebase');
        const { getDeviceId, getTenantId } = await import('@/lib/tenant');
        const { doc, getDoc } = await import('firebase/firestore');
        const tid = getTenantId();
        const did = getDeviceId();
        if (!tid || !did) return;
        const snap = await getDoc(doc(fbDb(), 'tenants', tid, 'devices', did));
        const data: any = snap.exists() ? snap.data() : null;
        if (data?.isKdsDevice) {
          const k = data.kdsKitchenId || 'all';
          localStorage.setItem('pos-kds-device', '1');
          localStorage.setItem('pos-kds-device-kitchen', k);
          window.location.hash = `#/kds-tv?kitchen=${encodeURIComponent(k)}`;
        }
      } catch {}
    })();
  }, [tenantReady, superAdmin, ready, loggedIn, cloudMode]);

  // Listen for Firebase auth state changes.
  // IMPORTANT: Firebase can transiently emit `user=null` during token refresh
  // or offline reconnects. We must NOT force-logout in that case, otherwise
  // staff/order-taker/rider get kicked out repeatedly.
  // Only logout when:
  //   - the user intentionally signed out (flag set by logout button), OR
  //   - we never had a tenant in the first place.
  // v1.18.0 — restore the persisted session BEFORE anything reads it.
  // Every synchronous accessor (currentAuthUser, authTenantId) returns null
  // until this resolves, so booting without it would show a signed-in user as
  // signed out for the first few hundred milliseconds — exactly the
  // intermittent "not logged in" failure this adapter exists to prevent.
  useEffect(() => { void initAuth(); }, []);

  // Once settings are available, mirror the Admin's backend toggle down to
  // this device so it applies on the next start. Not applied immediately:
  // swapping auth providers under a running till would sign the cashier out
  // mid-shift.
  useEffect(() => {
    if (!ready) return;
    try { syncBackendFlagFromSettings(); } catch { /* ignore */ }
  }, [ready]);

  useEffect(() => {
    if (!cloudMode) return;
    const unsub = onAuthUserChanged((user) => {
      if (user) return; // signed in — nothing to do
      const intentional = sessionStorage.getItem('pos-intentional-logout') === '1';
      const hasTenant = !!getTenantId();
      // A super admin owns no tenant, so `!hasTenant` was true for them on the
      // very first (pre-restore) null emit and threw them straight back to the
      // login screen on every refresh. Their persisted flag counts as a session
      // hint exactly like a cached tenant id does.
      let cachedSuper = false;
      try { cachedSuper = sessionStorage.getItem('pos-super-admin') === '1'; } catch { /* ignore */ }
      if (intentional || (!hasTenant && !cachedSuper)) {
        sessionStorage.removeItem('pos-intentional-logout');
        setTenantReady(false);
        setSuperAdmin(false);
        setLoggedIn(false);
        setReady(false);
      }
      // else: transient null — keep session, the adapter re-auths from persistence

    });
    return () => unsub();
  }, [cloudMode]);

  // Re-init store whenever tenant becomes ready (skip for super admin — no tenant data)
  // Adds a 5s safety so a stalled init never shows "Loading data..." forever.
  const [initTimedOut, setInitTimedOut] = useState(false);
  useEffect(() => {
    if (!tenantReady || superAdmin) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setReady(false);
    setInitTimedOut(false);
    const safety = setTimeout(() => { if (!cancelled) setInitTimedOut(true); }, 14000);
    const attempt = () => {
      initStore()
        .then(() => {
          if (cancelled) return;
          setReady(true);
          setInitTimedOut(false);
        })
        .catch((e) => {
          if (cancelled) return;
          console.error('[initStore]', e);
          setInitTimedOut(true);
          retryTimer = setTimeout(attempt, 4000);
        });
    };
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(safety);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [tenantReady, superAdmin]);

  // Auto-sync installed Windows app version to this device's Firestore record
  // so Super Admin's "Update Required" badge clears as soon as the new EXE
  // boots — no manual stamping needed.
  useEffect(() => {
    if (!cloudMode || !tenantReady || superAdmin || !ready) return;
    (async () => {
      try {
        const { getInstalledVersion } = await import('@/lib/version');
        const { getTenantId, getDeviceId, getDeviceMeta } = await import('@/lib/tenant');
        const { syncDeviceVersion } = await import('@/lib/versionAudit');
        const tid = getTenantId(); const did = getDeviceId();
        if (!tid || !did) return;
        const v = await getInstalledVersion();
        // ZERO DATA LOSS: backup BEFORE handing off to new code paths.
        try {
          const { runPreUpdateBackupIfNeeded } = await import('@/lib/updateSafety');
          await runPreUpdateBackupIfNeeded(v);
        } catch (e) { console.warn('[pre-update backup]', e); }
        const meta = getDeviceMeta();
        let restaurantName = '';
        let branchId = ''; let branchName = '';
        let updatedBy = '';
        try {
          const r = JSON.parse(localStorage.getItem('dt_pos_restaurant') || 'null');
          restaurantName = r?.name || r?.restaurantName || '';
          const u = JSON.parse(localStorage.getItem('dt_pos_current_user') || 'null');
          updatedBy = u?.name || u?.username || u?.email || '';
          const b = JSON.parse(localStorage.getItem('dt_pos_current_branch') || 'null');
          branchId = b?.id || ''; branchName = b?.name || '';
        } catch { /* ignore */ }
        await syncDeviceVersion({
          tenantId: tid,
          deviceId: did,
          installedVersion: v,
          restaurantName,
          branchId,
          branchName,
          deviceName: meta?.deviceName,
          updatedBy,
        });
      } catch (e) { console.warn('[version sync]', e); }
    })();
  }, [cloudMode, tenantReady, superAdmin, ready]);

  // Live-sync the tenant's plan from Firestore so Super Admin plan changes apply instantly.
  useEffect(() => {
    if (!cloudMode || !tenantReady || superAdmin) return;
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { fbDb } = await import('@/lib/firebase');
        const { getTenantId } = await import('@/lib/tenant');
        const { doc, onSnapshot } = await import('firebase/firestore');
        const { setCurrentTenantPlan, setCurrentTenantOverrides } = await import('@/lib/plans');
        const { setCurrentTenantExpiry, tsToDate, isExpired } = await import('@/lib/billing');
        // v1.19.7 — plan expiry still lives in Firestore's userIndex. On a
        // Supabase session that subscription never fires, so skip it rather
        // than leave a listener attached that can never deliver.
        const { firestoreUnavailable } = await import('@/lib/legacyFirebaseGuard');

        // ===== v1.25.0 — the Enterprise sidebar that showed Trial =====
        // The plan was loaded ONLY inside the owner-login handler. This
        // watcher was the other place it could be refreshed, and on Supabase
        // it returned immediately — so after a page refresh, or after the POS
        // user signed in, nothing ever re-applied the plan and it fell back to
        // the 'trial' default.
        //
        // A restaurant paying for Enterprise saw a Trial sidebar, and no error
        // anywhere: the plan really was 'trial' in local state, it had simply
        // never been told otherwise.
        if (firestoreUnavailable()) {
          const tid0 = getTenantId();
          if (!tid0) return;
          const { sb } = await import('@/lib/supabase');

          const applyPlan = async () => {
            try {
              const [tRes, sRes] = await Promise.all([
                sb().from('tenants').select('plan, plan_expires_at').eq('id', tid0).maybeSingle(),
                sb().from('tenant_settings').select('settings')
                  .eq('tenant_id', tid0)
                  .eq('branch_id', '00000000-0000-0000-0000-000000000000').maybeSingle(),
              ]);
              const plan = (tRes.data as any)?.plan;
              // Only downgrade to trial when the row genuinely says so — never
              // because a query failed. A failed read must not strip a paying
              // restaurant of its modules.
              if (plan) setCurrentTenantPlan(plan);
              setCurrentTenantOverrides(((sRes.data as any)?.settings?.featureOverrides) ?? null);
              const exp = (tRes.data as any)?.plan_expires_at;
              setCurrentTenantExpiry(exp ? new Date(exp).getTime() : null);
            } catch (e) {
              console.warn('[plan] refresh failed — keeping the current plan', e);
            }
          };

          await applyPlan();

          // Keep it current: a plan change from the Super Admin panel reaches
          // the till without needing a re-login.
          const channel = sb().channel(`plan:${tid0}`)
            .on('postgres_changes',
              { event: 'UPDATE', schema: 'public', table: 'tenants', filter: `id=eq.${tid0}` },
              () => { void applyPlan(); })
            .subscribe();

          unsub = () => { try { sb().removeChannel(channel); } catch { /* ignore */ } };
          return;
        }

        const tid = getTenantId();
        if (!tid) return;
        unsub = onSnapshot(doc(fbDb(), 'userIndex', tid), (snap) => {
          if (!snap.exists()) return;
          const d: any = snap.data();
          setCurrentTenantPlan(d.plan || 'trial');
          setCurrentTenantOverrides(d.featureOverrides || {});
          const expDate = tsToDate(d.planExpiryAt);
          setCurrentTenantExpiry(expDate ? expDate.getTime() : null);
          // Auto-logout when expiry hits
          if (d.planExpiryAt && isExpired(d.planExpiryAt)) {
            try { window.dispatchEvent(new CustomEvent('pos-plan-expired')); } catch {}
          }
        });
      } catch {}
    })();
    return () => { if (unsub) unsub(); };
  }, [cloudMode, tenantReady, superAdmin]);

  const handleSplashDone = () => {
    sessionStorage.setItem('pos-splash-seen', '1');
    setShowSplash(false);
    // Background warm-up: pre-cache product/category images so POS grid is instant.
    // Runs after splash so it doesn't delay first paint.
    (async () => {
      try {
        const { getMenuItems, getCategories } = await import('@/lib/store');
        const { preloadImages } = await import('@/lib/imageCache');
        const urls: string[] = [];
        getMenuItems().forEach((p: any) => { if (p?.image) urls.push(p.image); });
        getCategories().forEach((c: any) => { if (c?.image) urls.push(c.image); });
        preloadImages(urls);
      } catch {}
    })();
  };


  const handleOwnerLoginSuccess = (opts: { superAdmin: boolean }) => {
    if (opts.superAdmin) {
      setSuperAdmin(true);
      // Remembered for the tab so a refresh returns to the panel.
      try { sessionStorage.setItem('pos-super-admin', '1'); } catch { /* ignore */ }
      setTenantReady(true); // bypasses Stage-1 screen; SuperAdminPage shown below
    } else {
      setSuperAdmin(false);
      try { sessionStorage.removeItem('pos-super-admin'); } catch { /* ignore */ }
      setTenantReady(true);
    }
  };

  const handleLogin = (userId: string, role: string) => {
    localStorage.setItem('pos-user-id', userId);
    localStorage.setItem('pos-user-role', role);
    setLoggedIn(true);
    setUserRole(role);
  };

  const handleLogout = async () => {
    // ===== v1.2.4 DATA-LOSS GUARD =====
    // Logout hard-wipes local storage. Pehle ye check kiye baghair chalta tha
    // ke koi bill abhi cloud tak pahuncha bhi hai ya nahi — offline/sync-error
    // ki soorat me saara kaam urh jata tha. Ab: pehle flush, phir agar phir bhi
    // kuch baaqi ho to user se poochho + emergency backup file de do.
    try {
      const { countUnsyncedWork, flushUnsyncedWork, emergencyBackup } = await import('@/lib/dataSafety');
      const before = await countUnsyncedWork();
      if (before.total > 0) {
        toast.info(`Sending ${before.total} items to the cloud — one moment…`);
        const after = await flushUnsyncedWork(10000);
        if (after.total > 0) {
          const ok = window.confirm(
            `⚠️ ${after.total} items have NOT yet synced to the cloud.\n\n` +
            `Logging out will erase this local data.\n\n` +
            `OK = backup file download karke logout\n` +
            `Cancel = stop the logout (check your internet; your data stays safe)`
          );
          if (!ok) return;               // ABORT logout — data stays safe
          await emergencyBackup('pre-logout');
          toast.warning('Backup file downloaded — you can restore it from Backup & Restore');
        }
      }
    } catch (e) { console.warn('[logout] data-safety check failed', e); }

    // Mark this sign-out as intentional so the auth listener actually kicks
    // the user back to the login screen (transient nulls are ignored).
    try { sessionStorage.setItem('pos-intentional-logout', '1'); } catch {}
    setLoggedIn(false);
    setUserRole('');
    if (cloudMode) {
      setTenantReady(false);
      setSuperAdmin(false);
    }
    // Hard wipe: localStorage / sessionStorage / IndexedDB / CacheStorage + Firebase signOut
    try { await forceLogoutAndWipe(); } catch {}
  };

  if (showSplash && !isPublicOrderRoute) {
    return <SplashScreen onDone={handleSplashDone} duration={550} />;
  }


  // Public ordering portal — no auth required
  if (isPublicOrderRoute) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                {/* v1.20.1 — where the emailed reset link lands. Must be
                    reachable WITHOUT a session: the whole point is that the
                    person cannot sign in. */}
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/order" element={<OnlineOrderPage />} />
                <Route path="/order/:tenantId" element={<OnlineOrderPage />} />
                <Route path="/track" element={<TrackOrderPage />} />
                <Route path="/track/:tenantId" element={<TrackOrderPage />} />
                <Route path="/rider-portal" element={<RiderAppPage />} />
                <Route path="/rider-portal/:tenantId" element={<RiderAppPage />} />
                <Route path="/order-taker" element={<OrderTakerPortalPage />} />
                <Route path="/order-taker/:tenantId/*" element={<OrderTakerPortalPage />} />
              </Routes>
            </Suspense>
          </HashRouter>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Stage 1: owner login (cloud mode only)
  if (cloudMode && !tenantReady) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <PostUpdateRestartBanner />
          <OwnerLoginPage onSuccess={handleOwnerLoginSuccess} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Super Admin console (no POS data, no staff login)
  if (cloudMode && superAdmin) {
    // Allow Super Admin to navigate to dedicated sub-pages via hash route
    const hash = (typeof window !== 'undefined' ? window.location.hash : '') || '';
    const superRoute = hash.replace(/^#/, '').split('?')[0];
    const isSubRoute = ['/super-portfolio','/super-versions','/super-ai','/super-update-safety'].includes(superRoute);
    const renderSuperRoute = () => {
      switch (superRoute) {
        case '/super-portfolio':     return <SuperAdminPortfolioPage />;
        case '/super-versions':      return <SuperAdminVersionsPage />;
        case '/super-ai':            return <SuperAdminAIAssistantPage />;
        case '/super-update-safety': return <SuperAdminUpdateSafetyPage />;
        default:                     return <SuperAdminPage onLogout={handleLogout} />;
      }
    };
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            {isSubRoute && (
              <div className="sticky top-0 z-50 flex items-center gap-2 px-4 py-2 bg-background border-b">
                <button
                  onClick={() => { window.location.hash = ''; }}
                  className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
                >
                  ← Back to Super Admin
                </button>
                <span className="text-xs text-muted-foreground">{superRoute}</span>
              </div>
            )}
            <Suspense fallback={<PageFallback />}>{renderSuperRoute()}</Suspense>
          </HashRouter>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }



  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center space-y-3 max-w-sm px-6">
          {!initTimedOut ? (
            <>
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
              <p className="text-sm text-muted-foreground">Loading data...</p>
            </>
          ) : (
            <>
              <div className="h-12 w-12 mx-auto rounded-full bg-amber-500/15 text-amber-600 flex items-center justify-center text-xl">⚠</div>
              <p className="text-sm font-bold">Cloud data sync is slow</p>
              <p className="text-xs text-muted-foreground">The safety lock is active — default or empty data will not open, and nothing has been deleted.</p>
              <p className="text-xs text-muted-foreground">The app is retrying by itself — please check your internet connection.</p>
              <div className="flex gap-2 justify-center pt-2">
                <button
                  onClick={() => window.location.reload()}
                  className="text-xs font-bold px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                >Reload</button>
                <button
                  onClick={async () => {
                    try {
                      // DATA-LOSS GUARD: never clear cache over unsynced work
                      // without flushing + handing the user a backup file.
                      const { countUnsyncedWork, flushUnsyncedWork, emergencyBackup } = await import('@/lib/dataSafety');
                      const before = await countUnsyncedWork();
                      if (before.total > 0) {
                        const after = await flushUnsyncedWork(10000);
                        if (after.total > 0) {
                          const ok = window.confirm(
                            `⚠️ ${after.total} items have not synced to the cloud.\n\nClearing the cache will erase them.\n\nOK = download a backup, then clear\nCancel = stop`
                          );
                          if (!ok) return;
                          await emergencyBackup('pre-clear-cache');
                        }
                      }
                    } catch {}
                    try { const { forceLogoutAndWipe } = await import('@/lib/sessionIsolation'); await forceLogoutAndWipe('Cache cleared. Please sign in again.'); window.location.reload(); } catch { window.location.reload(); }
                  }}
                  className="text-xs font-bold px-3 py-1.5 rounded-md border"
                >Clear cache & Logout</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <LoginPage onLogin={handleLogin} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Order Taker — dedicated portal only (no full POS software / sidebar)
  if (userRole === 'order_taker') {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <HashRouter>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="*" element={<OrderTakerPortalPage />} />
              </Routes>
            </Suspense>
          </HashRouter>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // v1.10.0 — Business Type setup, shown once to the admin before the
  // rest of the app. Managers/cashiers/riders are never blocked by this —
  // it is a one-time business-configuration decision, not a login gate.
  if (
    userRole === 'admin'
    && !businessSetupDismissed
    && !getSettings()?.businessTypeSetupDone
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BusinessTypeSetupScreen onDone={() => setBusinessSetupDismissed(true)} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VersionUpdateBanner />
        <PostUpdateRestartBanner />
        <Toaster />
        <Sonner />
        <CloudPrintHost />
        <HashRouter>

          <AppLayout userRole={userRole} onLogout={handleLogout}>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<POSScreen />} />
                <Route path="/tables" element={<TablesPage />} />
                <Route path="/bills" element={<RunningBillsPage />} />
                <Route path="/running-bills" element={<RunningBillsPage />} />
                <Route path="/delivery" element={<DeliveryBoardPage />} />
                <Route path="/pickup" element={<PickupOrdersPage />} />
                <Route path="/rider" element={<RiderAppPage />} />
                <Route path="/kitchen" element={<KitchenDisplayPage />} />
                <Route path="/kds-tv" element={<KdsTvPage />} />
                <Route path="/whatsapp" element={<WhatsAppPage />} />
                <Route path="/marketing" element={<MarketingPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customer-map" element={<CustomerMapPage />} />
                <Route path="/credits" element={<CreditsPage />} />
                <Route path="/credit-customers" element={<CreditCustomersPage />} />
                <Route path="/promo-codes" element={<PromoCodesPage />} />
                <Route path="/void-bills" element={<VoidBillsPage />} />
                <Route path="/retray" element={<RetrayPage />} />
                <Route path="/tokens" element={<TokensPage />} />
                <Route path="/item-sales-report" element={<ItemSalesReportPage />} />
                <Route path="/pra-eims" element={<PraEimsSettingsPage />} />
                <Route path="/module-management" element={<ModuleManagementPage />} />
                <Route path="/shifts" element={<ShiftPage />} />
                <Route path="/data-integrity" element={<DataIntegrityPage />} />
                <Route path="/refund" element={<RefundPage />} />
                <Route path="/barcode" element={<BarcodeManagerPage />} />
                <Route path="/pending-payments" element={<PendingPaymentsPage />} />
                <Route path="/bill-reprint" element={<BillReprintPage />} />
                <Route path="/foodpanda-orders" element={<FoodpandaOrdersPage />} />
                <Route path="/advanced-reports" element={<AdvancedReportsPage />} />
                <Route path="/online-portal" element={<OnlinePortalPage />} />
                
                <Route path="/online-approval" element={<OnlineOrderApprovalPage />} />
                <Route path="/blocked-customers" element={<BlockedCustomersPage />} />
                <Route path="/blocked-locations" element={<BlockedLocationsPage />} />
                {/* All authenticated routes registered for every role.
                    Access is gated by permissions.ts + sidebar visibility,
                    not by route registration — prevents 404 for cashier/etc.
                    when they click a link their permissions allow. */}
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/profitability" element={<ProfitabilityPage />} />
                <Route path="/variations" element={<VariationsDealsPage />} />
                <Route path="/crm" element={<CrmInsightsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/costing" element={<CostingReportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/printing-center" element={<PrintingCenterPage />} />
                {/* Legacy printing routes now redirect into the Printing Center */}
                <Route path="/printer-settings" element={<Navigate to="/printing-center?tab=printers" replace />} />
                <Route path="/printer-diagnostics" element={<Navigate to="/printing-center?tab=diagnostics" replace />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/recipes" element={<RecipesPage />} />
                <Route path="/wastage" element={<WastagePage />} />
                <Route path="/menu" element={<MenuManagerPage />} />
                <Route path="/backup" element={<BackupRestorePage />} />
                <Route path="/receiving" element={<ReceivingPage />} />
                <Route path="/users" element={<UsersRolesPage />} />
                <Route path="/hr" element={<HRPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/parties" element={<PartyMasterPage />} />
                <Route path="/daily-wages" element={<DailyWagesPage />} />
                <Route path="/devices" element={<DevicesPage />} />
                <Route path="/branches" element={<BranchesPage />} />
                <Route path="/branches-map" element={<BranchesMapPage />} />
                <Route path="/live-map" element={<LiveMapPage />} />
                <Route path="/live-riders" element={<LiveRidersMapPage />} />
                <Route path="/riders" element={<RidersListPage />} />
                <Route path="/reports-center" element={<ReportsCenterPage />} />
                <Route path="/admin-sales-history" element={<AdminSalesHistoryPage />} />
                <Route path="/audit-history" element={<AuditHistoryPage />} />
                <Route path="/staff-audit" element={<StaffAuditLogPage />} />
                <Route path="/staff-locations" element={<StaffLocationHistoryPage />} />
                <Route path="/bill-editor" element={<BillEditorPage />} />
                <Route path="/super-portfolio" element={<SuperAdminPortfolioPage />} />
                <Route path="/super-versions" element={<SuperAdminVersionsPage />} />
                <Route path="/super-ai" element={<SuperAdminAIAssistantPage />} />
                <Route path="/version" element={<TenantVersionPage />} />
                <Route path="/super-update-safety" element={<SuperAdminUpdateSafetyPage />} />
                <Route path="/update-safety" element={<UpdateSafetyPage />} />
                <Route path="/pending-prints" element={<Navigate to="/printing-center?tab=queue" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppLayout>
        </HashRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

import ErrorBoundary from '@/components/ErrorBoundary';
const AppWithBoundary = () => (<ErrorBoundary><App /></ErrorBoundary>);
export default AppWithBoundary;

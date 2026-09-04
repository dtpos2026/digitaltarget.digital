// ============================================================================
// Which restaurant is this app for?
//
// REPORTED: "Rider App mein wazeh hona chahiye ke ye kis restaurant ki app
// hai", and the same for the Order Taker.
//
// One APK serves every restaurant — the login decides which one — so the name
// cannot come from the bundle. It arrives with portal_bootstrap and is cached,
// so a rider opening the app on a dead signal still sees whose app it is
// rather than a blank header.
// ============================================================================
import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';

interface Restaurant { name?: string; branchName?: string; logoUrl?: string | null }

export default function PortalRestaurantBadge({ compact = false }: { compact?: boolean }) {
  const [r, setR] = useState<Restaurant | null>(null);

  useEffect(() => {
    // The cache first, so the name paints immediately.
    try {
      const raw = localStorage.getItem('dt-portal-restaurant');
      if (raw) setR(JSON.parse(raw) as Restaurant);
    } catch { /* private mode */ }

    // Then the server, in case the staff member was moved to another branch.
    void (async () => {
      try {
        const { hasPortalSession, portalRestaurant } = await import('@/lib/portalData');
        if (!hasPortalSession()) return;
        const res = await portalRestaurant();
        if (res.ok && res.data?.name) {
          setR(res.data);
          try { localStorage.setItem('dt-portal-restaurant', JSON.stringify(res.data)); } catch {}
        }
      } catch { /* the cached name stands */ }
    })();
  }, []);

  if (!r?.name) return null;

  return (
    <div className="flex items-center gap-2 min-w-0" title={r.name}>
      {r.logoUrl
        ? <img src={r.logoUrl} alt="" className="h-6 w-6 rounded object-cover shrink-0" />
        : <Store className="h-4 w-4 shrink-0 opacity-80" />}
      <div className="min-w-0 leading-tight">
        <div className={`font-bold truncate ${compact ? 'text-[11px]' : 'text-xs'}`}>{r.name}</div>
        {r.branchName && (
          <div className="text-[10px] opacity-75 truncate">{r.branchName}</div>
        )}
      </div>
    </div>
  );
}

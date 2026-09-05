// ============================================================================
// Which restaurant is this app for?
//
// REPORTED: "Rider App mein wazeh hona chahiye ke ye kis restaurant ki app
// hai", and the same for the Order Taker.
//
// One APK serves every restaurant — the login decides which one — so the name
// cannot come from the bundle. Since v1.45.0 it comes from the one shared
// resolver in lib/restaurantIdentity, the same one the POS header uses, so a
// rider and the owner are never looking at two different answers. The cache
// paints first, so a rider opening the app on a dead signal still sees whose
// app it is rather than a blank header.
// ============================================================================
import { Store } from 'lucide-react';
import { useRestaurantIdentity } from '@/hooks/useRestaurantIdentity';

export default function PortalRestaurantBadge({
  compact = false,
  showCode = false,
}: { compact?: boolean; showCode?: boolean }) {
  const r = useRestaurantIdentity();

  if (!r.name) return null;

  return (
    <div className="flex items-center gap-2 min-w-0" title={r.name}>
      {r.logoUrl
        ? <img src={r.logoUrl} alt="" className="h-6 w-6 rounded object-cover shrink-0" />
        : <Store className="h-4 w-4 shrink-0 opacity-80" />}
      <div className="min-w-0 leading-tight">
        <div className={`font-bold truncate ${compact ? 'text-[11px]' : 'text-xs'}`}>{r.name}</div>
        {(r.branchName || (showCode && r.workspaceCode)) && (
          <div className="text-[10px] opacity-75 truncate">
            {r.branchName}
            {showCode && r.workspaceCode && (
              <span className={r.branchName ? 'ml-1 font-mono tracking-wider' : 'font-mono tracking-wider'}>
                {r.branchName ? '· ' : ''}{r.workspaceCode}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

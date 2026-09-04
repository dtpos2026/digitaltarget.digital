// ============================================================================
// "worpace code dasbord me nzr ay" + "her fountion ko pta ho mera resrurant"
//
// The Workspace Code card lives on two pages. A cashier who never opens either
// one has no way to see the code, and a staff member on a shared device has no
// standing confirmation of WHICH restaurant they are ringing sales into.
//
// This chip sits in the app header, so it is on screen for every function of
// every page — POS, reports, settings, rider, order taker alike — and it is
// the same resolver behind it in all of them.
// ============================================================================
import { Store, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useRestaurantIdentity } from '@/hooks/useRestaurantIdentity';

export default function RestaurantIdentityChip({
  showName = false,
  className = '',
}: { showName?: boolean; className?: string }) {
  const id = useRestaurantIdentity();

  if (!id.workspaceCode && !id.name) return null;

  const copy = () => {
    if (!id.workspaceCode) return;
    void navigator.clipboard?.writeText(id.workspaceCode);
    toast.success(`Workspace Code ${id.workspaceCode} copied`);
  };

  return (
    <div
      className={`hidden md:flex items-center gap-2 rounded-md border border-gold/40 bg-gold-soft/40 px-2 py-0.5 min-w-0 ${className}`}
      title={
        `${id.name || 'This restaurant'}${id.branchName ? ` — ${id.branchName}` : ''}` +
        (id.workspaceCode ? `\nWorkspace Code: ${id.workspaceCode}` : '')
      }
    >
      {id.logoUrl
        ? <img src={id.logoUrl} alt="" className="h-4 w-4 rounded object-cover shrink-0" />
        : <Store className="h-3.5 w-3.5 shrink-0 text-primary" />}
      {showName && id.name && (
        <span className="text-[11px] font-semibold truncate max-w-[10rem]">{id.name}</span>
      )}
      {id.workspaceCode && (
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[11px] font-mono font-extrabold tracking-[0.18em] text-primary hover:underline"
          title="Copy the Workspace Code — staff type this in the DT Rider / DT Order Taker app"
        >
          <KeyRound className="h-3 w-3" />
          {id.workspaceCode}
        </button>
      )}
    </div>
  );
}

// The user block at the right of the top bar (design SW-02: avatar, name, workspace) — and everything the bar used to carry loose.
//
// Before, the bar also held a status pulse, a clock, a colour-scheme button, a text-size button and a log-out icon next to the
// avatar: eight controls in a row, which is what read as "messy". They are all still here, one click away, in this menu — the design's
// bar has none of them. Nothing was removed.
import { Check, ChevronDown, LogOut, ZoomIn, ZoomOut } from 'lucide-react';
import BillingStatusBar from '@/components/BillingStatusBar';
import HeaderClock from '@/components/shell/HeaderClock';
import PoweredByBrand from '@/components/PoweredByBrand';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useRestaurantIdentity } from '@/hooks/useRestaurantIdentity';
import { useAccentOverride, useRefinedSurface, REFINED_SURFACES } from '@/lib/uiStyle';
import { REFINED_SCHEMES, activeRefinedScheme, applyRefinedScheme } from '@/lib/refinedSchemes';

const label = 'mb-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground';

/** Colour schemes: colours only, nothing moves (v1.103.0). */
function SchemeGrid() {
  const surface = useRefinedSurface();
  const accent = useAccentOverride();
  const active = activeRefinedScheme(surface, accent);
  return (
    <div data-testid="scheme-switcher">
      <div className="mb-2 flex items-baseline justify-between">
        <span className={label + ' !mb-0'}>Colour scheme</span>
        <span className="text-[11px] text-muted-foreground">{active ? active.name : 'Custom'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Colour scheme">
        {REFINED_SCHEMES.map(sc => {
          const surf = REFINED_SURFACES.find(x => x.id === sc.surface)!;
          const on = active?.id === sc.id;
          return (
            <button
              key={sc.id} type="button" role="radio" aria-checked={on} data-scheme={sc.id} onClick={() => applyRefinedScheme(sc)}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-[11.5px] font-semibold transition-colors ${on ? 'border-primary bg-primary/5' : 'hover:border-primary/40'}`}
            >
              <span className="relative flex h-8 w-full overflow-hidden rounded-lg border" style={{ background: surf.page }} aria-hidden>
                <span className="w-1/3" style={{ background: surf.card, borderRight: `1px solid ${surf.ink}22` }} />
                <span className="m-auto h-3 w-1/3 rounded" style={{ background: sc.accent || '#5b21b6' }} />
              </span>
              <span className="truncate">{sc.name}</span>
              {on && <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" /></span>}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">More choices, and your own accent colour: Settings → Appearance.</p>
    </div>
  );
}

export default function RefinedUserMenu({
  name, role, onLogout, zoom, onZoom, onResetZoom,
}: { name: string; role: string; onLogout: () => void; zoom: number; onZoom: (d: number) => void; onResetZoom: () => void }) {
  const id = useRestaurantIdentity();
  const shown = name || role || '?';
  const workspace = id.name || id.branchName || '';
  const iconBtn = 'grid h-9 w-9 place-items-center rounded-[10px] border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" data-dtr="user-chip" data-testid="refined-user-menu" aria-label="Account and settings"
          className="flex shrink-0 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition-colors hover:bg-accent">
          <span data-dtr="avatar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-[13px] font-extrabold uppercase text-primary">{shown.slice(0, 2)}</span>
          <span className="hidden min-w-0 leading-tight xl:block">
            <span className="block max-w-[9rem] truncate text-[13px] font-bold text-foreground">{shown}</span>
            <span className="block max-w-[9rem] truncate text-[11.5px] text-muted-foreground">{workspace || <span className="capitalize">{role}</span>}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-muted-foreground xl:block" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[21rem] space-y-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-[15px] font-extrabold uppercase text-primary">{shown.slice(0, 2)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-extrabold leading-tight">{shown}</div>
            <div className="text-[12px] capitalize leading-tight text-muted-foreground">{role}{workspace ? ` · ${workspace}` : ''}</div>
            {id.workspaceCode && <div className="mt-1 font-mono text-[11px] font-bold tracking-[0.16em] text-primary">Workspace {id.workspaceCode}</div>}
          </div>
        </div>

        <div className="rounded-xl border bg-background px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Now</span><HeaderClock variant="modern" /></div></div>

        <div>
          <div className={label}>Status</div>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="refined-status"><BillingStatusBar warning={false} /></div>
        </div>

        <SchemeGrid />

        <div>
          <div className={label}>Screen text size</div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => onZoom(-5)} className={iconBtn} aria-label="Smaller"><ZoomOut className="h-4 w-4" /></button>
            <button type="button" onClick={onResetZoom} className="rounded-lg px-2 py-1 font-mono text-[13px] font-bold tabular-nums hover:bg-accent" title="Reset to 100%">{zoom}%</button>
            <button type="button" onClick={() => onZoom(5)} className={iconBtn} aria-label="Larger"><ZoomIn className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <PoweredByBrand variant="credit" collapsed={false} />
          <button type="button" onClick={onLogout} data-testid="refined-logout"
            className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3 text-[13px] font-bold text-destructive transition-colors hover:bg-destructive/10">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

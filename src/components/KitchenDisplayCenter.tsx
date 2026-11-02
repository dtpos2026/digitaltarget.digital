// ============================================================
// KITCHEN DISPLAY CENTER — choose the screen, open the display.
//
// What the OS can tell us, and what it cannot
// ------------------------------------------
// Electron reports the displays the operating system has: label, resolution,
// scale, position, and which is primary. It does NOT report the cable. There
// is no API that says "this monitor is on HDMI" — so an HDMI/USB/VGA picker
// would be a label with nothing behind it.
//
// This lists what is real instead. A kitchen TV on HDMI, a second monitor on
// VGA and a USB display adapter all appear the same way here, because once
// the OS has them they ARE the same thing to the application: a screen with
// bounds a window can be placed on. Whichever cable it arrived by, the
// Kitchen Display lands on the screen you pick.
//
// Click to activate
// -----------------
// A screen card is a button that opens the display on that screen there and
// then. Selecting a screen and then hunting for a separate Open button is one
// step more than the job needs, and the shop is usually standing at the
// counter with the TV in front of them wanting it on NOW. The separate button
// stays for the keyboard path and for reopening after a settings change.
//
// The list also refreshes itself while this card is on screen, so a TV
// switched on after the page opened appears without anybody pressing refresh.
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tv, Monitor, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';

interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  internal: boolean;
}

interface Props {
  /** Which kitchen the display should show. */
  kitchen: string;
}

/**
 * What to put on the second screen.
 *
 * Two genuinely different audiences: the KITCHEN board is dense and is read
 * by cooks who act on it, while the CUSTOMER display answers one question for
 * someone standing at the counter. A shop may want either, and with two
 * external screens it may want both.
 */
type Content = 'kitchen' | 'customer';

function api(): any {
  return (window as any).electronAPI;
}

/**
 * The screen's shape, in the words people use for it.
 *
 * Shown because it is the one property that decides how a board should be laid
 * out — and, in automatic template mode, the one the app is reading. A shop
 * seeing "4:3" next to a screen can tell at a glance why it was given the
 * compact design.
 */
function aspectLabel(width: number, height: number): string {
  if (!width || !height) return 'unknown shape';
  const r = width / height;
  if (Math.abs(r - 16 / 9) < 0.06) return '16:9';
  if (Math.abs(r - 16 / 10) < 0.05) return '16:10';
  if (Math.abs(r - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(r - 21 / 9) < 0.1) return '21:9';
  if (r < 1) return 'portrait';
  return `${r.toFixed(2)}:1`;
}

export default function KitchenDisplayCenter({ kitchen }: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<Content>('kitchen');
  const desktop = !!api()?.listDisplays;

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const res = await api().listDisplays();
      if (!res?.success) return;
      const list: DisplayInfo[] = res.displays || [];
      setDisplays(list);
      // Default to the first EXTERNAL screen — a kitchen display on the
      // cashier's own monitor helps nobody.
      setSelected(prev => {
        if (prev !== null && list.some(d => d.id === prev)) return prev;
        return (list.find(d => !d.primary) || list[0])?.id ?? null;
      });
      const st = await api().isKdsWindowOpen?.();
      setOpen(!!st?.open);
    } catch { /* leave the last known list */ }
  }, [desktop]);

  const [lastChange, setLastChange] = useState<string>('');

  useEffect(() => {
    refresh();
    // Windows tells Electron the moment a monitor appears or disappears —
    // HDMI, DisplayPort, VGA through an adapter, a USB display, it does not
    // matter which. That is the signal; the poll and the focus listener are
    // only belt and braces for an older Electron that does not emit it.
    //
    // Nothing opens or moves by itself when a screen appears. A display
    // window jumping monitors mid-service, or re-opening over the till while
    // a bill is being taken, is exactly what this is meant to avoid: the list
    // is kept honest and the shop clicks the screen it wants.
    const off = api()?.onDisplaysChanged?.((payload: any) => {
      refresh();
      const n = (payload?.displays || []).length;
      setLastChange(
        payload?.reason === 'added' ? `A screen was connected — ${n} now available.`
        : payload?.reason === 'removed' ? `A screen was disconnected — ${n} left.`
        : `A screen changed resolution — ${n} available.`,
      );
    });
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const poll = setInterval(refresh, 8000);
    return () => {
      try { off?.(); } catch { /* already gone */ }
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
    };
  }, [refresh]);

  /**
   * Open the display on a screen.
   *
   * `displayId` is passed explicitly rather than read from state because a
   * click on a screen card both selects and opens: reading `selected` here
   * would use the PREVIOUS selection, since the state update has not landed
   * by the time the handler runs.
   */
  const launch = async (displayId: number | null = selected) => {
    if (busy || displayId === null) return;
    setBusy(true);
    try {
      const url = content === 'customer'
        ? `${window.location.origin}${window.location.pathname}#/customer-display`
        : `${window.location.origin}${window.location.pathname}#/kds-tv?kitchen=${encodeURIComponent(kitchen)}`;
      const res = await api().openKdsWindow({ url, displayId, fullscreen: true });
      if (res?.success) {
        setOpen(true);
        const d = displays.find(x => x.id === res.displayId);
        const what = content === 'customer' ? 'Customer Display' : 'Kitchen board';
        toast.success(`${what} opened on ${d ? d.label : 'the selected screen'}.`);
      } else {
        toast.error(`Could not open the display: ${res?.error || 'unknown error'}`);
      }
    } catch (e: any) {
      toast.error(`Could not open the display: ${e?.message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    setBusy(true);
    try {
      await api().closeKdsWindow();
      setOpen(false);
      toast.success('Kitchen Display closed.');
    } finally {
      setBusy(false);
    }
  };

  // Browser build: no second window to place, so fall back to the tab the
  // app already used. Saying so is better than showing a dead picker.
  if (!desktop) {
    return (
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Tv className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold">Kitchen Display</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Screen selection is available in the desktop app. In the browser the
              display opens in a new tab, which you can move to the kitchen screen
              yourself.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => window.open(`#/kds-tv?kitchen=${encodeURIComponent(kitchen)}`, '_blank')}>
            <Tv className="h-4 w-4 mr-1" /> Kitchen board
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.open('#/customer-display', '_blank')}>
            <Monitor className="h-4 w-4 mr-1" /> Customer display
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Tv className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold">Display Center</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Choose what to show and which screen to show it on.
            </p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} title="Re-read connected screens">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">What should this screen show?</p>
        <div className="flex gap-2">
          <Button
            type="button" size="sm"
            variant={content === 'kitchen' ? 'default' : 'outline'}
            onClick={() => setContent('kitchen')}
          >
            Kitchen board
          </Button>
          <Button
            type="button" size="sm"
            variant={content === 'customer' ? 'default' : 'outline'}
            onClick={() => setContent('customer')}
          >
            Customer display
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {content === 'kitchen'
            ? 'The dense board cooks work from — every active order and its items.'
            : 'The screen above the counter: preparing, ready to collect, and your banners.'}
        </p>
      </div>

      {lastChange && (
        <p className="text-xs rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          {lastChange} Nothing was moved or re-opened — click a screen below when
          you want to use it.
        </p>
      )}

      {displays.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No screens reported yet. Connect the kitchen display and press refresh.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {displays.map(d => {
            const active = d.id === selected;
            return (
              <button
                key={d.id}
                type="button"
                disabled={busy}
                onClick={() => { setSelected(d.id); void launch(d.id); }}
                title={`Open the ${content === 'customer' ? 'customer display' : 'kitchen board'} on ${d.label}`}
                className={`text-left rounded-lg border p-3 transition-all disabled:opacity-60 ${
                  active
                    ? 'border-primary ring-2 ring-primary/30 bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Monitor className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="font-medium text-sm truncate">{d.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {d.width} × {d.height}
                  {d.scaleFactor !== 1 ? ` @ ${d.scaleFactor}×` : ''}
                  {' · '}{aspectLabel(d.width, d.height)}
                </p>
                <div className="flex gap-1 mt-2 flex-wrap">
                  {d.primary && <Badge variant="secondary" className="text-[10px]">Primary</Badge>}
                  {!d.primary && <Badge className="text-[10px] bg-status-success/20 text-status-success border-status-success/30">External</Badge>}
                  {d.internal && <Badge variant="secondary" className="text-[10px]">Built in</Badge>}
                </div>
                <p className="text-[11px] text-primary mt-2 font-medium">
                  {busy ? 'Opening…' : 'Click to activate'}
                </p>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => launch(selected)} disabled={busy || selected === null}>
          <Tv className="h-4 w-4 mr-1" />
          {open
            ? 'Reopen on this screen'
            : content === 'customer' ? 'Open Customer Display' : 'Open Kitchen Board'}
        </Button>
        {open && (
          <Button variant="outline" onClick={close} disabled={busy}>
            <X className="h-4 w-4 mr-1" /> Close display
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        The list shows every screen Windows reports, however it is connected —
        HDMI, VGA, DisplayPort or a USB adapter. Windows does not tell an
        application which cable a monitor is on, so the screens are identified
        by name and resolution instead of a cable label.
      </p>
    </Card>
  );
}

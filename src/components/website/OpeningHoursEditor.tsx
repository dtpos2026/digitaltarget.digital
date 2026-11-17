// v1.115.0 — the software's side of the website's opening hours, pause and links (Settings → Online Portal).
// One card: the weekly schedule with a time zone, a "Pause orders" busy mode, and the social links the About page shows.
// It edits the owner's settings (`onlineHours`, `onlinePausedUntil`, `onlineInstagram` …); the website reads them through the same
// public allow-list as every other switch, and the server checks them again when an order arrives. Nothing here is a new table.
import { useEffect, useMemo, useState } from 'react';
import { Clock, PauseCircle, PlayCircle, Share2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RestaurantSettings } from '@/lib/types';
import { DAY_KEYS, DAY_NAMES, closedMessage, defaultOpeningHours, formatClock, isPaused, isValidTimeZone, openState, parseOpeningHours, pauseUntil, statusChip, type DayKey, type OpeningHours } from '@/lib/openingHours';

const FALLBACK_ZONES = ['Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka', 'Europe/London', 'Europe/Istanbul', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

function zones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const all = f ? f('timeZone') : [];
    if (all.length) return all.includes('UTC') ? all : [...all, 'UTC'];
  } catch { /* an older browser: the short list below */ }
  return FALLBACK_ZONES;
}

const deviceZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Karachi'; } catch { return 'Asia/Karachi'; } };

export default function OpeningHoursEditor({ settings, persist }: { settings: RestaurantSettings; persist: (patch: Partial<RestaurantSettings>) => void }) {
  // the stored document is read leniently; what the owner edits is always a complete, valid one
  const hours: OpeningHours = useMemo(() => {
    const parsed = parseOpeningHours(settings.onlineHours);
    if (parsed) return { ...parsed, enabled: (settings.onlineHours as { enabled?: boolean } | undefined)?.enabled === true };
    return { ...defaultOpeningHours(), timeZone: deviceZone() };
  }, [settings.onlineHours]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const tz = hours.timeZone && isValidTimeZone(hours.timeZone) ? hours.timeZone : deviceZone();
  const zoneList = useMemo(zones, []);

  const save = (next: OpeningHours) => persist({ onlineHours: { enabled: next.enabled, timeZone: next.timeZone ?? tz, days: next.days } });
  const setDay = (k: DayKey, patch: Partial<OpeningHours['days'][DayKey]>) => save({ ...hours, timeZone: tz, days: { ...hours.days, [k]: { ...hours.days[k], ...patch } } });
  const copyMonday = () => { const m = hours.days.mon; const days = { ...hours.days }; for (const k of DAY_KEYS) days[k] = { ...m }; save({ ...hours, timeZone: tz, days }); };

  const paused = isPaused(settings.onlinePausedUntil, now);
  const state = openState(hours.enabled ? hours : null, now, { pausedUntil: settings.onlinePausedUntil ?? null });
  const chip = statusChip(state, true);
  const pausedLabel = paused && settings.onlinePausedUntil ? new Date(settings.onlinePausedUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <Card className="space-y-4 p-4" data-opening-hours-card>
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold">Opening hours, pause &amp; links</h3>
        {chip && <Badge variant="outline" data-hours-now={chip.tone} className={cn('ml-auto text-[10px]', chip.tone === 'open' && 'border-emerald-500 text-emerald-700', chip.tone === 'soon' && 'border-amber-500 text-amber-700', chip.tone === 'closed' && 'border-rose-500 text-rose-700')}>Right now: {chip.text}</Badge>}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Outside these hours the website shows “we are closed — we open at …”, the add buttons are greyed out and delivery / pickup orders are refused by the server too.
        A customer sitting at a table (QR code) can still order. Off, or empty, means the website is never closed by the clock.
      </p>

      {/* Pause (busy mode) */}
      <div className={cn('flex flex-wrap items-center gap-2 rounded-xl border p-3', paused ? 'border-amber-400 bg-amber-50 dark:bg-amber-500/10' : 'bg-muted/30')} data-pause-box>
        {paused ? <PauseCircle className="h-5 w-5 text-amber-600" /> : <PlayCircle className="h-5 w-5 text-emerald-600" />}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold">{paused ? `Online orders are paused until ${pausedLabel}` : 'Busy? Pause online orders for a while'}</div>
          <div className="text-[10px] text-muted-foreground">{paused ? closedMessage(state, true) : 'Customers see that you are busy and can order again once the time ends. Staff orders are not affected.'}</div>
        </div>
        {paused ? (
          <Button size="sm" variant="outline" className="h-8 text-[11px]" data-pause-resume onClick={() => persist({ onlinePausedUntil: '' })}>Resume now</Button>
        ) : (
          [15, 30, 60, 120].map(m => (
            <Button key={m} size="sm" variant="outline" className="h-8 text-[11px]" data-pause-minutes={m} onClick={() => persist({ onlinePausedUntil: pauseUntil(new Date(), m) })}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </Button>
          ))
        )}
      </div>

      {/* Weekly schedule */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-bold">
            <input type="checkbox" checked={hours.enabled} onChange={e => save({ ...hours, timeZone: tz, enabled: e.target.checked })} data-hours-enabled className="h-4 w-4 accent-[hsl(var(--primary))]" />
            Use opening hours
          </label>
          <label className="ml-auto flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
            Time zone
            <select value={tz} onChange={e => save({ ...hours, timeZone: e.target.value })} data-hours-zone className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-xs font-normal text-foreground">
              {!zoneList.includes(tz) && <option value={tz}>{tz}</option>}
              {zoneList.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
        </div>
        <div className={cn('divide-y rounded-xl border', !hours.enabled && 'opacity-60')} data-hours-grid>
          {DAY_KEYS.map(k => {
            const d = hours.days[k];
            return (
              <div key={k} className="flex flex-wrap items-center gap-2 px-3 py-2" data-hours-day={k}>
                <span className="w-24 text-xs font-bold">{DAY_NAMES[k]}</span>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input type="checkbox" checked={d.closed} onChange={e => setDay(k, { closed: e.target.checked })} data-hours-closed={k} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" /> Closed
                </label>
                {!d.closed && (
                  <>
                    <Input type="time" value={d.open} onChange={e => e.target.value && setDay(k, { open: e.target.value })} aria-label={`${DAY_NAMES[k]} opens`} data-hours-open={k} className="h-8 w-28 text-xs" />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <Input type="time" value={d.close} onChange={e => e.target.value && setDay(k, { close: e.target.value })} aria-label={`${DAY_NAMES[k]} closes`} data-hours-close={k} className="h-8 w-28 text-xs" />
                    {d.close < d.open && <span className="text-[10px] text-muted-foreground">after midnight — until {formatClock(d.close)} next day</span>}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={copyMonday} data-hours-copy>Copy Monday to every day</Button>
      </div>

      {/* Links */}
      <div className="space-y-2">
        <div className="flex items-center gap-2"><Share2 className="h-3.5 w-3.5 text-primary" /><h4 className="text-xs font-bold">Social links (shown on the About page)</h4></div>
        <div className="grid gap-2 sm:grid-cols-3">
          {([['onlineInstagram', 'Instagram', 'instagram.com/yourpage'], ['onlineFacebook', 'Facebook', 'facebook.com/yourpage'], ['onlineTiktok', 'TikTok', 'tiktok.com/@yourpage']] as const).map(([key, label, ph]) => (
            <div key={key}>
              <label className="text-[11px] font-bold text-muted-foreground">{label}</label>
              <Input value={(settings[key] as string | undefined) || ''} onChange={e => persist({ [key]: e.target.value } as Partial<RestaurantSettings>)} placeholder={ph} data-social={key} className="h-9 text-xs" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Settings → Appearance → Screen (v1.109.0): what this machine measured, and the two choices that are a matter of taste.
// The software adjusts itself to every screen on its own; this card only says what it found and lets the owner override it.
import { useEffect, useState } from 'react';
import { Monitor, RotateCcw, Smartphone, Tablet, Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  measureProfile, readScreenOverride, writeScreenOverride,
  type Density, type ScreenKind, type ScreenOverride, type ScreenProfile,
} from '@/lib/screenProfile';

const KINDS: { value: ScreenKind | 'auto'; label: string; icon: typeof Monitor }[] = [
  { value: 'auto', label: 'Automatic', icon: Monitor },
  { value: 'phone', label: 'Phone', icon: Smartphone },
  { value: 'tablet', label: 'Tablet', icon: Tablet },
  { value: 'desktop', label: 'Desktop', icon: Monitor },
  { value: 'tv', label: 'TV / 4K', icon: Tv },
];
const DENSITIES: { value: Density | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Automatic' }, { value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' },
];

export default function ScreenProfileCard() {
  const [profile, setProfile] = useState<ScreenProfile>(() => measureProfile());
  const [override, setOverride] = useState<ScreenOverride>(() => readScreenOverride());

  useEffect(() => {
    const refresh = () => { setProfile(measureProfile()); setOverride(readScreenOverride()); };
    window.addEventListener('resize', refresh);
    window.addEventListener('dt-screen-override', refresh);
    return () => { window.removeEventListener('resize', refresh); window.removeEventListener('dt-screen-override', refresh); };
  }, []);

  const set = (next: ScreenOverride) => { writeScreenOverride({ ...override, ...next }); };
  const kind = override.kind ?? 'auto';
  const density = override.density ?? 'auto';

  return (
    <div className="bg-card border rounded-xl p-4 space-y-4" data-testid="screen-profile-card">
      <div>
        <h3 className="text-sm font-bold">Screen</h3>
        <p className="text-[11px] text-muted-foreground">
          Every page adjusts itself to the screen it is on — tables, filters, dialogs and tap sizes. This is what this machine measured.
          The choice is kept on this machine only.
        </p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center" data-testid="screen-profile-now">
        {[
          ['Screen', profile.kind], ['Density', profile.density], ['Pointer', profile.pointer === 'coarse' ? 'finger' : 'mouse'],
          ['Window', `${profile.width} px`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border p-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="text-sm font-semibold first-letter:uppercase">{v}</dd></div>
        ))}
      </dl>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold">Screen type</legend>
        <div className="flex flex-wrap gap-2">
          {KINDS.map(k => (
            <Button key={k.value} type="button" size="sm" variant={kind === k.value ? 'default' : 'outline'} aria-pressed={kind === k.value}
              data-testid={`screen-kind-${k.value}`} onClick={() => set({ kind: k.value })}>
              <k.icon className="w-3.5 h-3.5 mr-1" aria-hidden />{k.label}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold">Density</legend>
        <div className="flex flex-wrap gap-2">
          {DENSITIES.map(d => (
            <Button key={d.value} type="button" size="sm" variant={density === d.value ? 'default' : 'outline'} aria-pressed={density === d.value}
              data-testid={`screen-density-${d.value}`} onClick={() => set({ density: d.value })}>{d.label}</Button>
          ))}
        </div>
      </fieldset>

      {(kind !== 'auto' || density !== 'auto') && (
        <Button type="button" size="sm" variant="ghost" onClick={() => writeScreenOverride({ kind: 'auto', density: 'auto' })} data-testid="screen-reset">
          <RotateCcw className="w-3.5 h-3.5 mr-1" aria-hidden />Back to automatic
        </Button>
      )}
    </div>
  );
}

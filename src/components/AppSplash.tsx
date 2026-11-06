// The start screen of the three phone apps (v1.111.0): DT Owner, DT Rider and DT Order Taker each open on their OWN colour, symbol and name —
// never on the software's splash. It is drawn to match the native splash Android shows first (branding/ — same gradient, same tile, same name),
// so the hand-over from the phone's splash to this one is a single picture. The 4-triangle mark appears only small, at the foot.
import { useEffect, useState } from 'react';
import { ClipboardList, Crown, Motorbike, type LucideIcon } from 'lucide-react';
import DtMark from '@/components/DtMark';
import { BRAND, BRAND_APPS } from '@/lib/brand';
import { APP_VERSION } from '@/lib/version';
import type { AppSplashKind } from '@/lib/appEntry';

const GLYPH: Record<AppSplashKind, LucideIcon> = { owner: Crown, rider: Motorbike, 'order-taker': ClipboardList };
const BRAND_ID: Record<AppSplashKind, string> = { owner: 'owner', rider: 'rider', 'order-taker': 'ordertaker' };

export function appBrand(app: AppSplashKind) {
  const b = BRAND_APPS.find(a => a.id === BRAND_ID[app])!;
  return { label: b.label, ...b.accent };
}

/** The picture itself — also used as a loading state inside the app while its data is being read. */
export function AppSplashArt({ app, bar = true, label, attrs }: { app: AppSplashKind; bar?: boolean; label?: string; attrs?: Record<string, string> }) {
  const b = appBrand(app);
  const Glyph = GLYPH[app];
  return (
    <div
      data-app-splash={app}
      role="status"
      aria-label={label ?? `${b.label} is starting`}
      {...attrs}
      className="relative flex h-[100dvh] w-full flex-col items-center justify-center overflow-hidden text-white"
      style={{ background: `linear-gradient(160deg, ${b.light} 0%, ${b.mid} 55%, ${b.dark} 100%)` }}
    >
      <span
        data-app-splash-tile
        className="dt-appsplash-tile grid h-[132px] w-[132px] place-items-center rounded-[36px] bg-white/[0.16] shadow-[0_10px_30px_rgba(0,0,0,0.22),inset_0_0_0_1.5px_rgba(255,255,255,0.18)]"
      >
        <Glyph className="h-[82px] w-[82px]" strokeWidth={2} aria-hidden />
      </span>
      <div className="dt-appsplash-name mt-6 text-[26px] font-bold leading-none tracking-tight">{b.label}</div>
      {bar && (
        <div className="dt-appsplash-bar mt-7 h-[3px] w-40 overflow-hidden rounded-full bg-white/25" aria-hidden><span className="block h-full w-1/3 rounded-full bg-white/90" /></div>
      )}
      <div className="absolute inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] flex items-center justify-center gap-1.5 text-[11px] font-medium opacity-90">
        <DtMark size={14} title={null} /> {BRAND.poweredBy}
        <span className="opacity-60">· v{APP_VERSION}</span>
      </div>
    </div>
  );
}

/** Shown once when the app opens: about a second and a half, a touch skips it. */
export default function AppSplash({ app, onDone, duration = 1500 }: { app: AppSplashKind; onDone: () => void; duration?: number }) {
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setFade(true), Math.max(0, duration - 300));
    const b = setTimeout(onDone, duration);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [duration, onDone]);
  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener('pointerdown', skip);
    return () => window.removeEventListener('pointerdown', skip);
  }, [onDone]);
  return (
    <div className={`fixed inset-0 z-[9999] transition-opacity duration-300 ${fade ? 'opacity-0' : 'opacity-100'}`}>
      <AppSplashArt app={app} />
    </div>
  );
}

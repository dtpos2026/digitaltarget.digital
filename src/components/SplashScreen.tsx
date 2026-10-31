import { useEffect, useState } from 'react';
import { getSettings } from '@/lib/store';
import { APP_VERSION, getInstalledVersion } from '@/lib/version';
import DtMark from '@/components/DtMark';
import { BRAND } from '@/lib/brand';

// The welcome the offline DT POS opens with, on the web and in the Windows app: the active theme's colour, two
// slowly drifting light orbs, the Digital Target mark popping in one triangle at a time, the product name rising,
// the restaurant's name, a thin progress bar with a streak of light, and "Developed by Digital Target · version".
//
// It is made only of the theme's primary colour and the text colour that goes on it (the pair every theme is
// checked on), and the only layer over them darkens. Motion lives in index.css; reduced-motion switches it off.
// Shown once per session. Any key press or click skips it.

interface Props {
  onDone: () => void;
  /** Total time on screen, including the 0.4 s fade. The sequence itself takes about 1.4 s. */
  duration?: number;
}

export default function SplashScreen({ onDone, duration = 1800 }: Props) {
  const [fade, setFade] = useState(false);
  const [appVer, setAppVer] = useState(APP_VERSION);
  useEffect(() => { getInstalledVersion().then(setAppVer).catch(() => {}); }, []);
  const name = (getSettings().name || '').trim();

  useEffect(() => {
    const t1 = setTimeout(() => setFade(true), Math.max(0, duration - 400));
    const t2 = setTimeout(onDone, duration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration, onDone]);

  // Skip: a click, or Enter / Space / Escape. Listening on the window keeps it working before anything has focus.
  useEffect(() => {
    const skip = () => onDone();
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') skip(); };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', skip); window.removeEventListener('keydown', key); };
  }, [onDone]);

  return (
    <div
      data-splash
      role="status"
      aria-label={`${BRAND.product} is starting`}
      className={`dt-splash fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden bg-primary text-primary-foreground transition-opacity duration-[400ms] ${fade ? 'opacity-0' : 'opacity-100'}`}
    >
      <span aria-hidden className="dt-splash-shade" />
      <span aria-hidden className="dt-splash-orb dt-splash-orb-a" />
      <span aria-hidden className="dt-splash-orb dt-splash-orb-b" />

      <div className="dt-splash-card relative z-10 flex flex-col items-center px-6 text-center">
        <DtMark size={96} animate title={null} />
        <h1 className="dt-splash-name">{BRAND.product.toUpperCase()}</h1>
        <p className="dt-splash-tag">{name || 'Smart POS Solutions'}</p>
        <div className="dt-splash-bar" aria-hidden><span /></div>
      </div>

      <div className="dt-splash-foot relative z-10">Developed by {BRAND.name} · v{appVer}</div>
    </div>
  );
}

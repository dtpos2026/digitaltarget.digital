import { BRAND } from '@/lib/brand';

/**
 * What is on screen from the first paint until the app has loaded: the splash's colour and drifting light, a progress
 * bar, and nothing that would animate twice — the mark is left for SplashScreen to pop in. It needs no app code, so it
 * can be the fallback of the route that loads the app. The colour is the restaurant's (see lib/bootTheme).
 */
export default function BootSplash() {
  return (
    <div
      data-boot-splash
      role="status"
      aria-label={`${BRAND.product} is loading`}
      className="dt-splash fixed inset-0 z-[9998] flex flex-col items-center justify-center overflow-hidden bg-primary text-primary-foreground"
    >
      <span aria-hidden className="dt-splash-shade" />
      <span aria-hidden className="dt-splash-orb dt-splash-orb-a" />
      <span aria-hidden className="dt-splash-orb dt-splash-orb-b" />
      <div className="dt-splash-bar dt-splash-bar-boot relative z-10" aria-hidden><span /></div>
    </div>
  );
}

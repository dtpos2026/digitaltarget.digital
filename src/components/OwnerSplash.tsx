// DT Owner — the start screen (OWN-01) and the frame around the Owner app's sign-in (OWN-02, OWN-03), v1.92.0.
// Digital Target purple with the mark and the crown badge. Shown only on the Owner app's route (lib/appEntry.isOwnerAppRoute).
import type { ReactNode } from 'react';
import { Crown } from 'lucide-react';
import DtMark from '@/components/DtMark';
import { BRAND } from '@/lib/brand';
import { APP_VERSION } from '@/lib/version';

const PURPLE = 'linear-gradient(160deg, #3c096c 0%, #5b21b6 100%)';

/** The mark on a rounded tile with the Owner crown at its corner. */
export function OwnerMark({ size = 88 }: { size?: number }) {
  return (
    <span data-owner-mark className="relative inline-flex shrink-0 items-center justify-center bg-white/15 text-white" style={{ width: size, height: size, borderRadius: size * 0.26 }}>
      <DtMark size={Math.round(size * 0.56)} title={null} />
      <span className="absolute -bottom-1.5 -right-1.5 grid place-items-center rounded-full bg-white text-[#5b21b6] shadow" style={{ width: size * 0.36, height: size * 0.36 }}>
        <Crown style={{ width: size * 0.2, height: size * 0.2 }} />
      </span>
    </span>
  );
}

/** OWN-01 — full-bleed purple while the saved session is read. No white flash, no spinner text. */
export default function OwnerSplash() {
  return (
    <div data-owner-splash role="status" aria-label="Loading DT Owner" className="flex h-[100dvh] flex-col items-center justify-center gap-5 text-white" style={{ background: PURPLE }}>
      <OwnerMark />
      <div className="text-center">
        <div className="text-[26px] font-extrabold tracking-tight">DT Owner</div>
        <div className="mt-1 text-[13px] opacity-80">{BRAND.poweredBy}</div>
      </div>
      <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/90 border-t-transparent" />
      <div className="absolute bottom-6 text-[11px] opacity-60">v{APP_VERSION}</div>
    </div>
  );
}

/** OWN-02 / OWN-03 — the sign-in's frame on a phone: the purple header, then the form's own card over it. */
export function OwnerLoginFrame({ children }: { children: ReactNode }) {
  let dark = false;
  try { dark = localStorage.getItem('owner-theme') === 'dark'; } catch { /* light */ }
  return (
    <div data-login-shell data-owner-login className="dt-owner flex min-h-[100dvh] flex-col" data-theme={dark ? 'dark' : 'light'}>
      <header className="flex flex-col items-center gap-3 px-6 pb-14 pt-[calc(2.5rem+env(safe-area-inset-top,0px))] text-center text-white" style={{ background: PURPLE, borderRadius: '0 0 32px 32px' }}>
        <OwnerMark size={72} />
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight">DT Owner</h1>
          <p className="text-[14px] opacity-85">Your restaurants, from anywhere</p>
        </div>
      </header>
      <main className="-mt-8 mx-auto w-full max-w-[440px] flex-1 px-4 pb-6">{children}</main>
      <footer className="px-6 pb-5 text-center text-[12px] text-muted-foreground">{BRAND.poweredBy} · v{APP_VERSION}</footer>
    </div>
  );
}

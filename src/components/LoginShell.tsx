import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Store, Building2, ChefHat, BarChart3, Zap, WifiOff, ShieldCheck, Phone, MessageCircle, Mail } from 'lucide-react';
import DtMark, { DtAppIcon } from '@/components/DtMark';
import BrandLockup from '@/components/BrandLockup';
import { BRAND } from '@/lib/brand';
import { APP_NAME, APP_VERSION, getInstalledVersion } from '@/lib/version';

// The sign-in screen's frame: a brand panel in the active theme's colour on the left, a quiet page with the
// form on the right. It reads only the theme's semantic tokens (primary, background, card, border…), so every
// theme — Modern, DT Retail, dark or light — gets a sign-in that belongs to it. It changes how the screen looks,
// nothing about how anyone signs in.
//
// Everything printed on the brand panel sits on the theme's solid primary colour in the theme's own
// primary-foreground. The only effect laid over it darkens (black at low opacity): the hero banner of v1.68.0
// faded to pale under white text when a gradient lightened, which is why none lightens here.

// Shapes are drawn with a border or a rule in the foreground colour, never a lighter fill: text on the panel then
// keeps exactly the contrast of the theme's own primary / primary-foreground pair (a test checks that pair).
const line = (pct: number): CSSProperties => ({
  borderColor: `color-mix(in srgb, hsl(var(--primary-foreground)) ${pct}%, transparent)`,
});

const CHIPS = [
  { icon: Store, label: 'Restaurant' },
  { icon: Building2, label: 'Multi-Branch' },
  { icon: ChefHat, label: 'Kitchen' },
  { icon: BarChart3, label: 'Reports' },
];

const POINTS = [
  { icon: Zap, label: 'Fast & reliable POS' },
  { icon: WifiOff, label: 'Keeps working offline, syncs when online' },
  { icon: ShieldCheck, label: "Each restaurant's data kept separate" },
  { icon: Building2, label: 'Multi-branch support' },
  { icon: BarChart3, label: 'Real-time reporting' },
];

export function LoginBrandPanel() {
  return (
    <aside
      data-login-brand
      className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-primary text-primary-foreground px-12 py-10"
    >
      <div aria-hidden className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent to-black/15" />

      <div className="relative">
        <BrandLockup size={60} />

        <div className="mt-8 flex items-center gap-3">
          <span className="h-px flex-1 border-t" style={line(40)} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.3em]">Smart POS Solutions</span>
          <span className="h-px flex-1 border-t" style={line(40)} />
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {CHIPS.map(c => (
            <div key={c.label} className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold" style={line(40)}>
              <c.icon className="h-4 w-4 shrink-0" /> {c.label}
            </div>
          ))}
        </div>

        <ul className="mt-9 space-y-4">
          {POINTS.map(p => (
            <li key={p.label} className="flex items-center gap-3 text-[15px] font-semibold">
              <span className="h-9 w-9 shrink-0 rounded-xl border flex items-center justify-center" style={line(40)}>
                <p.icon className="h-4 w-4" />
              </span>
              {p.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative">
        <div className="border-t pt-6" style={line(40)}>
          <div className="text-xl font-bold italic">{BRAND.tagline}</div>
          <p className="mt-1 text-sm font-medium">{BRAND.subtagline}</p>
        </div>
      </div>
    </aside>
  );
}

function VersionLine() {
  const [v, setV] = useState(APP_VERSION);
  useEffect(() => { getInstalledVersion().then(setV).catch(() => {}); }, []);
  return <span data-login-version>{APP_NAME} v{v}</span>;
}

/** `logo` is the restaurant's own logo when it has one; without one the Digital Target app icon is shown. */
export default function LoginShell({ logo, children }: { logo?: string | null; children: ReactNode }) {
  return (
    <div data-login-shell className="min-h-screen grid lg:grid-cols-[44%_1fr] bg-background text-foreground">
      <LoginBrandPanel />

      <main className="flex min-h-screen flex-col">
        <div className="flex flex-1 flex-col justify-center px-6 sm:px-10 py-8 mx-auto w-full max-w-xl">
          <div className="mb-7 flex items-center gap-5">
            {logo ? (
              <span data-login-own-logo className="h-20 w-20 shrink-0 rounded-[22px] bg-card border border-border p-2.5 flex items-center justify-center shadow-sm">
                <img src={logo} alt="Logo" className="h-full w-full object-contain" />
              </span>
            ) : (
              <DtAppIcon size={80} />
            )}
            <div className="leading-tight">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{BRAND.product}</h1>
              <p className="mt-1 text-base text-muted-foreground">{BRAND.poweredBy}</p>
            </div>
          </div>

          {children}
        </div>

        <footer className="border-t border-border px-6 sm:px-10 py-5 text-xs text-muted-foreground">
          <div className="mx-auto w-full max-w-xl grid gap-3 sm:grid-cols-[auto_auto_auto] sm:justify-between whitespace-nowrap">
            <div className="flex items-start gap-2.5">
              <DtMark size={26} title={null} className="mt-0.5 opacity-25" />
              <div>
                <div className="font-semibold text-foreground"><VersionLine /></div>
                <div className="mt-1">© {new Date().getFullYear()} {BRAND.name}</div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5"><Phone className="h-3 w-3" /> {BRAND.phones[0]}</div>
              <div className="flex items-center gap-1.5"><MessageCircle className="h-3 w-3" /> {BRAND.phones[1]}</div>
            </div>
            <div className="inline-flex items-center gap-1.5 self-start"><Mail className="h-3 w-3 shrink-0" /> {BRAND.email}</div>
          </div>
        </footer>
      </main>
    </div>
  );
}

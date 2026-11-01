import { useState, useEffect } from 'react';
import { APP_VERSION, getInstalledVersion } from '@/lib/version';
import { MessageCircle, Mail, Facebook, Instagram } from 'lucide-react';
import logo from '@/assets/digital-target-logo.png';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const BRAND_BG = '#3c096c';

const LINKS = [
  { icon: MessageCircle, label: 'WhatsApp +92 345 1873354', href: 'https://wa.me/923451873354' },
  { icon: MessageCircle, label: 'WhatsApp +92 332 2373354', href: 'https://wa.me/923322373354' },
  { icon: Mail,          label: 'digitaltarget.digital@gmail.com', href: 'mailto:digitaltarget.digital@gmail.com' },
  { icon: Facebook,      label: 'Facebook',  href: 'https://web.facebook.com/digitaltargetpk/' },
  { icon: Instagram,     label: 'Instagram', href: 'https://www.instagram.com/digitaltarget_pk' },
];

function openExternal(href: string) {
  try {
    const api: any = (window as any).electronAPI;
    if (api?.openExternal) { api.openExternal(href); return; }
  } catch {}
  window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * The small credit used by the Modern sidebar (ported from the offline POS): the restaurant's own name and logo lead,
 * and this is one quiet line at the bottom. The contact links are the same ones as the full panel, one click away.
 */
function PoweredByCredit({ collapsed, retail = false, version }: { collapsed: boolean; retail?: boolean; version: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {retail ? (
          // DT Retail look: the lockup card — mark, wordmark, "Powered by" and the version.
          <button type="button" data-dtr="powered" title="Software by Digital Target" aria-label="Powered by Digital Target" className={collapsed ? 'justify-center' : ''}>
            <img src={logo} alt="" className="h-7 w-7 shrink-0 object-contain" />
            {!collapsed && (
              <>
                <span className="text-[9px] font-black uppercase leading-[1.05] tracking-[0.12em]">Digital<br />Target</span>
                <span className="ml-auto min-w-0 text-right">
                  <small>Powered by</small>
                  <span className="block truncate text-[12px] font-bold leading-tight">Digital Target</span>
                  <small style={{ letterSpacing: 0 }}>v{version}</small>
                </span>
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            title="Software by Digital Target"
            aria-label="Powered by Digital Target"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${collapsed ? 'justify-center' : ''}`}
          >
            <img src={logo} alt="" className="h-5 w-5 shrink-0 rounded object-contain" />
            {!collapsed && (
              <span className="truncate text-[11px] font-medium">
                Powered by <span className="font-bold text-foreground">Digital Target</span>
              </span>
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-64 p-2">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Digital Target — support</div>
        {LINKS.map((l, i) => {
          const Icon = l.icon;
          return (
            <button
              key={i}
              type="button"
              onClick={() => openExternal(l.href)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium hover:bg-accent"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{l.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export default function PoweredByBrand({ collapsed = false, variant = 'panel' }: { collapsed?: boolean; variant?: 'panel' | 'credit' | 'retail' }) {
  // Inside Electron the installed EXE version wins; on web it's the build value.
  const [appVer, setAppVer] = useState(APP_VERSION);
  useEffect(() => { getInstalledVersion().then(setAppVer).catch(() => {}); }, []);
  if (variant === 'credit') return <PoweredByCredit collapsed={collapsed} version={appVer} />;
  if (variant === 'retail') return <PoweredByCredit collapsed={collapsed} retail version={appVer} />;
  return (
    <div
      className="dt-powered rounded-lg p-2 text-white shadow-md"
      style={{ background: BRAND_BG }}
      title="Software by Digital Target"
    >
      <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
        <img src={logo} alt="Digital Target" className="h-7 w-7 rounded bg-white/10 p-0.5 object-contain shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider opacity-70 leading-none">Powered by</div>
            <div className="text-[12px] font-bold leading-tight truncate">Digital Target</div>
            {/* v1.4.0 — running version, read from the real build (never a
                hardcoded string), so support always sees the true number. */}
            <div className="text-[9px] opacity-70 leading-tight truncate font-mono">v{appVer}</div>
          </div>
        )}
      </div>
      {!collapsed && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {LINKS.map((l, i) => {
            const Icon = l.icon;
            return (
              <button
                key={i}
                onClick={() => openExternal(l.href)}
                title={l.label}
                className="h-6 w-6 rounded flex items-center justify-center bg-white/10 hover:bg-white/25 transition-colors"
              >
                <Icon className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

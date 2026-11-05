// ============================================================
// SETTINGS → THEME → INTERFACE STYLE
//
// Modern (the new look, with twelve themes) or Classic (the previous look, with
// its own colour themes below). All of it is a device-local presentation
// choice (src/lib/uiStyle, src/lib/uiThemes). Nothing here can touch data,
// the licence, users, permissions, orders, inventory, reports or printer
// configuration, and the card says so.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Check, History, Lock, Palette, RotateCcw, RotateCw, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  ACCENT_PRESETS, MIN_ACCENT_CONTRAST, RETAIL_THEMES, UI_THEMES, clearAccent, contrastWithWhite, hexToHsl, hslToHex, resolveAccent,
  REFINED_SURFACES, resolveLook, restorePreviousLook, setAccent, setAnimations, setRefinedSurface, setTheme, setUiStyle, useAccentOverride,
  useAnimations, usePreviousLook, useRefinedSurface, useThemeId, useUiLook, useUiStyle, type RefinedSurface, type UiStyle,
} from '@/lib/uiStyle';
import type { UiTheme } from '@/lib/uiThemes';
import { DEFAULT_THEME_ID, DESIGN_THEMES, INK_ON_ACCENT, REFINED_THEME_ID, isRefinedTheme } from '@/lib/uiThemes';
import { canRestartApp, restartApp } from '@/lib/appRestart';
import { ThemePreview } from '@/components/settings/ThemePreview';
import CustomThemeManager from '@/components/settings/CustomThemeManager';
import { getCustomThemeDefs } from '@/lib/customTheme';
import { isCustomTheme } from '@/lib/uiThemes';
import { isPremiumThemeAllowed } from '@/lib/premiumTheme';
import { onDataChange } from '@/lib/store';
import { REFINED_SCHEMES, applyRefinedScheme, type RefinedScheme } from '@/lib/refinedSchemes';

export { ThemePreview };

type Choice = 'refined' | UiStyle;

export { REFINED_SCHEMES };
const STYLES: { id: Choice; name: string; blurb: string }[] = [
  { id: 'refined', name: 'DT Refined', blurb: 'The DT design package: white grouped sidebar, lavender page, DT purple, the new dashboard. Open to every restaurant. Recommended.' },
  { id: 'modern', name: 'Modern', blurb: 'Light, calm and quick to scan. Short menu with a “More” launcher. Thirteen themes, plus the seven DT Retail looks.' },
  { id: 'classic', name: 'DT Enterprise (Classic)', blurb: 'The signature DT Enterprise look and the full menu, with its own colour themes below.' },
];

const hsl = (t: string) => `hsl(${t})`;

/** A few lines of fake UI drawn in the style's own colours — a preview, not a screenshot. */
function ClassicPreview() {
  return (
    <div className="flex h-[88px] overflow-hidden rounded-lg border" aria-hidden>
      <div className="w-10 shrink-0 space-y-1.5 bg-[#3c096c] p-2">
        {[0, 1, 2, 3].map(i => <div key={i} className={cn('h-1.5 rounded-full', i === 0 ? 'bg-[#e0aaff]' : 'bg-white/35')} />)}
      </div>
      <div className="flex-1 space-y-2 bg-[#f7f3fc] p-2.5">
        <div className="h-2 w-1/2 rounded-full bg-[#3c096c]/70" />
        <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2].map(i => <div key={i} className="h-8 rounded bg-white ring-1 ring-[#3c096c]/15" />)}</div>
      </div>
    </div>
  );
}

function ThemeGrid({ themes, label, themeId, onPick }: {
  themes: UiTheme[]; label: string; themeId: string; override?: string | null; onPick: (t: UiTheme) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label={label}>
      {themes.map(t => {
        const on = t.id === themeId;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${t.name}. ${t.tagline}`}
            data-theme-id={t.id}
            onClick={() => onPick(t)}
            className={cn(
              'flex h-full flex-col gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
              on ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'hover:border-primary/40',
            )}
          >
            <ThemePreview theme={t} />
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="flex items-center gap-2 text-[13.5px] font-bold">
                {t.swatches ? (
                  <span className="flex shrink-0 overflow-hidden rounded-full ring-1 ring-black/10" aria-hidden>
                    {t.swatches.map((c, i) => <span key={i} className="h-3.5 w-3" style={{ background: c }} />)}
                  </span>
                ) : (
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ background: `hsl(${t.accent.h} ${t.accent.s}% ${t.accent.l}%)` }}
                    aria-hidden
                  />
                )}
                {t.name}
              </span>
              {on && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"><Check className="h-3 w-3" /> In use</span>}
            </div>
            <p className="px-0.5 text-[12px] leading-snug text-muted-foreground">{t.tagline}</p>
          </button>
        );
      })}
    </div>
  );
}

/** Super Admin allots the Modern style, its 13 + 8 themes and Custom themes per restaurant (Feature Access). */
function usePremiumAllowed(): boolean {
  const [, tick] = useState(0);
  useEffect(() => onDataChange(c => { if (c === 'settings' || c === '*') tick(t => t + 1); }), []);
  return isPremiumThemeAllowed();
}

export default function InterfaceStyleCard() {
  const allowed = usePremiumAllowed();
  const style = useUiStyle();
  const themeId = useThemeId();
  const override = useAccentOverride();
  const uiLook = useUiLook();
  const animations = useAnimations();
  const previous = usePreviousLook();
  const look = resolveLook(themeId, override);
  // Theme families: Modern themes, DT Retail themes and Custom (designed in Settings). Classic is the other style above.
  const [family, setFamily] = useState<'modern' | 'retail' | 'custom'>(() => (isCustomTheme(themeId) ? 'custom' : uiLook === 'retail' ? 'retail' : 'modern'));
  const customCount = useMemo(() => getCustomThemeDefs().length, [themeId, family]); // eslint-disable-line react-hooks/exhaustive-deps
  const [custom, setCustom] = useState(() => (override && override.startsWith('#') ? override : ''));
  const customHsl = hexToHsl(custom);
  const customContrast = customHsl ? contrastWithWhite(customHsl) : null;

  const refinedSurface = useRefinedSurface();
  const choice: Choice = style === 'modern' && isRefinedTheme(themeId) ? 'refined' : style;
  // A ready-made scheme sets the page colour and the accent together.
  const pickScheme = (sc: RefinedScheme) => {
    applyRefinedScheme(sc);
    setCustom('');
    toast.success(`${sc.name} colour scheme is on`);
  };
  const pickStyle = (next: Choice) => {
    if (next === choice) return;
    if (next === 'refined') {
      // The design package's own theme: no premium allotment needed.
      setTheme(REFINED_THEME_ID);
      setUiStyle('modern');
      toast.success('DT Refined is on — the DT design package look');
      return;
    }
    if (next === 'modern' && !allowed) {
      toast.error('🔒 The Modern look and its themes are a premium feature — ask Super Admin to allot it to this restaurant (digitaltarget.digital@gmail.com)');
      return;
    }
    // Leaving DT Refined for Modern: start from the default Modern theme (otherwise the look would not change).
    if (next === 'modern' && isRefinedTheme(themeId)) setTheme(DEFAULT_THEME_ID);
    setUiStyle(next);
    toast.success(next === 'modern' ? 'Modern look is on' : 'DT Enterprise look is back — nothing else changed');
  };

  const pickTheme = (t: UiTheme) => {
    if (t.id === themeId && !override) return;
    if (!allowed && !isRefinedTheme(t.id)) {
      toast.error('🔒 This theme is part of the premium set — ask Super Admin to allot it. DT Refined is open to everyone.');
      return;
    }
    setTheme(t.id);
    setCustom('');
    toast.success(`${t.name} theme is on`);
  };

  const applyCustom = () => {
    if (!customHsl) { toast.error('Enter a colour like #d9480f'); return; }
    setAccent(custom.startsWith('#') ? custom.toLowerCase() : `#${custom.toLowerCase()}`);
    if (customContrast != null && customContrast < MIN_ACCENT_CONTRAST) toast.info('Made a little darker so white text on it stays readable');
  };

  // The "use my own accent colour" control: the same one for Modern and for DT Refined.
  const accentChooser = (
    <details className="group rounded-lg border bg-muted/30 p-3" open={!!override}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-bold">
        <span>Use my own accent colour <span className="font-medium text-muted-foreground">(optional)</span></span>
        {override && <span className="text-[12px] font-medium text-muted-foreground">In use: <span className="font-mono font-bold">{hslToHex(look.accent)}</span></span>}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[12.5px] text-muted-foreground">Keeps the theme’s surfaces and changes only the buttons and highlights.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
          {ACCENT_PRESETS.map(p => {
            const hex = hslToHex(resolveAccent(p.id));
            const on = override === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                title={p.name}
                onClick={() => { setAccent(p.id); setCustom(''); }}
                className={cn('flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-[12.5px] font-semibold transition-colors', on ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: hex }}>{on && <Check className="h-3.5 w-3.5" />}</span>
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[12.5px] font-semibold text-muted-foreground" htmlFor="accent-hex">Or a custom colour</label>
          <input
            id="accent-hex"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            placeholder="#d9480f"
            maxLength={7}
            className="h-9 w-28 rounded-[10px] border border-input bg-background px-3 font-mono text-[13px] outline-none focus:border-primary/60"
            onKeyDown={e => { if (e.key === 'Enter') applyCustom(); }}
          />
          <Button type="button" size="sm" variant="outline" onClick={applyCustom} disabled={!customHsl}>Use this colour</Button>
          {override && (
            <Button type="button" size="sm" variant="ghost" onClick={() => { clearAccent(); setCustom(''); toast.success('Back to the theme’s own colour'); }}>
              <RotateCcw className="h-4 w-4" /> Use the theme’s colour
            </Button>
          )}
        </div>
      </div>
    </details>
  );

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5" data-testid="interface-style-card">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary"><Palette className="h-5 w-5" /></span>
        <div>
          <h3 className="text-[15px] font-bold tracking-tight">Interface style</h3>
          <p className="text-[12.5px] text-muted-foreground">How the software looks. This changes appearance only, on this computer.</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Interface style">
        {STYLES.map(s => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={choice === s.id}
            data-style-choice={s.id}
            onClick={() => pickStyle(s.id)}
            className={cn(
              'space-y-3 rounded-xl border p-3 text-left transition-colors',
              choice === s.id ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'hover:border-primary/40',
            )}
          >
            {s.id === 'modern' && !allowed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground"><Lock className="h-3 w-3" /> Premium — locked</span>
            )}
            {s.id === 'classic' ? <ClassicPreview />
              : s.id === 'refined' ? <ThemePreview theme={DESIGN_THEMES[0]} accent="#5b21b6" onAccent="#fff" />
              : <ThemePreview theme={look.theme} accent={hslToHex(look.accent)} onAccent={look.darkOnAccent ? hsl(INK_ON_ACCENT) : '#fff'} />}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-bold">{s.name}</span>
              {choice === s.id && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"><Check className="h-3 w-3" /> In use</span>}
            </div>
            <p className="text-[12.5px] text-muted-foreground">{s.blurb}</p>
          </button>
        ))}
      </div>

      {choice === 'modern' && (
        <div className="space-y-5 border-t pt-4">
          <div>
            <div className="text-[13px] font-bold">Theme manager</div>
            <p className="text-[12.5px] text-muted-foreground">
              Every theme runs the same software — only the look changes. Pick a family, then a theme. You can also design your own.
            </p>
          </div>
          <div role="tablist" aria-label="Theme family" className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1">
            {([
              ['modern', 'Modern themes', UI_THEMES.length],
              ['retail', 'DT Retail', RETAIL_THEMES.length],
              ['custom', 'Custom', customCount],
            ] as const).map(([id, name, count]) => (
              <button
                key={id} type="button" role="tab" aria-selected={family === id} onClick={() => setFamily(id)}
                className={cn('flex-1 rounded-lg px-3 py-2 text-[13px] font-bold transition-colors sm:flex-none', family === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {name} <span className="font-medium text-muted-foreground">· {count}</span>
              </button>
            ))}
          </div>

          {family === 'modern' && (
            <div className="space-y-3">
              <div>
                <div className="text-[13px] font-bold">Theme</div>
                <p className="text-[12.5px] text-muted-foreground">
                  Pick the look that suits your restaurant — red, orange, green, yellow, white, coffee brown and more. A theme sets the colours of the whole screen.
                </p>
              </div>
              <ThemeGrid themes={UI_THEMES} label="Theme" themeId={themeId} override={override} onPick={pickTheme} />
            </div>
          )}

          {family === 'retail' && (
            <div className="space-y-3" data-testid="dt-retail-section">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-[13px] font-bold"><Sparkles className="h-4 w-4 text-primary" /> DT Retail themes</div>
                  <p className="text-[12.5px] text-muted-foreground">
                    The look of the DT Retail design guide: a gradient sidebar, a greeting banner on the dashboard, colour tiles on the sale screen and smooth motion.
                    Two of them (Black &amp; Gold, Night) are dark.
                  </p>
                </div>
                {uiLook === 'retail' && previous && (
                  <Button
                    type="button" size="sm" variant="outline"
                    onClick={() => { if (restorePreviousLook()) toast.success('Your previous look is back'); }}
                  >
                    <History className="h-4 w-4" /> Back to my previous look
                  </Button>
                )}
              </div>
              <ThemeGrid themes={RETAIL_THEMES} label="DT Retail theme" themeId={themeId} override={override} onPick={pickTheme} />
              <label className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                <span>
                  <span className="block text-[13px] font-bold">Smooth animations</span>
                  <span className="block text-[12px] text-muted-foreground">Page and dialog transitions, the welcome screen and the login. Turn off on slow computers.</span>
                </span>
                <Switch checked={animations} onCheckedChange={v => setAnimations(!!v)} aria-label="Smooth animations" />
              </label>
            </div>
          )}

          {family === 'custom' && <CustomThemeManager />}

          {accentChooser}
        </div>
      )}

      {choice === 'refined' && (
        <div className="space-y-5 border-t pt-4" data-testid="refined-schemes">
          <div>
            <div className="text-[13px] font-bold">Colour scheme</div>
            <p className="text-[12.5px] text-muted-foreground">
              DT Refined keeps its layout and changes its colours. Pick a ready-made scheme, or set the page colour and your own accent below.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Colour scheme">
            {REFINED_SCHEMES.map(sc => {
              const surf = REFINED_SURFACES.find(x => x.id === sc.surface)!;
              const on = refinedSurface === sc.surface && (sc.accent ? (override || '').toLowerCase() === sc.accent : !override);
              return (
                <button
                  key={sc.id} type="button" role="radio" aria-checked={on} data-scheme={sc.id}
                  onClick={() => pickScheme(sc)}
                  className={cn('space-y-2 rounded-xl border p-3 text-left transition-colors', on ? 'border-primary bg-primary/5 ring-2 ring-primary/25' : 'hover:border-primary/40')}
                >
                  <div className="flex h-14 overflow-hidden rounded-lg border" style={{ background: surf.page }} aria-hidden>
                    <div className="w-1/4" style={{ background: surf.card, borderRight: `1px solid ${surf.ink}22` }} />
                    <div className="flex flex-1 flex-col justify-center gap-1.5 px-2">
                      <div className="h-2 w-3/4 rounded" style={{ background: surf.ink, opacity: .75 }} />
                      <div className="h-3 w-1/2 rounded" style={{ background: sc.accent || '#5b21b6' }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold">{sc.name}</span>
                    {on && <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"><Check className="h-3 w-3" /> In use</span>}
                  </div>
                  <p className="text-[12px] text-muted-foreground">{sc.blurb}</p>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <div className="text-[13px] font-bold">Page colour</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Page colour">
              {REFINED_SURFACES.map(x => (
                <button
                  key={x.id} type="button" role="radio" aria-checked={refinedSurface === x.id} data-surface={x.id} title={x.blurb}
                  onClick={() => { setRefinedSurface(x.id); toast.success(`${x.name} page colour is on`); }}
                  className={cn('flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-3 text-[12.5px] font-semibold transition-colors', refinedSurface === x.id ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full border" style={{ background: x.page }}>{refinedSurface === x.id && <Check className="h-3.5 w-3.5" style={{ color: x.ink }} />}</span>
                  {x.name}
                </button>
              ))}
            </div>
          </div>
          {accentChooser}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 p-3">
        <div className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-success))]" />
          <span>Changes apply immediately and can be reversed any time. Your data, licence, users, permissions, orders, inventory, reports and printer settings are never touched.</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            toast.message('Restarting… everything is saved first');
            await restartApp();
          }}
          title={canRestartApp() ? 'Restart the application' : 'Reload the screen'}
        >
          <RotateCw className="h-4 w-4" /> {canRestartApp() ? 'Restart application' : 'Reload screen'}
        </Button>
      </div>
    </div>
  );
}

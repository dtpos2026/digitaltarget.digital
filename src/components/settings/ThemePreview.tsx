// A theme in miniature: sidebar, page, tiles and an accent button, drawn in the theme's own colours.
import { cn } from '@/lib/utils';
import type { UiTheme } from '@/lib/uiThemes';
import { INK_ON_ACCENT } from '@/lib/uiThemes';

const hsl = (t: string) => `hsl(${t})`;

/** The whole POS in miniature, in one theme's colours: sidebar, page, tiles, and an accent button. */
export function ThemePreview({ theme, accent, onAccent }: { theme: UiTheme; accent?: string; onAccent?: string }) {
  const s = theme.surface;
  const a = accent || `hsl(${theme.accent.h} ${theme.accent.s}% ${theme.accent.l}%)`;
  const on = onAccent || (theme.onAccent === 'dark' ? hsl(INK_ON_ACCENT) : '#fff');
  const dark = theme.sidebar === 'dark';
  const sb = dark ? hsl(theme.sidebarColor || '24 15% 11%') : '#fff';
  const retail = theme.family === 'retail';
  const panel = s.card ? hsl(s.card) : '#fff';
  const sbBg = retail && theme.sidebarGradient ? `linear-gradient(180deg, ${hsl(theme.sidebarGradient[0])}, ${hsl(theme.sidebarGradient[1])})` : sb;
  return (
    <div className="flex h-[88px] overflow-hidden rounded-lg border" style={{ borderColor: hsl(s.border) }} aria-hidden>
      <div className="flex w-9 shrink-0 flex-col gap-1.5 p-1.5" style={{ background: sbBg, borderRight: `1px solid ${dark ? 'transparent' : hsl(s.border)}` }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-1.5 rounded-full" style={{ background: i === 0 ? a : dark ? 'rgba(255,255,255,.28)' : hsl(s.border) }} />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2" style={{ background: hsl(s.background) }}>
        {retail && theme.hero && (
          <div className="h-3 rounded-md" style={{ background: `linear-gradient(100deg, ${hsl(theme.hero[0])}, ${hsl(theme.hero[1])})` }} />
        )}
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1/3 rounded-full" style={{ background: hsl(s.foreground), opacity: 0.7 }} />
          <div className="ml-auto grid h-3 w-8 place-items-center rounded-full text-[6px] font-bold" style={{ background: a, color: on }}>PAY</div>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="flex flex-col justify-end gap-0.5 rounded-md p-1 shadow-sm" style={{ background: panel, border: `1px solid ${hsl(s.border)}` }}>
              <div className="h-1 rounded-full" style={{ background: hsl(s.mutedForeground), opacity: 0.5 }} />
              <div className="h-1 w-1/2 rounded-full" style={{ background: a }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';

/**
 * The header's live clock. Its own component, so the once-a-second tick
 * re-renders this pill only — it used to re-render the whole layout, the
 * print host and the slip being printed with it, every second.
 */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "05:06 pm" and "Wed, 07 Oct 2026" — the Espresso Orange header. */
export function stackedClockText(d: Date): { time: string; date: string } {
  const h = d.getHours();
  return {
    time: `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`,
    date: `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
}

export default function HeaderClock({ variant = 'classic' }: { variant?: 'classic' | 'modern' | 'stacked' }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  if (variant === 'stacked') {
    const t = stackedClockText(now);
    return (
      <div data-clock="stacked" className="hidden shrink-0 flex-col items-end whitespace-nowrap px-1 leading-tight lg:flex" title={now.toLocaleString()}>
        <span dir="ltr" className="text-[15px] font-bold tabular-nums text-foreground">{t.time}</span>
        <span dir="ltr" className="text-[12.5px] text-muted-foreground">{t.date}</span>
      </div>
    );
  }
  if (variant === 'modern') {
    return (
      <div className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border bg-card px-3 py-1.5 lg:flex" title={now.toLocaleString()}>
        <span dir="ltr" className="font-mono text-[12.5px] font-bold tabular-nums text-foreground">{time}</span>
        <span className="h-3 w-px bg-border" />
        <span dir="ltr" className="text-[12px] font-semibold text-muted-foreground">{date}</span>
      </div>
    );
  }
  return (
    <div className="hidden md:flex items-center gap-2 whitespace-nowrap bg-sidebar-foreground/10 border border-sidebar-foreground/20 rounded-md px-2.5 py-1 shadow-inner" title={now.toLocaleString()}>
      <span dir="ltr" className="text-[11px] font-bold font-mono text-sidebar-foreground tabular-nums tracking-wider">{time}</span>
      {/* On a small screen the date gives way rather than wrapping the header onto three lines. */}
      <span className="hidden lg:block h-3 w-px bg-sidebar-foreground/30" />
      <span dir="ltr" className="hidden lg:inline text-[10px] font-semibold text-sidebar-foreground/85 tracking-wide">{date}</span>
    </div>
  );
}

// The Digital Target mark: four right triangles, one in each quarter of a square.
// Drawn as SVG so it stays sharp at any size and takes whatever colour the caller sets
// (`currentColor`): white on a brand panel, the theme's foreground on its primary colour,
// purple on an invoice. One mark for the sign-in, the owner portal, the invoices and the
// app icons, so the brand looks the same wherever it appears.
import { BRAND, MARK_TRIANGLES } from '@/lib/brand';

interface Props {
  size?: number;
  className?: string;
  /** Read by assistive technology; decorative uses pass `title={null}`. */
  title?: string | null;
  /** Pop the four triangles in one after another (the splash). The motion lives in index.css and stops for reduced-motion. */
  animate?: boolean;
}


export default function DtMark({ size = 48, className, title = BRAND.name, animate = false }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 2 2"
      role={title ? 'img' : undefined}
      aria-label={title ?? undefined}
      aria-hidden={title ? undefined : true}
      className={className}
      fill="currentColor"
      data-dt-mark
    >
      {MARK_TRIANGLES.map((points, i) => (
        <polygon
          key={points}
          points={points}
          className={animate ? 'dt-mark-tri' : undefined}
          style={animate ? { animationDelay: `${(0.1 + i * 0.2).toFixed(1)}s` } : undefined}
        />
      ))}
    </svg>
  );
}

/** The app icon: the mark on a squircle in the theme's primary colour (the sign-in header, the owner portal). */
export function DtAppIcon({ size = 80, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      data-dt-app-icon
      className={`inline-flex shrink-0 items-center justify-center bg-primary text-primary-foreground shadow-sm ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
    >
      <DtMark size={Math.round(size * 0.56)} title={null} />
    </span>
  );
}

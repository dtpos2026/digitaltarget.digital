import DtMark from '@/components/DtMark';
import { BRAND } from '@/lib/brand';

/**
 * The Digital Target lockup: the mark and DIGITAL / TARGET in two lines, in `currentColor` — white on a brand
 * colour, the brand purple on white. Mark and wordmark sit directly on the surface, never on a tile.
 * `size` is the mark's size; the wordmark follows it.
 *
 * Inline styles, not utility classes: the invoice prints through a bare window that carries none of the app's CSS.
 */
export default function BrandLockup({ size = 60, className = '' }: { size?: number; className?: string }) {
  return (
    <div data-brand-lockup className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.27 }}>
      <DtMark size={size} title={null} />
      <div style={{ lineHeight: 1, fontWeight: 600, letterSpacing: '0.025em', fontSize: size * 0.47 }}>
        <div>{BRAND.wordmark[0]}</div>
        <div style={{ marginTop: size * 0.03 }}>{BRAND.wordmark[1]}</div>
      </div>
    </div>
  );
}

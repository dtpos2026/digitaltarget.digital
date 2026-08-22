// Drop-in <img> replacement with IndexedDB cache + clean fallback card.
// - First load: serves https URL, caches blob in IndexedDB
// - Next load: instant blob URL
// - On error / missing src: shows colored card with first letter of `alt`
//   (KFC/McDonald's style) instead of ugly broken-image icon.
import { useEffect, useState, ImgHTMLAttributes } from 'react';
import { getCachedImageUrl, getCachedImageUrlSync } from '@/lib/imageCache';

type Props = ImgHTMLAttributes<HTMLImageElement> & { src?: string; fallbackLabel?: string };

// Stable color from string — same name always same color.
function colorFor(text: string): string {
  const palette = ['#dc2626','#ea580c','#d97706','#65a30d','#0d9488','#0284c7','#4f46e5','#9333ea','#c026d3','#db2777'];
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function CachedImage({ src, alt, fallbackLabel, className, style, ...rest }: Props) {
  const initial = src ? getCachedImageUrlSync(src) : '';
  const [resolved, setResolved] = useState<string>(initial);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
    if (!src) { setResolved(''); return; }
    let cancelled = false;
    const fast = getCachedImageUrlSync(src);
    setResolved(fast);
    if (fast === src) {
      getCachedImageUrl(src).then(u => { if (!cancelled) setResolved(u); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [src]);

  if (!src || errored) {
    const label = (fallbackLabel ?? alt ?? '?').trim() || '?';
    const letter = label.charAt(0).toUpperCase();
    const bg = colorFor(label);
    return (
      <div
        role="img"
        aria-label={alt}
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `linear-gradient(135deg, ${bg}, ${bg}dd)`,
          color: '#fff',
          fontWeight: 700,
          fontSize: '1.6em',
          letterSpacing: '0.02em',
          textShadow: '0 1px 2px rgba(0,0,0,0.25)',
          userSelect: 'none',
          ...style,
        }}
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      {...rest}
      alt={alt}
      loading={rest.loading ?? 'lazy'}
      decoding={rest.decoding ?? 'async'}
      className={className}
      style={style}
      src={resolved || src}
      onError={() => setErrored(true)}
    />
  );
}

// Renders a support-chat attachment. Stored value may be a private bucket
// path (new) or a full URL (legacy) — both are handled here.
import { useEffect, useState } from 'react';
import { resolveAttachmentUrl } from '@/lib/support';

export default function SupportImage({ src, className }: { src: string; className?: string }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    resolveAttachmentUrl(src).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [src]);

  if (!url) {
    return <div className={`rounded-lg border bg-muted/50 h-24 w-32 animate-pulse ${className || ''}`} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt="Support attachment" loading="lazy" className={className} />
    </a>
  );
}

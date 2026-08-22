// Super Admin → Branding: upload signature image used on Invoice PDF.
// Saved to localStorage (key: dt-admin-signature) — auto-injected by InvoicePreviewDialog.
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileSignature, Upload, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export const SIG_KEY = 'dt-admin-signature';

export function getAdminSignature(): string | null {
  try { return localStorage.getItem(SIG_KEY); } catch { return null; }
}

export default function BrandSignaturePanel() {
  const [sig, setSig] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSig(getAdminSignature()); }, []);

  const onFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 500 * 1024) { toast.error('Max 500 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      try { localStorage.setItem(SIG_KEY, url); void import('@/lib/cloudDocs').then(m => m.mirrorValue(SIG_KEY, url)); setSig(url); toast.success('Signature saved'); }
      catch { toast.error('Save failed'); }
    };
    reader.readAsDataURL(f);
  };

  const clear = () => {
    try { localStorage.removeItem(SIG_KEY); setSig(null); toast.success('Signature removed'); } catch {}
  };

  return (
    <div className="border rounded-xl p-4 bg-card/50 space-y-3">
      <div className="flex items-center gap-2">
        <FileSignature className="h-5 w-5 text-violet-600" />
        <div>
          <div className="font-extrabold text-sm">Invoice Signature Image</div>
          <div className="text-[11px] text-muted-foreground">Transparent PNG or JPG. This signature is placed at the bottom of every invoice.</div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {sig ? (
          <div className="border rounded-lg p-2 bg-white">
            <img src={sig} alt="signature" style={{ height: 64, maxWidth: 220, objectFit: 'contain' }} />
          </div>
        ) : (
          <div className="border border-dashed rounded-lg p-3 text-xs text-muted-foreground italic">No signature uploaded</div>
        )}
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0] || null)} />
          <Button size="sm" onClick={() => fileRef.current?.click()} className="bg-violet-600 hover:bg-violet-700 text-white">
            <Upload className="h-3.5 w-3.5 mr-1" /> {sig ? 'Replace' : 'Upload'}
          </Button>
          {sig && (
            <Button size="sm" variant="outline" className="text-red-600" onClick={clear}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

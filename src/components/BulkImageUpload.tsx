// Bulk Image Upload — multi-file or ZIP, auto-match to items by name/SKU/filename,
// compress to <500KB, upload to Firebase Storage, write URL on menu item.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Images, Upload, FileArchive, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import JSZip from 'jszip';
import imageCompression from 'browser-image-compression';
import { uploadTenantImage } from '@/lib/storage';
import { saveMenuItem, saveInventoryItem } from '@/lib/store';
import type { MenuItem, InventoryItem } from '@/lib/types';

interface Props {
  items: MenuItem[];
  inventory?: InventoryItem[];
  onClose: () => void;
  onSaved: () => void;
}

interface PendingImage {
  id: string;
  file: File;
  originalName: string;
  cleanedName: string;
  matchedItemId?: string;
  matchedKind?: 'menu' | 'inventory';
  preview: string;
}

function clean(s: string): string {
  return s.toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')        // strip extension
    .replace(/[_\-\s]+/g, ' ')           // normalize separators
    .replace(/[^a-z0-9 ]/g, '')          // strip punctuation
    .trim();
}

export default function BulkImageUpload({ items, inventory = [], onClose, onSaved }: Props) {
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Build lookup index across menu items + inventory
  const lookup = useMemo(() => {
    const byClean = new Map<string, { id: string; kind: 'menu' | 'inventory' }>();
    const bySku = new Map<string, { id: string; kind: 'menu' | 'inventory' }>();
    items.forEach(it => {
      byClean.set(clean(it.name), { id: it.id, kind: 'menu' });
      if ((it as any).sku) bySku.set(String((it as any).sku).toLowerCase(), { id: it.id, kind: 'menu' });
      if ((it as any).code) bySku.set(String((it as any).code).toLowerCase(), { id: it.id, kind: 'menu' });
    });
    inventory.forEach(iv => {
      const k = clean(iv.name);
      if (!byClean.has(k)) byClean.set(k, { id: iv.id, kind: 'inventory' });
      if (iv.sku) bySku.set(String(iv.sku).toLowerCase(), { id: iv.id, kind: 'inventory' });
    });
    return { byClean, bySku };
  }, [items, inventory]);

  const matchOne = (name: string): { id: string; kind: 'menu' | 'inventory' } | undefined => {
    const c = clean(name);
    if (lookup.byClean.has(c)) return lookup.byClean.get(c);
    const raw = name.toLowerCase().replace(/\.[a-z0-9]+$/i, '');
    if (lookup.bySku.has(raw)) return lookup.bySku.get(raw);
    for (const [k, v] of lookup.byClean.entries()) {
      if (c && (k.includes(c) || c.includes(k))) return v;
    }
    return undefined;
  };

  const addFiles = async (files: File[]) => {
    const next: PendingImage[] = [];
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.zip')) {
        try {
          const zip = await JSZip.loadAsync(f);
          for (const entryName of Object.keys(zip.files)) {
            const entry = zip.files[entryName];
            if (entry.dir) continue;
            if (!/\.(jpe?g|png|webp|gif)$/i.test(entryName)) continue;
            const blob = await entry.async('blob');
            const base = entryName.split('/').pop() || entryName;
            const file = new File([blob], base, { type: blob.type || 'image/jpeg' });
            next.push(makePending(file, matchOne(base)));
          }
        } catch (e: any) {
          toast.error(`ZIP read failed: ${e?.message}`);
        }
      } else if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif)$/i.test(f.name)) {
        next.push(makePending(f, matchOne(f.name)));
      }
    }
    setPending(prev => [...prev, ...next]);
  };

  const makePending = (file: File, match?: { id: string; kind: 'menu' | 'inventory' }): PendingImage => ({
    id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    originalName: file.name,
    cleanedName: clean(file.name),
    matchedItemId: match?.id,
    matchedKind: match?.kind,
    preview: URL.createObjectURL(file),
  });

  useEffect(() => () => { pending.forEach(p => URL.revokeObjectURL(p.preview)); }, []); // eslint-disable-line

  const matched = pending.filter(p => p.matchedItemId);
  const unmatched = pending.filter(p => !p.matchedItemId);

  const setMatch = (id: string, val: string | undefined) => {
    setPending(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (!val) return { ...p, matchedItemId: undefined, matchedKind: undefined };
      const [kind, itemId] = val.split('::') as ['menu' | 'inventory', string];
      return { ...p, matchedItemId: itemId, matchedKind: kind };
    }));
  };
  const removeOne = (id: string) => {
    setPending(prev => prev.filter(p => p.id !== id));
  };

  const doUpload = async () => {
    if (matched.length === 0) { toast.error('No matching image'); return; }
    setBusy(true);
    setProgress({ done: 0, total: matched.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < matched.length; i++) {
      const p = matched[i];
      try {
        let toUpload: File | Blob = p.file;
        if (p.file.size > 500 * 1024) {
          toUpload = await imageCompression(p.file, {
            maxSizeMB: 0.5,
            maxWidthOrHeight: 1280,
            useWebWorker: true,
            initialQuality: 0.85,
          });
        }
        const compressedFile = toUpload instanceof File
          ? toUpload
          : new File([toUpload], p.originalName, { type: (toUpload as Blob).type || 'image/jpeg' });
        const prefix = p.matchedKind === 'inventory' ? 'inventory' : 'menu-item';
        const url = await uploadTenantImage(compressedFile, prefix);
        if (p.matchedKind === 'inventory') {
          const iv = inventory.find(x => x.id === p.matchedItemId);
          if (iv) await Promise.resolve(saveInventoryItem({ ...iv, image: url }));
        } else {
          const it = items.find(x => x.id === p.matchedItemId);
          if (it) await Promise.resolve(saveMenuItem({ ...it, image: url }));
        }
        ok++;
      } catch (e: any) {

        console.error('upload failed', e);
        fail++;
      }
      setProgress({ done: i + 1, total: matched.length });
    }
    setBusy(false);
    setProgress(null);
    if (fail) toast.error(`${ok} uploaded, ${fail} failed`);
    else toast.success(`${ok} images uploaded & linked`);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Images className="h-5 w-5 text-violet-600" /> Bulk Image Upload
          </DialogTitle>
        </DialogHeader>

        {/* Drop / file input */}
        <label className="border-2 border-dashed border-violet-400 rounded-xl p-6 text-center cursor-pointer hover:bg-violet-500/5 transition">
          <input
            type="file"
            multiple
            accept="image/*,.zip"
            className="hidden"
            onChange={e => addFiles(Array.from(e.target.files || []))}
          />
          <div className="flex items-center justify-center gap-3 text-violet-700">
            <Upload className="h-5 w-5" />
            <FileArchive className="h-5 w-5" />
            <span className="font-bold">Select multiple images or a ZIP file</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Auto-match by item name / SKU / filename · Auto-compress to &lt;500KB
          </div>
        </label>

        {pending.length > 0 && (
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-green-500/15 text-green-700 font-bold">
              ✓ {matched.length} matched
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 font-bold">
              ⚠ {unmatched.length} unmatched
            </span>
            <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs text-red-600" onClick={() => setPending([])}>
              Clear all
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4">
          {unmatched.length > 0 && (
            <Section title="Unmatched (manually assign)" tone="amber">
              {unmatched.map(p => (
                <ImageRow key={p.id} p={p} items={items} inventory={inventory} onMatch={(v) => setMatch(p.id, v)} onRemove={() => removeOne(p.id)} />
              ))}
            </Section>
          )}
          {matched.length > 0 && (
            <Section title="Matched — ready to upload" tone="green">
              {matched.map(p => (
                <ImageRow key={p.id} p={p} items={items} inventory={inventory} onMatch={(v) => setMatch(p.id, v)} onRemove={() => removeOne(p.id)} />
              ))}
            </Section>
          )}

          {pending.length === 0 && (
            <div className="text-center text-xs text-muted-foreground italic py-8">
              No images yet. Choose a file or ZIP to upload.
            </div>
          )}
        </div>

        {progress && (
          <div className="text-xs">
            Uploading {progress.done} / {progress.total}…
            <div className="h-1 bg-muted rounded mt-1 overflow-hidden">
              <div className="h-full bg-violet-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          <Button onClick={doUpload} disabled={busy || matched.length === 0} className="bg-violet-600 hover:bg-violet-700 text-white">
            <CheckCircle2 className="h-4 w-4 mr-1" />
            {busy ? 'Uploading…' : `Upload ${matched.length} matched`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, tone, children }: { title: string; tone: 'green' | 'amber'; children: any }) {
  const colors = tone === 'green' ? 'text-green-700 border-green-500/30' : 'text-amber-700 border-amber-500/30';
  return (
    <div>
      <div className={`text-[10px] uppercase font-bold mb-1 ${colors.split(' ')[0]}`}>{title}</div>
      <div className={`border rounded-lg divide-y ${colors.split(' ')[1]}`}>{children}</div>
    </div>
  );
}

function ImageRow({
  p, items, inventory, onMatch, onRemove,
}: { p: PendingImage; items: MenuItem[]; inventory: InventoryItem[]; onMatch: (v: string | undefined) => void; onRemove: () => void }) {
  const currentVal = p.matchedItemId ? `${p.matchedKind || 'menu'}::${p.matchedItemId}` : '__none__';
  return (
    <div className="flex items-center gap-2 p-2">
      <img src={p.preview} alt={p.originalName} className="h-10 w-10 rounded object-cover border" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{p.originalName}</div>
        <div className="text-[10px] text-muted-foreground">
          {(p.file.size / 1024).toFixed(0)} KB
          {p.matchedKind === 'inventory' && <span className="ml-1 text-amber-700">· ingredient</span>}
        </div>
      </div>
      <Select value={currentVal} onValueChange={(v) => onMatch(v === '__none__' ? undefined : v)}>
        <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Match to…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Unmatched —</SelectItem>
          {items.length > 0 && <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground">Menu Items</div>}
          {items.map(it => <SelectItem key={`m-${it.id}`} value={`menu::${it.id}`}>{it.name}</SelectItem>)}
          {inventory.length > 0 && <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground">Ingredients</div>}
          {inventory.map(iv => <SelectItem key={`i-${iv.id}`} value={`inventory::${iv.id}`}>{iv.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}


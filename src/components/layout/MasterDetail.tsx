// v1.115.0 — the design package's master-detail layout (SW-19 Customers, SW-21 Riders, SW-18 Parties …): the list on the left, the
// selected row's panel on the right. On a wide window (1280 px and up) both are on screen at once and a tap on a row fills the panel
// without covering the list; below that there is no room for two columns, so the panel comes up as a dialog — exactly what those
// screens did before — and nothing about the screen's own rules changes. One component, so every screen that adopts it behaves the same.
import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** True when the window is at least `min` px wide. Without matchMedia (tests, old WebViews) it is false: the dialog is the safe layout. */
export function useWideScreen(min = 1280): boolean {
  const read = () => { try { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(`(min-width: ${min}px)`).matches; } catch { return false; } };
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const on = () => setWide(read());
    window.addEventListener('resize', on);
    on();
    return () => window.removeEventListener('resize', on);
  }, [min]); // eslint-disable-line react-hooks/exhaustive-deps
  return wide;
}

export interface MasterDetailProps {
  list: ReactNode;
  /** The panel for the selected row; only read while `open`. */
  detail: ReactNode;
  open: boolean;
  onClose: () => void;
  /** Dialog title below the wide layout, and the panel's heading above it. */
  title: string;
  /** What the empty panel says on a wide window. */
  emptyText?: string;
  minWidth?: number;
  panelWidth?: number;
  dialogClassName?: string;
}

export default function MasterDetail(p: MasterDetailProps) {
  const wide = useWideScreen(p.minWidth ?? 1280);
  if (wide) {
    return (
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: `minmax(0, 1fr) ${p.panelWidth ?? 420}px` }} data-master-detail="wide">
        <div className="min-w-0" data-master-list>{p.list}</div>
        <aside className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border bg-card shadow-card" data-detail-panel aria-label={p.title}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-2.5">
            <h2 className="text-sm font-extrabold">{p.title}</h2>
            {p.open && <button type="button" onClick={p.onClose} aria-label="Close panel" data-detail-close className="grid h-7 w-7 place-items-center rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>}
          </div>
          <div className="p-4">
            {p.open ? p.detail : <p className="py-10 text-center text-sm text-muted-foreground" data-detail-empty>{p.emptyText ?? 'Select a row to see its details.'}</p>}
          </div>
        </aside>
      </div>
    );
  }
  return (
    <>
      <div data-master-detail="stacked">{p.list}</div>
      <Dialog open={p.open} onOpenChange={o => { if (!o) p.onClose(); }}>
        <DialogContent className={p.dialogClassName ?? 'max-w-3xl max-h-[90vh] overflow-y-auto'}>
          <DialogHeader><DialogTitle>{p.title}</DialogTitle></DialogHeader>
          {p.open ? p.detail : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

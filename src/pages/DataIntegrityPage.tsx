// ============================================================
// v1.13.0 — Data Integrity Center
//
// The dedupe/ordering fixes stop bad data from RENDERING wrongly, but
// they do not clean the stored rows. This page inspects the restaurant's
// actual data and can repair it, so the problem is fixed at the source
// rather than papered over at read time.
//
// Deliberately read-only until the operator presses Repair: silently
// rewriting a restaurant's menu is not something software should do on
// its own.
// ============================================================
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { ShieldCheck, AlertTriangle, RefreshCw, Wrench } from 'lucide-react';
import {
  getMenuItems, getCategories, getOrders, getTables, saveMenuItem, saveCategory,
} from '@/lib/store';
import { inspectCollection, dedupeById, type IntegrityReport } from '@/lib/dataIntegrity';

export default function DataIntegrityPage() {
  const [tick, setTick] = useState(0);
  const [repairing, setRepairing] = useState(false);

  const reports: IntegrityReport[] = useMemo(() => {
    // Read through the normal accessors so this reflects exactly what the
    // rest of the app sees, not a privileged view.
    const raw = [
      ['menuItems', getMenuItems()],
      ['categories', getCategories()],
      ['tables', getTables()],
      ['orders', getOrders()],
    ] as const;
    return raw.map(([name, rows]) => inspectCollection(name, rows as any));
  }, [tick]);

  const problems = reports.filter(r => !r.ok);
  const nameWarnings = reports.filter(r => r.duplicateNames.length > 0);

  const repair = async () => {
    setRepairing(true);
    try {
      let fixed = 0;

      // Menu items — collapse duplicate ids, keeping the freshest row.
      const items = getMenuItems();
      const cleanItems = dedupeById(items as any);
      if (cleanItems.length !== items.length) {
        for (const it of cleanItems) saveMenuItem(it as any);
        fixed += items.length - cleanItems.length;
      }

      // Categories — same treatment.
      const cats = getCategories();
      const cleanCats = dedupeById(cats as any);
      if (cleanCats.length !== cats.length) {
        for (const c of cleanCats) saveCategory(c as any);
        fixed += cats.length - cleanCats.length;
      }

      // Give every category a concrete sortOrder so ordering never falls
      // back to the 9999 bucket, where ties were the original problem.
      cleanCats.forEach((c: any, i) => {
        if (!Number.isFinite(c.sortOrder)) saveCategory({ ...c, sortOrder: i + 1 });
      });

      setTick(t => t + 1);
      toast.success(fixed > 0 ? `Cleaned up ${fixed} duplicate row(s)` : 'No duplicates found — the data is clean');
    } catch (e: any) {
      toast.error(`Repair fail hui: ${e?.message || e}`);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Data Integrity
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Duplicate records, missing IDs aur ordering ke masail yahan se check karein.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTick(t => t + 1)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-scan
          </Button>
          <Button size="sm" onClick={repair} disabled={repairing}>
            <Wrench className="h-3.5 w-3.5 mr-1" /> {repairing ? 'Repair…' : 'Repair Data'}
          </Button>
        </div>
      </div>

      {problems.length === 0 ? (
        <Card className="p-4 border-green-400/50 bg-green-50/40">
          <p className="text-sm font-bold text-green-800 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Koi duplicate ID ya missing ID nahi mili ✅
          </p>
          <p className="text-[11px] text-green-900/70 mt-1">
            Menu, categories, tables aur orders — sab ke IDs unique hain.
          </p>
        </Card>
      ) : (
        <Card className="p-4 border-red-400/60 bg-red-50/40 space-y-2">
          <p className="text-sm font-bold text-red-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {problems.length} collection me masla mila
          </p>
          <p className="text-[11px] text-red-900/80">
            "Repair Data" dabayein — duplicate rows me se sab se nayi copy rakhi jayegi,
            baqi hata di jayengi. Ye amal cloud par bhi sync hota hai.
          </p>
        </Card>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {reports.map(r => (
          <Card key={r.collection} className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{r.collection}</span>
              <Badge variant={r.ok ? 'secondary' : 'destructive'} className="text-[10px]">
                {r.ok ? 'OK' : 'ISSUE'}
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
              <div>Total rows: <b>{r.total}</b></div>
              <div className={r.duplicateIds.length ? 'text-destructive font-bold' : ''}>
                Duplicate IDs: {r.duplicateIds.length}
              </div>
              <div className={r.missingIds ? 'text-destructive font-bold' : ''}>
                Missing IDs: {r.missingIds}
              </div>
              <div className={r.duplicateNames.length ? 'text-amber-700' : ''}>
                Same name, different item: {r.duplicateNames.length}
              </div>
            </div>

            {r.duplicateIds.length > 0 && (
              <div className="mt-2 text-[10px] font-mono max-h-24 overflow-auto">
                {r.duplicateIds.slice(0, 10).map(g => (
                  <div key={g.key} className="text-destructive truncate">
                    {g.name || g.key} × {g.count}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      {nameWarnings.length > 0 && (
        <Card className="p-3 bg-amber-50/50 border-amber-300/60">
          <p className="text-xs font-bold text-amber-900 mb-1">
            Ek jaise naam wale items (ye ghalat zaroori nahi)
          </p>
          <p className="text-[11px] text-amber-900/80 mb-2">
            Inke IDs alag hain, yani ye technically alag items hain. Agar ye ghalti se
            do baar ban gaye hain to Menu Manager se hata dein — Repair inhe nahi chhoota,
            kyunke ho sakta hai ye jaan-boojh kar banaye gaye hon (masalan alag size).
          </p>
          <div className="text-[10px] font-mono space-y-0.5 max-h-32 overflow-auto">
            {nameWarnings.flatMap(r =>
              r.duplicateNames.slice(0, 15).map(g => (
                <div key={`${r.collection}-${g.key}`} className="truncate">
                  [{r.collection}] {g.name} × {g.count}
                </div>
              )),
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

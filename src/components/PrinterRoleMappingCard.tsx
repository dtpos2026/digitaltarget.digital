// ============================================================
// PRINTER ROLE MAPPING — which printer prints what.
//
// Why this needed its own module
// ------------------------------
// There were two lists of printers and nothing joining them. Printer Center
// held the DEVICES (name, paper, margins, driver mode). The print queue
// resolved its target from a different place entirely — the shop settings'
// defaultPrinter / kotPrinter / tokenPrinter / backupPrinter. A shop could add
// a printer, see it detected, print a successful test page from its row, and
// still have every bill queue as Pending, because nothing had ever written the
// role fields the queue reads.
//
// This card is that join, and it is deliberately the only screen that writes
// those four fields, so there is one answer to "where does a receipt go?".
//
// Fallbacks are shown, not hidden. An unset role is not an error — a one-
// printer shop legitimately sends the KOT to the counter printer — but the
// shop should be able to see that is what will happen, rather than discover it
// when the kitchen slip comes out at the till.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Route, Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSettings, saveSettings } from '@/lib/store';
import { loadPrinterSettings, type PrinterConfig } from '@/lib/printerSettings';
import { getPrinters, isElectron } from '@/lib/electron';
import { matchPrinter } from '@/printing/printerMatch';

type RoleKey = 'defaultPrinter' | 'kotPrinter' | 'tokenPrinter' | 'backupPrinter';

interface RoleDef {
  key: RoleKey;
  label: string;
  hint: string;
  /** What happens when this is left unset. */
  fallback: (m: Record<RoleKey, string>) => string;
}

const ROLES: RoleDef[] = [
  {
    key: 'defaultPrinter',
    label: 'Customer bill',
    hint: 'The slip handed to the customer at the counter.',
    fallback: () => 'Nothing will print — every bill queues as Pending.',
  },
  {
    key: 'kotPrinter',
    label: 'Kitchen order ticket (KOT)',
    hint: 'The ticket the kitchen works from.',
    fallback: m => m.defaultPrinter
      ? `Falls back to the bill printer (${m.defaultPrinter}) — kitchen tickets print at the counter.`
      : 'Nothing will print.',
  },
  {
    key: 'tokenPrinter',
    label: 'Token slip',
    hint: 'The numbered stub the customer collects with.',
    fallback: m => m.defaultPrinter
      ? `Falls back to the bill printer (${m.defaultPrinter}).`
      : 'Nothing will print.',
  },
  {
    key: 'backupPrinter',
    label: 'Backup',
    hint: 'Used when the printer for a slip fails after its retries.',
    fallback: () => 'No backup — a failed job stays in the queue for a manual retry.',
  },
];

/** Every name the shop could sensibly route to. */
function candidateNames(printers: PrinterConfig[], system: Array<{ name?: string }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n?: string) => {
    const name = String(n || '').trim();
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push(name);
  };
  // Configured printers first: those carry paper size, margins and driver mode.
  for (const p of printers) if (p.enabled !== false) add(p.printerName);
  for (const p of system) add(p.name);
  return out;
}

export default function PrinterRoleMappingCard() {
  const [map, setMap] = useState<Record<RoleKey, string>>({
    defaultPrinter: '', kotPrinter: '', tokenPrinter: '', backupPrinter: '',
  });
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [system, setSystem] = useState<Array<{ name?: string; displayName?: string }>>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const s = getSettings();
    setMap({
      defaultPrinter: s.defaultPrinter || '',
      kotPrinter: s.kotPrinter || '',
      tokenPrinter: s.tokenPrinter || '',
      backupPrinter: s.backupPrinter || '',
    });
    loadPrinterSettings().then(d => setPrinters(d.printers || []));
    if (isElectron()) getPrinters().then(l => setSystem(l || [])).catch(() => { /* list stays empty */ });
  }, []);

  const names = useMemo(() => candidateNames(printers, system), [printers, system]);

  /** Is this saved name actually present in Windows right now? */
  const missing = (name: string) =>
    !!name && isElectron() && system.length > 0 && !matchPrinter(name, system).printer;

  const set = (key: RoleKey, value: string) => {
    setMap(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = () => {
    const s = getSettings();
    saveSettings({
      ...s,
      defaultPrinter: map.defaultPrinter || undefined,
      kotPrinter: map.kotPrinter || undefined,
      tokenPrinter: map.tokenPrinter || undefined,
      backupPrinter: map.backupPrinter || undefined,
    });
    setDirty(false);
    toast.success('Printer roles saved. The next bill uses this mapping.');
  };

  const noTarget = !map.defaultPrinter;

  return (
    <Card className="p-4 md:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Route className="h-5 w-5 mt-0.5 shrink-0" />
        <div>
          <h3 className="text-lg font-semibold">Printer Role Mapping</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Which printer each slip goes to. This is what the print queue reads
            when a bill is paid — a printer can be added and working and still
            print nothing until it is given a role here.
          </p>
        </div>
      </div>

      {noTarget && (
        <div className="flex items-start gap-2 rounded-md border border-status-warning/40 bg-status-warning/10 p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-status-warning" />
          <p className="text-xs">
            No printer is set for customer bills, so every bill will queue as
            Pending. Pick one below and save.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {ROLES.map(role => {
          const value = map[role.key];
          const gone = missing(value);
          return (
            <div key={role.key} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm font-medium">{role.label}</Label>
                  <p className="text-xs text-muted-foreground">{role.hint}</p>
                </div>
                {value && !gone && (
                  <Badge className="text-[10px] bg-status-success/20 text-status-success border-status-success/30 shrink-0">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Routed
                  </Badge>
                )}
                {gone && (
                  <Badge variant="destructive" className="text-[10px] shrink-0">Not installed</Badge>
                )}
              </div>

              <select
                className="w-full h-9 rounded-md border bg-background px-2 text-sm"
                value={value}
                onChange={e => set(role.key, e.target.value)}
              >
                <option value="">— not set —</option>
                {names.map(n => <option key={n} value={n}>{n}</option>)}
                {/* A saved name that is no longer installed must stay
                    selectable, or opening this card would silently re-route
                    the shop's printing to whatever happened to be first. */}
                {value && !names.some(n => n.toLowerCase() === value.toLowerCase()) && (
                  <option value={value}>{value} (not installed)</option>
                )}
              </select>

              {!value && (
                <p className="text-xs text-muted-foreground">{role.fallback(map)}</p>
              )}
              {gone && (
                <p className="text-xs text-destructive">
                  Windows does not currently have a printer by this name. Press
                  Re-detect under Printers, or choose another.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Button onClick={save} disabled={!dirty}>
        <Save className="h-4 w-4 mr-1" /> Save role mapping
      </Button>
    </Card>
  );
}

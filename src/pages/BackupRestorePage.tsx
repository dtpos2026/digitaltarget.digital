import { Button } from '@/components/ui/button';
import type { SystemPrinterInfo } from '@/lib/electron';
import { Download, Upload, RotateCcw, Printer, Database, Smartphone, ChevronRight, Trash2, ShieldAlert, Images } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { exportData, importData, type ImportOutcome, resetData, resetSelectedData, getCurrentUser, RESETTABLE_COLLECTIONS, type ResettableCollection } from '@/lib/store';
import { isElectron, nativeExportBackup, nativeImportBackup, getPrinters, getDataPath } from '@/lib/electron';
import { isFirebaseConfigured } from '@/lib/firebase';
import { embedImages, restoreImages, embeddedImageCount, remoteImageUrls } from '@/lib/backupImages';
import { uploadTenantImage } from '@/lib/storage';
import { toast } from 'sonner';
import { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { PageTitle } from '@/components/layout/PageFrame';
import { Database as TitleIcon } from 'lucide-react';

// Group collections for friendlier UI
const GROUPS: { title: string; items: { key: ResettableCollection; label: string }[] }[] = [
  { title: 'Sales & Orders', items: [
    { key: 'orders', label: 'Orders / Bills' },
    { key: 'creditPayments', label: 'Credit Payments' },
  ]},
  { title: 'Menu & Inventory', items: [
    { key: 'categories', label: 'Categories' },
    { key: 'menuItems', label: 'Menu Items' },
    { key: 'recipes', label: 'Recipes' },
    { key: 'inventory', label: 'Inventory Items' },
    { key: 'stockLogs', label: 'Stock Logs' },
    { key: 'wastages', label: 'Wastage' },
    { key: 'receivingEntries', label: 'Receiving Entries' },
  ]},
  { title: 'Customers & Marketing', items: [
    { key: 'customers', label: 'Customers' },
    { key: 'marketingContacts', label: 'Marketing Contacts' },
    { key: 'promoCodes', label: 'Promo Codes' },
  ]},
  { title: 'Tables & Floor', items: [
    { key: 'tables', label: 'Tables' },
    { key: 'floors', label: 'Floors' },
    { key: 'kitchens', label: 'Kitchens' },
    { key: 'waiters', label: 'Waiters' },
    { key: 'riders', label: 'Riders' },
  ]},
  { title: 'HR & Staff', items: [
    { key: 'employees', label: 'Employees' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'leaves', label: 'Leaves' },
    { key: 'payslips', label: 'Payslips' },
    { key: 'advances', label: 'Advances' },
    { key: 'users', label: 'POS Users' },
  ]},
  { title: 'Accounts', items: [
    { key: 'accountCategories', label: 'Account Categories' },
    { key: 'transactions', label: 'Transactions' },
    { key: 'parties', label: 'Parties' },
    { key: 'ledger', label: 'Ledger' },
    { key: 'dailyCashCloses', label: 'Day Closes' },
    { key: 'paymentAccounts', label: 'Payment Accounts' },
  ]},
  { title: 'Branches', items: [
    { key: 'branches', label: 'Branches' },
  ]},
];

export default function BackupRestorePage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [printers, setPrinters] = useState<SystemPrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [dataPath, setDataPath] = useState('localStorage (browser mode)');
  const electron = isElectron();
  const cloud = isFirebaseConfigured();
  const navigate = useNavigate();
  const me = getCurrentUser();
  const isAdmin = me?.role === 'admin';

  const [eraseOpen, setEraseOpen] = useState(false);
  const [selected, setSelected] = useState<Set<ResettableCollection>>(new Set());
  const [confirmText, setConfirmText] = useState('');
  const [erasing, setErasing] = useState(false);
  // v1.94.0 — backup with pictures: packing progress, and a restore that is waiting for the operator's choice.
  const [packing, setPacking] = useState<{ done: number; total: number } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{ raw: string; count: number } | null>(null);
  const [uploadingPics, setUploadingPics] = useState<{ done: number; total: number } | null>(null);

  const toggle = (k: ResettableCollection) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };
  const selectAll = () => setSelected(new Set(RESETTABLE_COLLECTIONS as readonly ResettableCollection[]));
  const clearSel = () => setSelected(new Set());

  const handleErase = async () => {
    if (selected.size === 0) { toast.error('Select something'); return; }
    if (confirmText !== 'DELETE') { toast.error('Type DELETE to confirm'); return; }
    setErasing(true);
    try {
      // v1.29.3 — say what the SERVER did, not what was asked for. This used
      // to report success unconditionally, while the delete was throwing into
      // a swallowed catch and the rows came back on the next sync.
      const res = await resetSelectedData([...selected]);
      if (res.failed.length) {
        toast.error(
          `${res.failed.length} of ${selected.size} could not be cleared on the server ` +
          `(${res.failed.map(f => f.collection).join(', ')}). ` +
          'Those are unchanged on this device too — try again when back online.',
          { duration: 15000 },
        );
        setErasing(false);
        return;
      }
      const total = Object.values(res.cleared).reduce((n, c) => n + c, 0);
      toast.success(`${selected.size} collection(s) erased — ${total} record(s). Refreshing...`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      toast.error(e?.message || 'Erase failed');
      setErasing(false);
    }
  };


  useEffect(() => {
    if (electron) {
      getPrinters().then((list) => {
        setPrinters(list);
      const def = list.find((p) => p.isDefault);
      if (def) setSelectedPrinter(def.name);
    });
    getDataPath().then(setDataPath);
  } else {
    setDataPath('localStorage (browser mode)');
  }
  }, [electron]);

  /** Save a backup file: the desktop app's save dialog, or a download in a browser. True when a file was written. */
  const saveBackupFile = async (json: string, defaultName: string): Promise<boolean> => {
    if (electron) return !!(await nativeExportBackup(json, defaultName));
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  };

  const handleExport = async () => {
    const defaultName = `desi-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const saved = await saveBackupFile(exportData(), defaultName);
    if (saved) toast.success('Backup exported');
    else toast.info('Export cancelled');
  };

  // v1.94.0 — the data file holds only links to menu photos and logos. This packs the pictures into the file.
  const handleExportWithImages = async () => {
    let data: unknown;
    try { data = JSON.parse(exportData()); } catch { toast.error('Could not read the data to back up'); return; }
    const total = remoteImageUrls(data).length;
    if (total === 0) toast.info('There are no linked pictures to pack, so this backup is the same as the plain one.');
    setPacking({ done: 0, total });
    try {
      const res = await embedImages(data, { onProgress: (done, t) => setPacking({ done, total: t }) });
      const defaultName = `desi-pos-backup-with-pictures-${new Date().toISOString().slice(0, 10)}.json`;
      const saved = await saveBackupFile(JSON.stringify(res.data, null, 2), defaultName);
      if (!saved) { toast.info('Export cancelled'); return; }
      const mb = (res.bytes / 1048576).toFixed(1);
      if (res.failed.length) {
        toast.warning(
          `Backup exported with ${res.embedded} picture(s) (${mb} MB). ${res.failed.length} could not be fetched and stay as links in the file.`,
          { duration: 12000 },
        );
      } else {
        toast.success(`Backup exported with ${res.embedded} picture(s) (${mb} MB)`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setPacking(null);
    }
  };

  // v1.103.0 — the restore shows its real progress and reloads only when the cloud upload has finished (it used to reload after a
  // fixed six seconds, which cut a big restore off halfway and left the rest to be re-queued by the next start).
  const [restoring, setRestoring] = useState<null | { processed: number; total: number; outcome?: ImportOutcome }>(null);
  useEffect(() => {
    if (!restoring || restoring.outcome) return;
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setRestoring(r => (r && !r.outcome ? { ...r, processed: Number(d.processedCount) || 0, total: Number(d.totalCount) || 0 } : r));
    };
    window.addEventListener('dt-import-progress', onProgress);
    return () => window.removeEventListener('dt-import-progress', onProgress);
  }, [restoring]);

  const finishRestore = async (raw: string) => {
    let pending: Promise<ImportOutcome | void> | ImportOutcome | void;
    try {
      pending = importData(raw);                                   // the local restore is done when this returns
    } catch {
      toast.error('Invalid backup file');
      return;
    }
    setRestoring({ processed: 0, total: 0 });
    const outcome = (await Promise.resolve(pending).catch(() => undefined)) as ImportOutcome | undefined;
    if (!outcome || !outcome.cloud) {
      setRestoring(null);
      toast.success('Data restored. Refreshing...');
      setTimeout(() => window.location.reload(), 800);
      return;
    }
    if (outcome.failed === 0 && !outcome.error) {
      setRestoring({ processed: outcome.total, total: outcome.total, outcome });
      toast.success(`Data restored — ${outcome.ok.toLocaleString()} records are in the cloud.`);
      setTimeout(() => window.location.reload(), 1500);
      return;
    }
    setRestoring({ processed: outcome.total, total: outcome.total, outcome });   // stay open: the operator reads what is left
  };

  // A backup that carries its pictures can put them back in this restaurant's own storage first (v1.94.0). Only
  // offered when there is cloud storage to upload to, and only when the file actually holds pictures.
  const startRestore = async (raw: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { toast.error('Invalid backup file'); return; }
    const count = embeddedImageCount(parsed);
    if (count > 0) {
      let canUpload = false;
      try { canUpload = (await import('@/lib/authProvider')).usingSupabaseAuth(); } catch { /* local mode */ }
      if (canUpload) { setPendingRestore({ raw, count }); return; }
    }
    finishRestore(raw);
  };

  const continueRestore = async (upload: boolean) => {
    const p = pendingRestore;
    if (!p) return;
    if (!upload) { setPendingRestore(null); finishRestore(p.raw); return; }
    setUploadingPics({ done: 0, total: p.count });
    try {
      const res = await restoreImages(JSON.parse(p.raw), uploadTenantImage, {
        onProgress: (done, total) => setUploadingPics({ done, total }),
      });
      if (res.keptInline > 0) {
        toast.warning(
          `${res.uploaded} picture(s) uploaded; ${res.keptInline} kept inside the data (${res.failed.length} upload error(s)).`,
          { duration: 12000 },
        );
      }
      setPendingRestore(null);
      finishRestore(JSON.stringify(res.data));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the pictures');
    } finally {
      setUploadingPics(null);
    }
  };

  const handleImport = async () => {
    if (electron) {
      const data = await nativeImportBackup();
      if (!data) { toast.info('Import cancelled'); return; }
      await startRestore(data);
      return;
    }
    // Browser fallback
    fileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { void startRestore(reader.result as string); };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (!confirm('This will reset ALL data to demo defaults. Continue?')) return;
    resetData();
    toast.success('Data reset. Refreshing...');
    setTimeout(() => window.location.reload(), 1000);
  };

  return (
    <div className="p-4 lg:p-6 max-w-lg space-y-6">
      <PageTitle icon={TitleIcon} subtitle="Save everything to a file, or restore from one">Backup & Restore</PageTitle>

      <div className="bg-card border rounded-xl p-4 mb-4 flex items-center gap-3">
        <Database className="h-5 w-5 text-primary" />
        <div>
          <p className="text-xs font-semibold">Data Storage Location</p>
          <p className="text-xs text-muted-foreground font-mono break-all">{dataPath}</p>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-1">Export Backup</h3>
          <p className="text-xs text-muted-foreground mb-3">Download all system data as a JSON file.</p>
          <Button onClick={handleExport}><Download className="h-4 w-4 mr-2" /> Export JSON</Button>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-1">Export with pictures</h3>
          <p className="text-xs text-muted-foreground mb-3">
            The plain backup keeps only links to your menu photos, logos and banners. This one packs the pictures into
            the file, so the restaurant can be restored complete — on a new account, or if the storage is ever lost.
            The file is larger (about 100 KB per picture). Staff photos and documents are never included.
          </p>
          <Button variant="outline" onClick={handleExportWithImages} disabled={!!packing}>
            <Images className="h-4 w-4 mr-2" />
            {packing ? `Packing pictures ${packing.done} / ${packing.total}…` : 'Export with pictures'}
          </Button>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-1">Restore from Backup</h3>
          <p className="text-xs text-muted-foreground mb-3">Upload a previously exported JSON file to restore data.</p>
          <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} className="hidden" />
          <Button variant="outline" onClick={handleImport}>
            <Upload className="h-4 w-4 mr-2" /> Import JSON
          </Button>
        </div>

        {isAdmin && (
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-1">Reset to Demo Data</h3>
            <p className="text-xs text-muted-foreground mb-3">Reset everything to default demo data. This cannot be undone.</p>
            <Button variant="destructive" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" /> Reset Data
            </Button>
          </div>
        )}

        {isAdmin && (
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-4 w-4" /> Erase Selected Data (Admin Only)
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Delete only the data you choose — orders, menu, customers, HR and so on.
              Yeh action permanent hai (local + cloud dono se mit jata hai).
            </p>
            <Button variant="destructive" onClick={() => { setSelected(new Set()); setConfirmText(''); setEraseOpen(true); }}>
              <Trash2 className="h-4 w-4 mr-2" /> Erase Data…
            </Button>
          </div>
        )}

        {!isAdmin && (
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground italic flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Reset and erase options are only visible to an Admin user.
            </p>
          </div>
        )}

        {electron && (
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <Printer className="h-4 w-4" /> Default Receipt Printer
            </h3>
            <p className="text-xs text-muted-foreground mb-3">Select the thermal printer for silent receipt printing.</p>
            {printers.length > 0 ? (
              <select
                value={selectedPrinter}
                onChange={(e) => {
                  setSelectedPrinter(e.target.value);
                  localStorage.setItem('pos-default-printer', e.target.value);
                  toast.success(`Default printer set to: ${e.target.value}`);
                }}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} {p.isDefault ? '(System Default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">No printers detected.</p>
            )}
          </div>
        )}
      </div>

      {/* Connected Devices shortcut */}
      <div className="bg-card border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Connected Devices</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {cloud
            ? 'Cloud mode میں سب devices یہاں سے approve/remove کر سکتے ہیں۔'
            : 'Cloud mode disabled ہے — device management صرف cloud mode میں دستیاب۔'}
        </p>
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => navigate('/devices')}
          disabled={!cloud}
        >
          <span className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> Manage Devices</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" /> Erase Selected Data
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={selectAll}>Select All</Button>
                <Button size="sm" variant="ghost" onClick={clearSel}>Clear</Button>
              </div>
            </div>
            {GROUPS.map(g => (
              <div key={g.title} className="border rounded-lg p-3">
                <div className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-2">{g.title}</div>
                <div className="grid grid-cols-2 gap-2">
                  {g.items.map(it => (
                    <label key={it.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-2 py-1">
                      <Checkbox checked={selected.has(it.key)} onCheckedChange={() => toggle(it.key)} />
                      <span>{it.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 space-y-2">
              <p className="text-xs text-red-700 font-semibold">
                ⚠️ Permanent delete. Type <b>DELETE</b> below to confirm.
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="bg-card"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEraseOpen(false)} disabled={erasing}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleErase}
              disabled={erasing || selected.size === 0 || confirmText !== 'DELETE'}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {erasing ? 'Erasing…' : `Erase ${selected.size} collection(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* v1.103.0 — the restore's real progress; it cannot be dismissed while the upload runs, and says exactly what is left afterwards. */}
      <Dialog open={!!restoring} onOpenChange={o => { if (!o && restoring?.outcome) setRestoring(null); }}>
        <DialogContent className="max-w-md" onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { if (!restoring?.outcome) e.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>
              {!restoring?.outcome ? 'Restoring your data…' : restoring.outcome.failed || restoring.outcome.error ? 'Restored — some records need another try' : 'Restore complete'}
            </DialogTitle>
          </DialogHeader>
          {!restoring?.outcome ? (
            <div className="space-y-3" data-testid="restore-progress">
              <Progress value={restoring && restoring.total ? Math.min(100, Math.round((restoring.processed / restoring.total) * 100)) : 0} />
              <p className="text-sm font-semibold tabular-nums">
                {(restoring?.processed ?? 0).toLocaleString()} of {(restoring?.total ?? 0).toLocaleString()} records uploaded
              </p>
              <p className="text-xs text-muted-foreground">
                Keep this window open. Everything is already saved on this device; what you see here is the copy going to the cloud.
              </p>
            </div>
          ) : (
            <div className="space-y-3 text-sm" data-testid="restore-summary">
              <p><b>{restoring.outcome.ok.toLocaleString()}</b> records are in the cloud{restoring.outcome.failed ? <>, <b>{restoring.outcome.failed.toLocaleString()}</b> could not be uploaded yet</> : null}.</p>
              {(restoring.outcome.failed > 0 || restoring.outcome.error) && (
                <>
                  <p className="text-muted-foreground">
                    They are safe on this device and are queued: the app retries them by itself, and Sync shows what is still waiting.
                  </p>
                  {restoring.outcome.failedRows.slice(0, 4).map(f => (
                    <p key={`${f.col}:${f.id}`} className="truncate rounded-md bg-muted px-2 py-1 text-xs"><b>{f.col}</b> · {f.error}</p>
                  ))}
                  {restoring.outcome.error && <p className="text-xs text-destructive">{restoring.outcome.error}</p>}
                </>
              )}
            </div>
          )}
          {restoring?.outcome && (
            <DialogFooter>
              <Button onClick={() => window.location.reload()}>Reload now</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* v1.94.0 — a backup that carries its pictures: put them in this restaurant's storage, or leave them inside. */}
      <Dialog open={!!pendingRestore} onOpenChange={o => { if (!o && !uploadingPics) setPendingRestore(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>This backup contains {pendingRestore?.count} picture(s)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Upload them to this restaurant's own storage (recommended): the menu keeps small links and loads fast.
            Or keep them inside the data as they are — nothing is uploaded, but the data becomes much larger.
          </p>
          {uploadingPics && (
            <p className="text-sm font-medium" role="status">Uploading pictures {uploadingPics.done} / {uploadingPics.total}…</p>
          )}
          <DialogFooter className="flex-wrap gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPendingRestore(null)} disabled={!!uploadingPics}>Cancel</Button>
            <Button variant="outline" onClick={() => continueRestore(false)} disabled={!!uploadingPics}>Keep inside the data</Button>
            <Button onClick={() => continueRestore(true)} disabled={!!uploadingPics}>Upload the pictures</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

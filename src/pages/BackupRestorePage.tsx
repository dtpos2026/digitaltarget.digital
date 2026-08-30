import { Button } from '@/components/ui/button';
import { Download, Upload, RotateCcw, Printer, Database, Smartphone, ChevronRight, Trash2, ShieldAlert } from 'lucide-react';
import { useNavigate } from '@/lib/hash-router';
import { exportData, importData, resetData, resetSelectedData, getCurrentUser, RESETTABLE_COLLECTIONS, type ResettableCollection } from '@/lib/store';
import { isElectron, nativeExportBackup, nativeImportBackup, getPrinters, getDataPath } from '@/lib/electron';
import { isFirebaseConfigured } from '@/lib/firebase';
import { toast } from 'sonner';
import { useRef, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

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
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
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

  const handleExport = async () => {
    const json = exportData();
    const defaultName = `desi-pos-backup-${new Date().toISOString().slice(0, 10)}.json`;

    if (electron) {
      const saved = await nativeExportBackup(json, defaultName);
      if (saved) toast.success('Backup exported');
      else toast.info('Export cancelled');
      return;
    }

    // Browser fallback
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultName;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup exported');
  };

  const handleImport = async () => {
    if (electron) {
      const data = await nativeImportBackup();
      if (!data) { toast.info('Import cancelled'); return; }
      try {
        importData(data);
        toast.success('Data restored — uploading to cloud, please wait...');
        // Cloud push runs in the background; reloading too early kills it.
        setTimeout(() => window.location.reload(), 6000);
      } catch {
        toast.error('Invalid backup file');
      }
      return;
    }
    // Browser fallback
    fileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importData(reader.result as string);
        toast.success('Data restored — uploading to cloud, please wait...');
        // Cloud push runs in the background; reloading too early kills it.
        setTimeout(() => window.location.reload(), 6000);
      } catch {
        toast.error('Invalid backup file');
      }
    };
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
      <h2 className="text-lg font-bold">Backup & Restore</h2>

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
              Sirf woh data delete karein jo aap chahte hain — orders, menu, customers, HR vagaira.
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
    </div>
  );
}

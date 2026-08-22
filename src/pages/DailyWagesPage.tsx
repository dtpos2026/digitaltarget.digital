import { useState, useMemo, useEffect } from 'react';
import { currencySymbol } from '@/lib/currency';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Worker, WageEntry, WagePayment, WORKER_CATEGORIES, WorkerCategory,
  getWorkers, saveWorker, deleteWorker,
  getWageEntries, saveWageEntry, deleteWageEntry, computeNetAmount,
  getWagePayments, saveWagePayment, deleteWagePayment,
  getWorkerLedger, getWorkerBalance, getWorkerPaymentStatus,
  getWageAuditLog, onWagesChange,
} from '@/lib/dailyWages';
import { getBranches, getCurrentUser } from '@/lib/store';
import { Plus, Trash2, Edit3, Wallet, Users2, FileText, History, Banknote, HandCoins } from 'lucide-react';

function fmt(n: number) { return 'Rs. ' + Math.round(n || 0).toLocaleString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function catLabel(c: WorkerCategory) { return WORKER_CATEGORIES.find(x => x.value === c)?.label || c; }

const ROLE = () => getCurrentUser()?.role || 'admin';
const canEditEntries = () => ['admin', 'manager'].includes(ROLE());
const canManageWorkers = () => ['admin', 'manager'].includes(ROLE());
const canAddPayments = () => ['admin', 'manager', 'cashier'].includes(ROLE());

export default function DailyWagesPage() {
  const [tick, setTick] = useState(0);
  useEffect(() => onWagesChange(() => setTick(t => t + 1)), []);

  const workers = getWorkers();
  const entries = getWageEntries();
  const payments = getWagePayments();
  const branches = getBranches();

  // Stats
  const totalEarned = entries.reduce((s, e) => s + e.netAmount, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = totalEarned - totalPaid;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><HandCoins className="h-6 w-6 text-primary" />Daily Wages Management</h1>
          <p className="text-sm text-muted-foreground">Workers, daily entries, payments, advances & ledger — auto-posted to Accounts</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Workers" value={String(workers.length)} icon={<Users2 className="h-4 w-4" />} />
        <StatCard label="Total Wages" value={fmt(totalEarned)} icon={<FileText className="h-4 w-4" />} />
        <StatCard label="Total Paid" value={fmt(totalPaid)} icon={<Banknote className="h-4 w-4" />} />
        <StatCard label="Outstanding" value={fmt(outstanding)} icon={<Wallet className="h-4 w-4" />}
          accent={outstanding > 0 ? 'text-amber-600' : 'text-emerald-600'} />
      </div>

      <Tabs defaultValue="entries">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="entries">Daily Entries</TabsTrigger>
          <TabsTrigger value="workers">Workers</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="ledger">Worker Ledger</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="entries"><EntriesTab workers={workers} entries={entries} branches={branches} /></TabsContent>
        <TabsContent value="workers"><WorkersTab workers={workers} /></TabsContent>
        <TabsContent value="payments"><PaymentsTab workers={workers} payments={payments} /></TabsContent>
        <TabsContent value="ledger"><LedgerTab workers={workers} /></TabsContent>
        <TabsContent value="reports"><ReportsTab workers={workers} entries={entries} payments={payments} /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      <div className={`text-xl font-bold mt-1 ${accent || ''}`}>{value}</div>
    </Card>
  );
}

// ---------------- Workers Tab ----------------
function WorkersTab({ workers }: { workers: Worker[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [search, setSearch] = useState('');

  const filtered = workers.filter(w =>
    !search || w.name.toLowerCase().includes(search.toLowerCase()) || (w.mobile || '').includes(search),
  );

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input placeholder="Search worker name / mobile…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        {canManageWorkers() && (
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Add Worker
          </Button>
        )}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead className="text-right">Default Rate</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No workers yet — add your first worker</TableCell></TableRow>
            ) : filtered.map(w => {
              const bal = getWorkerBalance(w.id);
              return (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>{w.mobile}</TableCell>
                  <TableCell><Badge variant="secondary">{catLabel(w.category)}</Badge></TableCell>
                  <TableCell>{w.designation || '—'}</TableCell>
                  <TableCell className="text-right">{fmt(w.defaultDailyWage)}</TableCell>
                  <TableCell className={`text-right font-semibold ${bal > 0 ? 'text-amber-600' : bal < 0 ? 'text-blue-600' : ''}`}>
                    {bal === 0 ? '—' : bal > 0 ? fmt(bal) + ' due' : fmt(-bal) + ' adv'}
                  </TableCell>
                  <TableCell>{w.active ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell>
                    {canManageWorkers() && (
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(w); setOpen(true); }}><Edit3 className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => {
                          if (!confirm('Delete worker? Ledger entries will remain.')) return;
                          deleteWorker(w.id); toast.success('Worker deleted');
                        }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {open && <WorkerDialog worker={editing} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function WorkerDialog({ worker, onClose }: { worker: Worker | null; onClose: () => void }) {
  const [name, setName] = useState(worker?.name || '');
  const [mobile, setMobile] = useState(worker?.mobile || '');
  const [cnic, setCnic] = useState(worker?.cnic || '');
  const [address, setAddress] = useState(worker?.address || '');
  const [designation, setDesignation] = useState(worker?.designation || '');
  const [category, setCategory] = useState<WorkerCategory>(worker?.category || 'labor');
  const [rate, setRate] = useState(String(worker?.defaultDailyWage || 1500));
  const [active, setActive] = useState(worker?.active ?? true);

  const save = () => {
    if (!name.trim()) { toast.error('Name required'); return; }
    saveWorker({
      id: worker?.id, name: name.trim(), mobile: mobile.trim(), cnic: cnic.trim() || undefined,
      address: address.trim() || undefined, designation: designation.trim() || undefined,
      category, defaultDailyWage: Number(rate) || 0, active,
    });
    toast.success(worker ? 'Worker updated' : 'Worker added');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{worker ? 'Edit Worker' : 'Add Worker'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div><Label>Mobile</Label><Input value={mobile} onChange={e => setMobile(e.target.value)} /></div>
          <div><Label>CNIC</Label><Input value={cnic} onChange={e => setCnic(e.target.value)} placeholder="optional" /></div>
          <div className="col-span-2"><Label>Address</Label><Input value={address} onChange={e => setAddress(e.target.value)} /></div>
          <div><Label>Designation</Label><Input value={designation} onChange={e => setDesignation(e.target.value)} /></div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={v => setCategory(v as WorkerCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{WORKER_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Default Daily Wage</Label><Input type="number" value={rate} onChange={e => setRate(e.target.value)} /></div>
          <div className="flex items-center gap-2 pt-6"><Switch checked={active} onCheckedChange={setActive} /><Label>Active</Label></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Entries Tab ----------------
function EntriesTab({ workers, entries, branches }: { workers: Worker[]; entries: WageEntry[]; branches: any[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WageEntry | null>(null);
  const [filterDate, setFilterDate] = useState('');
  const [filterWorker, setFilterWorker] = useState('all');

  const filtered = useMemo(() => entries
    .filter(e => !filterDate || e.date === filterDate)
    .filter(e => filterWorker === 'all' || e.workerId === filterWorker)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
  [entries, filterDate, filterWorker]);

  const total = filtered.reduce((s, e) => s + e.netAmount, 0);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="w-44" />
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => { setFilterDate(''); setFilterWorker('all'); }}>Reset</Button>
        <div className="flex-1" />
        <div className="text-sm"><span className="text-muted-foreground">Total:</span> <span className="font-bold">{fmt(total)}</span></div>
        {canEditEntries() && (
          <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4 mr-1" /> New Entry</Button>
        )}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead>Work / Branch</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">OT</TableHead>
              <TableHead className="text-right">Bonus</TableHead>
              <TableHead className="text-right">Ded.</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">No wage entries</TableCell></TableRow>
            ) : filtered.map(e => (
              <TableRow key={e.id}>
                <TableCell>{e.date}</TableCell>
                <TableCell>
                  <div className="font-medium">{e.workerName}</div>
                  <div className="text-xs text-muted-foreground">{catLabel(e.category)}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{e.workDescription || '—'}</div>
                  {e.branchName && <div className="text-xs text-muted-foreground">{e.branchName}{e.department ? ' / ' + e.department : ''}</div>}
                </TableCell>
                <TableCell className="text-right">{fmt(e.dailyRate)}</TableCell>
                <TableCell className="text-right">{e.days}</TableCell>
                <TableCell className="text-right">{e.overtime ? fmt(e.overtime) : '—'}</TableCell>
                <TableCell className="text-right">{e.bonus ? fmt(e.bonus) : '—'}</TableCell>
                <TableCell className="text-right text-destructive">{e.deduction ? fmt(e.deduction) : '—'}</TableCell>
                <TableCell className="text-right font-bold">{fmt(e.netAmount)}</TableCell>
                <TableCell>
                  {canEditEntries() && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setOpen(true); }}><Edit3 className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => {
                        if (!confirm('Delete entry? Linked Accounts expense will remain — adjust manually.')) return;
                        deleteWageEntry(e.id); toast.success('Entry deleted');
                      }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {open && <EntryDialog entry={editing} workers={workers} branches={branches} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function EntryDialog({ entry, workers, branches, onClose }: { entry: WageEntry | null; workers: Worker[]; branches: any[]; onClose: () => void }) {
  const active = workers.filter(w => w.active);
  const [workerId, setWorkerId] = useState(entry?.workerId || active[0]?.id || '');
  const worker = workers.find(w => w.id === workerId);
  const [date, setDate] = useState(entry?.date || todayISO());
  const [workDescription, setWorkDescription] = useState(entry?.workDescription || '');
  const [branchId, setBranchId] = useState(entry?.branchId || 'none');
  const [department, setDepartment] = useState(entry?.department || '');
  const [project, setProject] = useState(entry?.project || '');
  const [dailyRate, setDailyRate] = useState(String(entry?.dailyRate || worker?.defaultDailyWage || 1500));
  const [days, setDays] = useState(String(entry?.days || 1));
  const [overtime, setOvertime] = useState(String(entry?.overtime || 0));
  const [bonus, setBonus] = useState(String(entry?.bonus || 0));
  const [deduction, setDeduction] = useState(String(entry?.deduction || 0));
  const [remarks, setRemarks] = useState(entry?.remarks || '');

  useEffect(() => {
    if (!entry && worker) setDailyRate(String(worker.defaultDailyWage || 1500));
  }, [workerId]); // eslint-disable-line

  const net = computeNetAmount({
    dailyRate: Number(dailyRate) || 0, days: Number(days) || 0,
    overtime: Number(overtime) || 0, bonus: Number(bonus) || 0, deduction: Number(deduction) || 0,
  });

  const save = () => {
    if (!worker) { toast.error('Pick a worker'); return; }
    const branch = branches.find(b => b.id === branchId);
    saveWageEntry({
      id: entry?.id, date, workerId: worker.id, workerName: worker.name, category: worker.category,
      workDescription, branchId: branchId === 'none' ? undefined : branchId, branchName: branch?.name,
      department: department || undefined, project: project || undefined,
      dailyRate: Number(dailyRate) || 0, days: Number(days) || 0,
      overtime: Number(overtime) || 0, bonus: Number(bonus) || 0, deduction: Number(deduction) || 0,
      remarks: remarks || undefined,
    });
    toast.success(entry ? 'Entry updated' : 'Entry saved & posted to Accounts');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{entry ? 'Edit Wage Entry' : 'New Daily Wage Entry'}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Worker *</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger><SelectValue placeholder="Select worker" /></SelectTrigger>
              <SelectContent>{active.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({catLabel(w.category)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Date *</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="col-span-2"><Label>Work Description</Label><Input value={workDescription} onChange={e => setWorkDescription(e.target.value)} placeholder="e.g. Kitchen cleaning, unloading delivery" /></div>
          <div>
            <Label>Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Department / Project</Label><Input value={department} onChange={e => setDepartment(e.target.value)} placeholder="e.g. Kitchen / Catering Event" /></div>
          <div><Label>Daily Rate</Label><Input type="number" value={dailyRate} onChange={e => setDailyRate(e.target.value)} /></div>
          <div><Label>Days / Qty</Label><Input type="number" value={days} onChange={e => setDays(e.target.value)} /></div>
          <div><Label>Overtime ({currencySymbol()})</Label><Input type="number" value={overtime} onChange={e => setOvertime(e.target.value)} /></div>
          <div><Label>Bonus ({currencySymbol()})</Label><Input type="number" value={bonus} onChange={e => setBonus(e.target.value)} /></div>
          <div><Label>Deduction ({currencySymbol()})</Label><Input type="number" value={deduction} onChange={e => setDeduction(e.target.value)} /></div>
          <div className="col-span-2"><Label>Remarks</Label><Textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} /></div>
          <div className="col-span-2 p-3 bg-muted/50 rounded-md flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Net Payable</span>
            <span className="text-2xl font-bold text-primary">{fmt(net)}</span>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Entry</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Payments Tab ----------------
function PaymentsTab({ workers, payments }: { workers: Worker[]; payments: WagePayment[] }) {
  const [open, setOpen] = useState(false);
  const [isAdvance, setIsAdvance] = useState(false);
  const [filterWorker, setFilterWorker] = useState('all');

  const filtered = payments
    .filter(p => filterWorker === 'all' || p.workerId === filterWorker)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filterWorker} onValueChange={setFilterWorker}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workers</SelectItem>
            {workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {canAddPayments() && (
          <>
            <Button variant="outline" onClick={() => { setIsAdvance(true); setOpen(true); }}>
              <HandCoins className="h-4 w-4 mr-1" /> Give Advance
            </Button>
            <Button onClick={() => { setIsAdvance(false); setOpen(true); }}>
              <Banknote className="h-4 w-4 mr-1" /> Add Payment
            </Button>
          </>
        )}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No payments yet</TableCell></TableRow>
            ) : filtered.map(p => (
              <TableRow key={p.id}>
                <TableCell>{p.date}</TableCell>
                <TableCell className="font-medium">{p.workerName}</TableCell>
                <TableCell>{p.isAdvance ? <Badge variant="secondary">Advance</Badge> : <Badge>Payment</Badge>}</TableCell>
                <TableCell className="capitalize">{p.method}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{p.note || '—'}</TableCell>
                <TableCell className="text-right font-bold">{fmt(p.amount)}</TableCell>
                <TableCell>
                  {canEditEntries() && (
                    <Button size="icon" variant="ghost" onClick={() => {
                      if (!confirm('Delete payment? Linked Accounts expense will remain.')) return;
                      deleteWagePayment(p.id); toast.success('Payment deleted');
                    }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {open && <PaymentDialog workers={workers} isAdvance={isAdvance} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function PaymentDialog({ workers, isAdvance, onClose }: { workers: Worker[]; isAdvance: boolean; onClose: () => void }) {
  const active = workers.filter(w => w.active);
  const [workerId, setWorkerId] = useState(active[0]?.id || '');
  const worker = workers.find(w => w.id === workerId);
  const balance = worker ? getWorkerBalance(worker.id) : 0;
  const [amount, setAmount] = useState(isAdvance ? '5000' : String(Math.max(0, balance)));
  const [method, setMethod] = useState<'cash' | 'online' | 'card'>('cash');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isAdvance && worker) setAmount(String(Math.max(0, getWorkerBalance(worker.id))));
  }, [workerId]); // eslint-disable-line

  const save = () => {
    if (!worker) { toast.error('Pick a worker'); return; }
    const amt = Number(amount) || 0;
    if (amt <= 0) { toast.error('Amount must be > 0'); return; }
    saveWagePayment({
      workerId: worker.id, workerName: worker.name, amount: amt, method, date,
      note: note || undefined, isAdvance,
    });
    toast.success(isAdvance ? 'Advance recorded' : 'Payment recorded');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isAdvance ? 'Give Advance' : 'Add Payment'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Worker *</Label>
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{active.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {worker && (
            <div className="text-xs p-2 bg-muted/50 rounded">
              Current Balance: <span className="font-semibold">{balance > 0 ? fmt(balance) + ' due to worker' : balance < 0 ? fmt(-balance) + ' advance outstanding' : 'Settled'}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><Label>Amount *</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          </div>
          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={v => setMethod(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="online">Online Transfer</SelectItem>
                <SelectItem value="card">Bank / Card</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Note</Label><Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------- Ledger Tab ----------------
function LedgerTab({ workers }: { workers: Worker[] }) {
  const [workerId, setWorkerId] = useState(workers[0]?.id || '');
  const rows = workerId ? getWorkerLedger(workerId) : [];
  const worker = workers.find(w => w.id === workerId);
  const balance = worker ? getWorkerBalance(worker.id) : 0;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Label>Worker:</Label>
        <Select value={workerId} onValueChange={setWorkerId}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Pick a worker" /></SelectTrigger>
          <SelectContent>{workers.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
        </Select>
        {worker && (
          <Badge variant="outline" className="ml-auto text-sm">
            Status: <span className="ml-1 capitalize">{getWorkerPaymentStatus(worker.id)}</span>
          </Badge>
        )}
      </div>

      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit (Earned)</TableHead>
              <TableHead className="text-right">Credit (Paid)</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No ledger entries</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.refId}>
                <TableCell>{r.date}</TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell className="text-right">{r.debit ? fmt(r.debit) : '—'}</TableCell>
                <TableCell className="text-right">{r.credit ? fmt(r.credit) : '—'}</TableCell>
                <TableCell className={`text-right font-semibold ${r.balance > 0 ? 'text-amber-600' : r.balance < 0 ? 'text-blue-600' : ''}`}>
                  {r.balance === 0 ? '0' : r.balance > 0 ? fmt(r.balance) : '(' + fmt(-r.balance) + ')'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {worker && (
        <div className="flex justify-end gap-6 text-sm pt-2 border-t">
          <div>Closing Balance: <span className={`font-bold text-lg ${balance > 0 ? 'text-amber-600' : balance < 0 ? 'text-blue-600' : ''}`}>
            {balance > 0 ? fmt(balance) + ' (due)' : balance < 0 ? fmt(-balance) + ' (advance)' : 'Settled'}
          </span></div>
        </div>
      )}
    </Card>
  );
}

// ---------------- Reports Tab ----------------
function ReportsTab({ workers, entries, payments }: { workers: Worker[]; entries: WageEntry[]; payments: WagePayment[] }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const fEntries = entries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
  const fPayments = payments.filter(p => (!from || p.date >= from) && (!to || p.date <= to));

  // By worker summary
  const byWorker = workers.map(w => {
    const earned = fEntries.filter(e => e.workerId === w.id).reduce((s, e) => s + e.netAmount, 0);
    const paid = fPayments.filter(p => p.workerId === w.id).reduce((s, p) => s + p.amount, 0);
    const days = fEntries.filter(e => e.workerId === w.id).reduce((s, e) => s + (e.days || 0), 0);
    return { worker: w, earned, paid, balance: earned - paid, days };
  }).filter(r => r.earned > 0 || r.paid > 0);

  // By branch summary
  const branchMap = new Map<string, number>();
  fEntries.forEach(e => {
    const k = e.branchName || '(No Branch)';
    branchMap.set(k, (branchMap.get(k) || 0) + e.netAmount);
  });

  const exportCsv = () => {
    const rows = [
      ['Worker', 'Category', 'Days', 'Earned', 'Paid', 'Balance'],
      ...byWorker.map(r => [r.worker.name, catLabel(r.worker.category), String(r.days), String(r.earned), String(r.paid), String(r.balance)]),
    ];
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily-wages-report-${todayISO()}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Label>From:</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" />
          <Label>To:</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" />
          <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo(''); }}>Reset</Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold">Worker-wise Summary</h3>
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Worker</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Earned</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byWorker.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No activity in range</TableCell></TableRow>
              ) : byWorker.map(r => (
                <TableRow key={r.worker.id}>
                  <TableCell className="font-medium">{r.worker.name}</TableCell>
                  <TableCell>{catLabel(r.worker.category)}</TableCell>
                  <TableCell className="text-right">{r.days}</TableCell>
                  <TableCell className="text-right">{fmt(r.earned)}</TableCell>
                  <TableCell className="text-right">{fmt(r.paid)}</TableCell>
                  <TableCell className={`text-right font-bold ${r.balance > 0 ? 'text-amber-600' : r.balance < 0 ? 'text-blue-600' : ''}`}>
                    {r.balance === 0 ? '—' : fmt(Math.abs(r.balance)) + (r.balance > 0 ? ' due' : ' adv')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold">Branch / Department Cost</h3>
        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Branch / Department</TableHead><TableHead className="text-right">Labor Cost</TableHead></TableRow></TableHeader>
            <TableBody>
              {branchMap.size === 0 ? (
                <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">—</TableCell></TableRow>
              ) : [...branchMap.entries()].map(([name, amt]) => (
                <TableRow key={name}><TableCell>{name}</TableCell><TableCell className="text-right font-bold">{fmt(amt)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ---------------- Audit Tab ----------------
function AuditTab() {
  const log = getWageAuditLog();
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2"><History className="h-4 w-4" /><h3 className="font-semibold">Audit Log</h3>
        <Badge variant="secondary">{log.length}</Badge></div>
      <div className="border rounded-md overflow-x-auto max-h-[600px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Subject</TableHead><TableHead>By</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {log.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No activity yet</TableCell></TableRow>
            ) : log.map(l => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">{new Date(l.at).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{l.action.replace(/_/g, ' ')}</Badge></TableCell>
                <TableCell>{l.subjectName || '—'}</TableCell>
                <TableCell>{l.byName || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

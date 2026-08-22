import { useState, useMemo } from 'react';
import { money } from '@/lib/currency';
import { getBranches, saveBranch, deleteBranch, genId, getOrders, getTransactions, getCurrentBranchId, setCurrentBranchId } from '@/lib/store';
import { getSettings } from '@/lib/store';
import { Branch, Order } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Edit3, Trash2, Building2, CheckCircle2, BarChart3, TrendingUp, Receipt, MapPin, Navigation, Search, Copy } from 'lucide-react';
import { toast } from 'sonner';
import LeafletMap from '@/components/LeafletMap';
import { geocodeAddress, reverseGeocode, getBrowserLocation } from '@/lib/geo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import BranchInvoicePreview from '@/components/BranchInvoicePreview';

/** Inline validation for the branch form. Returns field -> message (only invalid fields). */
function validateBranch(b: Branch): Record<string, string> {
  const e: Record<string, string> = {};
  if (!b.name?.trim()) e.name = 'Branch name is required.';
  else if (b.name.trim().length > 60) e.name = 'Keep the name under 60 characters so it fits on the receipt.';

  const email = (b.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) e.email = 'Enter a valid email, e.g. branch@restaurant.com';

  const phone = (b.phone || '').trim();
  if (phone && !/^[0-9+()\-\s]{7,20}$/.test(phone)) e.phone = 'Use digits only (7-20), optionally with + ( ) or -';

  const code = (b.branchCode || '').trim();
  if (code && !/^[A-Za-z0-9-]{2,10}$/.test(code)) e.branchCode = '2-10 letters/numbers, e.g. BWL or BWL-01';

  const tax = (b.taxNumber || '').trim();
  if (tax && !/^[A-Za-z0-9\-/]{5,25}$/.test(tax)) e.taxNumber = '5-25 characters: letters, numbers, - or / only';

  const reg = (b.registrationNumber || '').trim();
  if (reg && !/^[A-Za-z0-9\-/]{3,30}$/.test(reg)) e.registrationNumber = '3-30 characters: letters, numbers, - or / only';

  const prefix = (b.invoicePrefix || '').trim();
  if (prefix && !/^[A-Za-z0-9-]{1,8}$/.test(prefix)) e.invoicePrefix = 'Max 8 characters, letters/numbers/dash, e.g. BWL-';

  if ((b.invoiceFooter || '').length > 120) e.invoiceFooter = 'Footer is too long for an 80mm receipt (max 120 characters).';

  if (b.lat != null && (b.lat < -90 || b.lat > 90)) e.lat = 'Latitude must be between -90 and 90.';
  if (b.lng != null && (b.lng < -180 || b.lng > 180)) e.lng = 'Longitude must be between -180 and 180.';
  return e;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[10px] font-semibold text-destructive mt-0.5">{msg}</p>;
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>(getBranches());
  const [editing, setEditing] = useState<Branch | null>(null);
  const [viewing, setViewing] = useState<Branch | null>(null);
  const [currentId, setCurrentIdState] = useState<string | null>(getCurrentBranchId());
  const orders = useMemo(() => getOrders(), []);
  const transactions = useMemo(() => getTransactions(), []);
  const enabledCities = useMemo(() => getSettings().enabledCities || [], [editing]);
  const settings = useMemo(() => getSettings(), [editing]);
  const [isNew, setIsNew] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const errors = useMemo(() => (editing ? validateBranch(editing) : {}), [editing]);

  const refresh = () => setBranches(getBranches());

  const newBranch = () => {
    setShowErrors(false); setIsNew(true);
    setEditing({
      id: genId(), name: '', address: '', phone: '',
      isActive: true, sortOrder: branches.length,
    });
  };

  const openEdit = (b: Branch) => { setShowErrors(false); setIsNew(false); setEditing(b); };

  /** Copy an existing branch's settings into the new branch draft (name/coords stay blank). */
  const copyFrom = (sourceId: string) => {
    const src = branches.find(b => b.id === sourceId);
    if (!src || !editing) return;
    setEditing({
      ...editing,
      address: src.address, city: src.city, phone: src.phone,
      email: src.email, registrationNumber: src.registrationNumber,
      taxNumber: src.taxNumber, invoicePrefix: src.invoicePrefix,
      invoiceFooter: src.invoiceFooter, serviceRadiusKm: src.serviceRadiusKm,
      isActive: true,
    });
    toast.success(`Settings copied from ${src.name}. Change the name and location.`);
  };

  const handleSave = (b: Branch) => {
    const errs = validateBranch(b);
    if (Object.keys(errs).length > 0) {
      setShowErrors(true);
      toast.error('Please fix the highlighted fields.');
      return;
    }
    saveBranch(b); refresh(); setEditing(null); toast.success('Branch saved');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this branch? Existing orders will remain tagged with this branch ID.')) return;
    deleteBranch(id); refresh();
    if (currentId === id) { setCurrentBranchId(null); setCurrentIdState(null); }
  };

  const switchTo = (id: string) => {
    setCurrentBranchId(id); setCurrentIdState(id);
    toast.success(`Switched to ${branches.find(b => b.id === id)?.name}`);
  };

  const statsFor = (id: string) => {
    const list = orders.filter(o => o.branchId === id);
    return {
      total: list.length,
      revenue: list.filter(o => o.status === 'paid').reduce((s, o) => s + o.grandTotal, 0),
    };
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2"><Building2 className="h-5 w-5" /> Branches</h2>
        <Button onClick={newBranch}><Plus className="h-4 w-4 mr-1" /> Add Branch</Button>
      </div>

      <Card className="p-3 bg-muted/30">
        <div className="text-xs text-muted-foreground">
          Add multiple branches (e.g. Jhang Main, Faisalabad, Lahore) and switch active branch from the header.
          New orders are auto-tagged with the active branch for branch-wise reporting.
        </div>
      </Card>

      {branches.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No branches yet. Click "Add Branch" to create your first branch.
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {branches.map(b => {
          const s = statsFor(b.id);
          const isCurrent = currentId === b.id;
          return (
            <Card key={b.id} className={`p-4 space-y-2 ${isCurrent ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold flex items-center gap-2">
                    {b.name}
                    {isCurrent && <Badge className="text-[9px]"><CheckCircle2 className="h-3 w-3 mr-0.5" /> Active</Badge>}
                    {!b.isActive && <Badge variant="outline" className="text-[9px]">Inactive</Badge>}
                  </div>
                  {b.address && <div className="text-xs text-muted-foreground">{b.address}</div>}
                  {b.phone && <div className="text-xs text-muted-foreground">{b.phone}</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center pt-2 border-t">
                <div>
                  <div className="text-[10px] text-muted-foreground">Orders</div>
                  <div className="text-sm font-bold">{s.total}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">Revenue</div>
                  <div className="text-sm font-bold text-primary">{money(s.revenue)}</div>
                </div>
              </div>
              <div className="flex gap-1 pt-1">
                {!isCurrent && b.isActive && (
                  <Button size="sm" className="flex-1 h-7 text-[11px]" onClick={() => switchTo(b.id)}>
                    Set Active
                  </Button>
                )}
                <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => setViewing(b)}>
                  <BarChart3 className="h-3 w-3 mr-1" /> View
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => openEdit(b)}>
                  <Edit3 className="h-3 w-3 mr-1" /> Edit
                </Button>
                {b.lat && b.lng && (
                  <a href={`#/live-map`} className="inline-flex items-center text-[11px] text-primary hover:underline h-7 px-2">
                    <MapPin className="h-3 w-3 mr-1" /> Map
                  </a>
                )}
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleDelete(b.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {viewing && (() => {
        const list = orders.filter(o => o.branchId === viewing.id);
        const paid = list.filter(o => o.status === 'paid');
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const sevenDays = startOfDay - 6 * 86400000;
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const sumIn = (arr: Order[], since: number) => arr.filter(o => new Date(o.paidAt || o.createdAt).getTime() >= since).reduce((s, o) => s + (o.grandTotal || 0), 0);
        const today = sumIn(paid, startOfDay);
        const week = sumIn(paid, sevenDays);
        const month = sumIn(paid, monthStart);
        const byMethod: Record<string, number> = {};
        paid.forEach(o => { const m = o.paymentMethod || 'cash'; byMethod[m] = (byMethod[m] || 0) + (o.grandTotal || 0); });
        const txns = transactions.filter((t: any) => (t.branchId ? t.branchId === viewing.id : true));
        const income = txns.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + t.amount, 0);
        const expense = txns.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + t.amount, 0);
        // Top items for this branch
        const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
        paid.forEach(o => o.items.forEach(it => {
          const e = itemMap.get(it.menuItemId) || { name: it.name, qty: 0, revenue: 0 };
          e.qty += it.quantity || 0;
          e.revenue += it.lineTotal || 0;
          itemMap.set(it.menuItemId, e);
        }));
        const topItems = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

        return (
          <Dialog open onOpenChange={() => setViewing(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" /> {viewing.name} — Branch Report
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <Card className="p-3 text-center">
                    <div className="text-[10px] text-muted-foreground">Today</div>
                    <div className="text-lg font-bold text-primary">{money(today)}</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] text-muted-foreground">7 Days</div>
                    <div className="text-lg font-bold">{money(week)}</div>
                  </Card>
                  <Card className="p-3 text-center">
                    <div className="text-[10px] text-muted-foreground">This Month</div>
                    <div className="text-lg font-bold">{money(month)}</div>
                  </Card>
                </div>

                <Card className="p-3">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1"><Receipt className="h-3.5 w-3.5" /> Payment Breakdown</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {Object.entries(byMethod).length === 0 && <div className="text-muted-foreground col-span-2">No paid orders yet.</div>}
                    {Object.entries(byMethod).map(([m, v]) => (
                      <div key={m} className="flex justify-between border-b pb-1">
                        <span className="capitalize">{m}</span>
                        <span className="font-semibold">{money(v)}</span>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-3">
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> Accounts Summary</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><div className="text-muted-foreground">Income</div><div className="font-bold text-green-600">{money(income)}</div></div>
                    <div><div className="text-muted-foreground">Expense</div><div className="font-bold text-red-600">{money(expense)}</div></div>
                    <div><div className="text-muted-foreground">Net</div><div className="font-bold">{money((income - expense))}</div></div>
                  </div>
                </Card>

                <Card className="p-3">
                  <div className="text-xs font-semibold mb-2">Top 5 Items</div>
                  {topItems.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No sales data.</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b">
                        <tr><th className="text-left py-1">Item</th><th className="text-right">Qty</th><th className="text-right">Revenue</th></tr>
                      </thead>
                      <tbody>
                        {topItems.map((it, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1">{it.name}</td>
                            <td className="text-right">{it.qty}</td>
                            <td className="text-right font-semibold">{money(it.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>

                <div className="flex gap-2 justify-end">
                  {currentId !== viewing.id && viewing.isActive && (
                    <Button onClick={() => { switchTo(viewing.id); setViewing(null); }}>Set Active & Close</Button>
                  )}
                  <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col p-0 gap-0">
            <DialogHeader className="px-5 pt-5 pb-3 shrink-0 border-b"><DialogTitle>{branches.find(b => b.id === editing.id) ? 'Edit' : 'Add'} Branch</DialogTitle></DialogHeader>
            {/* Left: fields (scroll). Right: live receipt preview. Active + Save stay pinned. */}
            <div className="flex flex-1 min-h-0">
            <div className="space-y-3 overflow-y-auto px-5 py-4 flex-1 min-h-0">

              {isNew && branches.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-2.5">
                  <label className="text-xs font-semibold flex items-center gap-1"><Copy className="h-3.5 w-3.5" /> Copy settings from an existing branch</label>
                  <Select onValueChange={copyFrom}>
                    <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Choose a branch to copy…" /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Copies city, phone, email, tax/registration numbers, invoice prefix/footer and delivery radius. Name and map location stay empty.
                  </p>
                </div>
              )}


              <div>
                <label className="text-xs font-medium">Branch Name *</label>
                <Input aria-invalid={showErrors && !!errors.name} className={showErrors && errors.name ? 'border-destructive' : ''} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Jhang Main" />
                {showErrors && <FieldError msg={errors.name} />}
              </div>
              <div>
                <label className="text-xs font-medium">Address</label>
                <Input value={editing.address || ''} onChange={e => setEditing({ ...editing, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">City</label>
                  {enabledCities.length > 0 ? (
                    <Select value={editing.city || ''} onValueChange={v => setEditing({ ...editing, city: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose city" /></SelectTrigger>
                      <SelectContent>
                        {enabledCities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={editing.city || ''} onChange={e => setEditing({ ...editing, city: e.target.value })} placeholder="e.g. Jhang" />
                  )}
                  {enabledCities.length === 0 && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Settings → 📍 Cities mein apni cities select karein taake yahan dropdown ban jaye.
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium">Phone</label>
                  <Input className={showErrors && errors.phone ? 'border-destructive' : ''} value={editing.phone || ''} onChange={e => setEditing({ ...editing, phone: e.target.value })} placeholder="0300-1234567" />
                  {showErrors && <FieldError msg={errors.phone} />}
                </div>
              </div>
              {/* Invoice identity — all optional. Empty fields are never printed on the bill. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Branch Code</label>
                  <Input className={showErrors && errors.branchCode ? 'border-destructive' : ''} value={editing.branchCode || ''} onChange={e => setEditing({ ...editing, branchCode: e.target.value })} placeholder="e.g. BWL" />
                  {showErrors && <FieldError msg={errors.branchCode} />}
                </div>
                <div>
                  <label className="text-xs font-medium">Email</label>
                  <Input className={showErrors && errors.email ? 'border-destructive' : ''} value={editing.email || ''} onChange={e => setEditing({ ...editing, email: e.target.value })} placeholder="branch@restaurant.com" />
                  {showErrors && <FieldError msg={errors.email} />}
                </div>
                <div>
                  <label className="text-xs font-medium">Registration No.</label>
                  <Input className={showErrors && errors.registrationNumber ? 'border-destructive' : ''} value={editing.registrationNumber || ''} onChange={e => setEditing({ ...editing, registrationNumber: e.target.value })} placeholder="Optional" />
                  {showErrors && <FieldError msg={errors.registrationNumber} />}
                </div>
                <div>
                  <label className="text-xs font-medium">Tax No. (NTN / STRN / VAT)</label>
                  <Input className={showErrors && errors.taxNumber ? 'border-destructive' : ''} value={editing.taxNumber || ''} onChange={e => setEditing({ ...editing, taxNumber: e.target.value })} placeholder="Optional" />
                  {showErrors && <FieldError msg={errors.taxNumber} />}
                </div>
                <div>
                  <label className="text-xs font-medium">Invoice Prefix</label>
                  <Input className={showErrors && errors.invoicePrefix ? 'border-destructive' : ''} value={editing.invoicePrefix || ''} onChange={e => setEditing({ ...editing, invoicePrefix: e.target.value })} placeholder="e.g. BWL-" />
                  {showErrors && <FieldError msg={errors.invoicePrefix} />}
                </div>
                <div>
                  <label className="text-xs font-medium flex items-center justify-between">
                    <span>Invoice Footer</span>
                    <span className="text-[10px] text-muted-foreground font-normal">{(editing.invoiceFooter || '').length}/120</span>
                  </label>
                  <Input className={showErrors && errors.invoiceFooter ? 'border-destructive' : ''} value={editing.invoiceFooter || ''} onChange={e => setEditing({ ...editing, invoiceFooter: e.target.value })} placeholder="Optional footer line" />
                  {showErrors && <FieldError msg={errors.invoiceFooter} />}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground -mt-1">
                These fields are optional. Anything left empty is completely hidden on the printed invoice — no empty labels.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Latitude</label>
                  <Input type="number" step="0.000001" value={editing.lat ?? ''} onChange={e => setEditing({ ...editing, lat: e.target.value === '' ? undefined : parseFloat(e.target.value) })} placeholder="30.1693" />
                  {showErrors && <FieldError msg={errors.lat} />}
                </div>
                <div>
                  <label className="text-xs font-medium">Longitude</label>
                  <Input type="number" step="0.000001" value={editing.lng ?? ''} onChange={e => setEditing({ ...editing, lng: e.target.value === '' ? undefined : parseFloat(e.target.value) })} placeholder="72.6802" />
                  {showErrors && <FieldError msg={errors.lng} />}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium flex items-center justify-between">
                  <span>Service / Delivery Radius (km)</span>
                  <span className="text-[10px] text-muted-foreground font-normal">0 = no limit</span>
                </label>
                <Input
                  type="number" min="0" step="0.5"
                  value={editing.serviceRadiusKm ?? ''}
                  onChange={e => setEditing({ ...editing, serviceRadiusKm: e.target.value === '' ? undefined : Math.max(0, parseFloat(e.target.value) || 0) })}
                  placeholder="e.g. 5"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Customer ki live location is radius se bahar hui to online order place nahi ho sake ga ("Out of service area").
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={async () => {
                  if (!editing.address) { toast.error('Enter an address first'); return; }
                  const t = toast.loading('Searching address…');
                  const r = await geocodeAddress(`${editing.address}${editing.city ? ', ' + editing.city : ''}, Pakistan`);
                  toast.dismiss(t);
                  if (!r) { toast.error('Address not found'); return; }
                  setEditing({ ...editing, lat: r.lat, lng: r.lng, city: editing.city || r.city || '' });
                  toast.success('Coordinates auto-filled');
                }}><Search className="h-3.5 w-3.5 mr-1" /> Find from Address</Button>
                <Button type="button" size="sm" variant="secondary" onClick={async () => {
                  const t = toast.loading('Detecting the live location of this device…');
                  try {
                    if (!navigator.geolocation) throw new Error('This browser does not support GPS');
                    // Permission check (where supported) — give clear message if blocked
                    try {
                      // @ts-ignore
                      const perm = navigator.permissions && await navigator.permissions.query({ name: 'geolocation' as any });
                      if (perm && perm.state === 'denied') {
                        throw new Error('Location permission is BLOCKED. From the lock icon in the browser address bar, allow "Location", then try again.');
                      }
                    } catch {}
                    const pos = await getBrowserLocation({ timeoutMs: 8000 });
                    const acc = Math.round(pos.coords.accuracy);
                    const r = await reverseGeocode(pos.coords.latitude, pos.coords.longitude).catch(() => null);
                    toast.dismiss(t);
                    setEditing({
                      ...editing,
                      lat: pos.coords.latitude, lng: pos.coords.longitude,
                      address: editing.address || r?.displayName || editing.address,
                      city: editing.city || r?.city || editing.city,
                    });
                    if (acc > 200) {
                      toast.warning(`Location set (±${acc}m). For better accuracy, turn on "Precise location" on your phone or try in the open. You can also drag the pin on the map.`);
                    } else {
                      toast.success(`Live location set (±${acc}m)`);
                    }
                  } catch (e: any) {
                    toast.dismiss(t);
                    toast.error(e?.message || 'Location denied');
                  }
                }}><Navigation className="h-3.5 w-3.5 mr-1" /> Use Current Location</Button>

              </div>
              {editing.lat && editing.lng ? (
                <div className="rounded-md overflow-hidden border">
                  <LeafletMap
                    markers={[{ id: editing.id, lat: editing.lat, lng: editing.lng, title: editing.name || 'Branch', color: 'gold', draggable: true }]}
                    circles={editing.serviceRadiusKm && editing.serviceRadiusKm > 0 ? [{
                      id: 'radius', lat: editing.lat, lng: editing.lng,
                      radiusM: editing.serviceRadiusKm * 1000,
                      color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.1,
                    }] : []}
                    height={220} zoom={16}
                    onMarkerDragEnd={(_id, lat, lng) => setEditing({ ...editing, lat, lng })}
                    onMapClick={(lat, lng) => setEditing({ ...editing, lat, lng })}
                  />
                  <p className="text-[10px] text-muted-foreground px-1 pt-1">
                    Pin galat jagah ho to map par drag karein ya sahi jagah click karein.
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Address likh kar "Find from Address" dabayein, ya "Use Current Location" instead.
                </p>
              )}

            </div>
            {/* Live receipt preview — reflects unsaved edits instantly. */}
            <div className="hidden lg:flex flex-col w-[330px] shrink-0 border-l bg-muted/30 overflow-y-auto px-4 py-4">
              <div className="text-xs font-semibold flex items-center gap-1 mb-2">
                <Receipt className="h-3.5 w-3.5" /> Receipt Preview (80mm)
              </div>
              <BranchInvoicePreview branch={editing} settings={settings} />
              <p className="text-[10px] text-muted-foreground mt-2">
                Sample data. Only filled fields appear — empty ones are hidden on the real print.
              </p>
            </div>
            </div>
            <div className="shrink-0 border-t px-5 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">Active</span>
                <Switch checked={editing.isActive} onCheckedChange={v => setEditing({ ...editing, isActive: v })} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={() => handleSave(editing)}>Save</Button>
              </div>
            </div>
          </DialogContent>

        </Dialog>
      )}
    </div>
  );
}

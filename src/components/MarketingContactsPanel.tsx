import { firestoreUnavailable } from '@/lib/legacyFirebaseGuard';
// Marketing Contacts panel — Super Admin manually adds clients for marketing
// Includes inline add/edit, list, search, WhatsApp/call shortcuts, link-to-tenant, manage billing.
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Users, Plus, Trash2, Edit3, Check, X, Phone, Download, Search, MapPin, Link2, Receipt,
} from 'lucide-react';
import {
  MarketingContact, fetchContacts, createContact, updateContact, deleteContact, CONTACT_SOURCES,
} from '@/lib/marketingContacts';
import { exportClientsToExcel, exportClientsToCSV, exportClientsToPDF } from '@/lib/clientExport';
import { fbDb } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import ClientBillingDialog from '@/components/ClientBillingDialog';

interface TenantLite {
  id: string;
  restaurantName?: string;
  email?: string;
  plan?: string;
  planExpiryAt?: any;
}

export default function MarketingContactsPanel() {
  const [items, setItems] = useState<MarketingContact[]>([]);
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MarketingContact | null>(null);
  const [linkFor, setLinkFor] = useState<MarketingContact | null>(null);
  const [billingFor, setBillingFor] = useState<MarketingContact | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      if (firestoreUnavailable()) {
        // Supabase backend: contacts live in admin_marketing_contacts and the
        // restaurant list comes from tenants. Returning early here is what made
        // a newly added client vanish on refresh — nothing was ever loaded.
        const { sb } = await import('@/lib/supabase');
        const [contacts, tenantRes] = await Promise.all([
          fetchContacts(),
          sb().from('tenants').select('id,name,plan,plan_expires_at').order('created_at', { ascending: false }),
        ]);
        setItems(contacts);
        setTenants((tenantRes.data ?? []).map((t: any) => ({
          id: t.id, restaurantName: t.name, plan: t.plan, planExpiryAt: t.plan_expires_at,
        })));
        setLoading(false);
        return;
      }
      const [contacts, idxSnap] = await Promise.all([
        fetchContacts(),
        getDocs(collection(fbDb(), 'userIndex')),
      ]);
      setItems(contacts);
      const ts: TenantLite[] = [];
      idxSnap.forEach(d => { const x = d.data() as any; ts.push({ id: d.id, ...x }); });
      setTenants(ts);
    } catch (e: any) { toast.error(e?.message || 'Load failed'); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase().trim();
    if (!f) return items;
    return items.filter(c =>
      (c.name || '').toLowerCase().includes(f) ||
      (c.ownerName || '').toLowerCase().includes(f) ||
      (c.restaurantName || '').toLowerCase().includes(f) ||
      (c.city || '').toLowerCase().includes(f) ||
      (c.phone || '').includes(f)
    );
  }, [items, filter]);

  const onDelete = async (c: MarketingContact) => {
    if (!confirm(`Delete contact "${c.name}"?`)) return;
    try { await deleteContact(c.id); toast.success('Deleted'); load(); }
    catch (e: any) { toast.error(e?.message); }
  };

  const tenantById = (id?: string) => tenants.find(t => t.id === id);

  const exportRows = () => filtered.map(c => {
    const t = tenantById(c.linkedTenantId);
    return {
      restaurantName: c.restaurantName || '(no restaurant)',
      ownerEmail: t?.email || '',
      phone: c.phone || '',
      city: c.city || '',
      address: c.address || '',
      plan: c.source || 'Marketing',
      planExpiry: '—',
      daysLeft: '—',
      activeDevices: 0,
      tenantId: `Owner: ${c.ownerName || c.name}${c.notes ? ' · ' + c.notes : ''}`,
    };
  });

  const onExcel = () => { if (!filtered.length) return toast.error('No contacts'); exportClientsToExcel(exportRows()); toast.success('Excel downloaded'); };
  const onCSV   = () => { if (!filtered.length) return toast.error('No contacts'); exportClientsToCSV(exportRows()); toast.success('CSV downloaded'); };
  const onPDF   = () => { if (!filtered.length) return toast.error('No contacts'); exportClientsToPDF(exportRows()); toast.success('PDF downloaded'); };

  return (
    <div className="space-y-3 border rounded-xl p-3 bg-card/50">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Users className="h-5 w-5 text-violet-600 shrink-0" />
          <div className="min-w-0">
            <div className="font-extrabold text-sm">Marketing Contacts ({items.length})</div>
            <div className="text-[10px] text-muted-foreground">Owner + restaurant + linked devices · billing per client</div>
          </div>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="bg-violet-600 hover:bg-violet-700 text-white">
          <Plus className="h-4 w-4 mr-1" /> Add Contact
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search name, owner, restaurant, city, phone…" className="pl-7 h-8 text-xs" />
        </div>
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onExcel}>
          <Download className="h-3.5 w-3.5 mr-1" /> Excel
        </Button>
        <Button size="sm" variant="outline" onClick={onCSV}>
          <Download className="h-3.5 w-3.5 mr-1" /> CSV
        </Button>
        <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={onPDF}>
          <Download className="h-3.5 w-3.5 mr-1" /> PDF
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground text-center py-6">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-6 text-center bg-muted/30 rounded-lg border border-dashed">
          {items.length === 0
            ? 'No marketing contacts yet — start with "Add Contact".'
            : 'Nothing matched your search.'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(c => {
            const t = tenantById(c.linkedTenantId);
            return (
              <div key={c.id} className="border rounded-lg p-2.5 bg-card flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {(c.restaurantName || c.ownerName || c.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm truncate">
                      {c.restaurantName || '(no restaurant)'}
                      {c.ownerName && <span className="text-[11px] text-violet-700 font-bold ml-1">· Owner: {c.ownerName}</span>}
                      <span className="text-[10px] text-muted-foreground font-normal ml-1">· Lead: {c.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                      {c.phone && <span><Phone className="h-2.5 w-2.5 inline mr-0.5" />{c.phone}</span>}
                      {c.city && <span><MapPin className="h-2.5 w-2.5 inline mr-0.5" />{c.city}</span>}
                      {c.source && <span className="px-1 bg-violet-500/10 text-violet-700 rounded">{c.source}</span>}
                      {t && <span className="px-1 bg-green-500/10 text-green-700 rounded">🔗 {t.restaurantName || t.email || 'Linked'}</span>}
                      {c.linkedDeviceIds && c.linkedDeviceIds.length > 0 && (
                        <span className="px-1 bg-blue-500/10 text-blue-700 rounded">📱 {c.linkedDeviceIds.length} device(s)</span>
                      )}
                    </div>
                    {c.address && <div className="text-[10px] text-muted-foreground truncate">📍 {c.address}</div>}
                    {c.notes && <div className="text-[10px] italic text-muted-foreground truncate">💬 {c.notes}</div>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 flex-wrap">
                  {c.phone && (
                    <a target="_blank" rel="noreferrer" href={`https://wa.me/${c.phone.replace(/[^0-9]/g, '')}`}>
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white h-7 px-2">
                        <Phone className="h-3 w-3" />
                      </Button>
                    </a>
                  )}
                  <Button size="sm" variant="outline" className="h-7 px-2 border-violet-500/40 text-violet-700"
                    onClick={() => setLinkFor(c)}>
                    <Link2 className="h-3 w-3 mr-1" /> Link
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 border-amber-500/40 text-amber-700"
                    onClick={() => {
                      if (!c.linkedTenantId) { toast.error('Link a restaurant first'); return; }
                      setBillingFor(c);
                    }}>
                    <Receipt className="h-3 w-3 mr-1" /> Billing
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setEditing(c); setShowForm(true); }}>
                    <Edit3 className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600" onClick={() => onDelete(c)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <ContactForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}
      {linkFor && (
        <LinkDialog contact={linkFor} tenants={tenants}
          onClose={() => setLinkFor(null)}
          onSaved={() => { setLinkFor(null); load(); }} />
      )}
      {billingFor && billingFor.linkedTenantId && (
        <ClientBillingDialog
          tenantId={billingFor.linkedTenantId}
          restaurantName={billingFor.restaurantName || tenantById(billingFor.linkedTenantId)?.restaurantName || 'Client'}
          email={tenantById(billingFor.linkedTenantId)?.email}
          planId={tenantById(billingFor.linkedTenantId)?.plan || 'trial'}
          planExpiryAt={tenantById(billingFor.linkedTenantId)?.planExpiryAt}
          onClose={() => setBillingFor(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function ContactForm({ initial, onClose, onSaved }: {
  initial: MarketingContact | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [ownerName, setOwnerName] = useState(initial?.ownerName || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [city, setCity] = useState(initial?.city || '');
  const [restaurantName, setRestaurantName] = useState(initial?.restaurantName || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [source, setSource] = useState(initial?.source || 'Facebook Ads');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim() && !restaurantName.trim()) {
      toast.error('A name or restaurant name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), ownerName: ownerName.trim(),
        phone: phone.trim(), city: city.trim(),
        restaurantName: restaurantName.trim(), address: address.trim(),
        notes: notes.trim(), source: source.trim(),
      };
      if (initial) { await updateContact(initial.id, payload); toast.success('Contact updated'); }
      else { await createContact(payload); toast.success('Contact added'); }
      onSaved();
    } catch (e: any) { toast.error(e?.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl shadow-2xl max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-violet-600" />
            {initial ? 'Edit Contact' : 'Add Marketing Contact'}
          </h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Lead / Contact Name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ali Khan" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Restaurant Owner Name</label>
            <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Owner (purchaser)" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Restaurant / Business Name *</label>
          <Input value={restaurantName} onChange={e => setRestaurantName(e.target.value)} placeholder="e.g. Ali Burgers" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">Phone</label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="03xx-xxxxxxx" />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground">City</label>
            <Input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Jhang" />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Source</label>
          <select value={source} onChange={e => setSource(e.target.value)}
            className="w-full h-10 border rounded-md px-3 text-sm bg-background">
            {CONTACT_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Address</label>
          <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Shop #, street, area" />
        </div>
        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Notes (optional)</label>
          <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Followup, interest, budget…" />
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            <Check className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : (initial ? 'Update' : 'Add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface DeviceLite { id: string; deviceName?: string; approved?: boolean; blocked?: boolean; }

function LinkDialog({ contact, tenants, onClose, onSaved }: {
  contact: MarketingContact; tenants: TenantLite[]; onClose: () => void; onSaved: () => void;
}) {
  const [linkedTenantId, setLinkedTenantId] = useState(contact.linkedTenantId || '');
  const [devices, setDevices] = useState<DeviceLite[]>([]);
  const [selectedDevs, setSelectedDevs] = useState<string[]>(contact.linkedDeviceIds || []);
  const [loadingDev, setLoadingDev] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tenantQ, setTenantQ] = useState('');

  useEffect(() => {
    if (!linkedTenantId) { setDevices([]); return; }
    setLoadingDev(true);
    (async () => {
      try {
        if (firestoreUnavailable()) {
          const { sb } = await import('@/lib/supabase');
          const { data, error } = await sb().from('devices')
            .select('id,device_label,approved').eq('tenant_id', linkedTenantId);
          if (error) throw error;
          setDevices((data ?? []).map((d: any) => ({ id: d.id, deviceName: d.device_label, approved: d.approved })));
        } else {
          const snap = await getDocs(collection(fbDb(), 'tenants', linkedTenantId, 'devices'));
          const list: DeviceLite[] = [];
          snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }));
          setDevices(list);
        }
      } catch (e: any) { toast.error(e?.message); }
      setLoadingDev(false);
    })();
  }, [linkedTenantId]);


  const filteredTenants = useMemo(() => {
    const q = tenantQ.toLowerCase().trim();
    if (!q) return tenants;
    return tenants.filter(t =>
      (t.restaurantName || '').toLowerCase().includes(q) ||
      (t.email || '').toLowerCase().includes(q)
    );
  }, [tenants, tenantQ]);

  const toggleDevice = (id: string) => {
    setSelectedDevs(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateContact(contact.id, {
        linkedTenantId: linkedTenantId || undefined,
        linkedDeviceIds: linkedTenantId ? selectedDevs : [],
      });
      toast.success('Linked');
      onSaved();
    } catch (e: any) { toast.error(e?.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-extrabold text-lg flex items-center gap-2">
            <Link2 className="h-5 w-5 text-violet-600" /> Link Restaurant & Devices
          </h3>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Contact: <strong>{contact.ownerName || contact.name}</strong> · {contact.restaurantName}
        </div>

        <div>
          <label className="text-[10px] uppercase font-bold text-muted-foreground">Search approved restaurants</label>
          <Input value={tenantQ} onChange={e => setTenantQ(e.target.value)} placeholder="Restaurant name or email" className="h-8 text-xs" />
        </div>
        <div className="border rounded-lg max-h-44 overflow-y-auto">
          <button type="button" onClick={() => setLinkedTenantId('')}
            className={`w-full text-left px-3 py-2 text-xs border-b ${!linkedTenantId ? 'bg-violet-500/10 font-bold' : 'hover:bg-muted/40'}`}>
            — None —
          </button>
          {filteredTenants.map(t => (
            <button key={t.id} type="button" onClick={() => setLinkedTenantId(t.id)}
              className={`w-full text-left px-3 py-2 text-xs border-b ${linkedTenantId === t.id ? 'bg-violet-500/10 font-bold text-violet-700' : 'hover:bg-muted/40'}`}>
              {t.restaurantName || '(no name)'} <span className="text-muted-foreground">· {t.email || t.id.slice(0, 12)}</span>
            </button>
          ))}
        </div>

        {linkedTenantId && (
          <div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">Select devices ({devices.length} total)</div>
            {loadingDev ? <div className="text-xs italic">Loading devices…</div> :
              devices.length === 0 ? <div className="text-xs italic text-muted-foreground">No devices found</div> :
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded-lg p-2">
                {devices.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 p-1 rounded">
                    <input type="checkbox" checked={selectedDevs.includes(d.id)} onChange={() => toggleDevice(d.id)} />
                    <span className="flex-1">{d.deviceName || d.id.slice(0, 18)}</span>
                    {d.approved && !d.blocked && <span className="text-[9px] bg-green-500/15 text-green-700 px-1 rounded">APPROVED</span>}
                    {d.blocked && <span className="text-[9px] bg-red-500/15 text-red-700 px-1 rounded">BLOCKED</span>}
                  </label>
                ))}
              </div>
            }
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-violet-600 hover:bg-violet-700 text-white">
            <Check className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save Link'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Customer Profile & My Addresses — v1.28.0
 *
 * The customer-facing half of the account. Everything here writes through
 * `public_customer_update`, which only ever touches the row belonging to the
 * session token; there is no client-side tenant filtering to defeat.
 *
 * Addresses live in `customers.addresses` (jsonb array, capped at 20 server
 * side). The first entry is the default and is what checkout prefills, so
 * "Set as default" simply moves an entry to the front.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  ArrowLeft, LogOut, MapPin, Plus, Trash2, Star, Save, Home, Crosshair, User, BellRing, Camera,
} from 'lucide-react';
import { customerUpdate, type CustomerProfile, type SavedAddress } from '@/lib/customerAccount';

function newId() {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* falls through */ }
  return `addr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const BLANK: SavedAddress = { id: '', label: '', address: '', city: '' };

export interface CustomerProfilePanelProps {
  open: boolean;
  onClose: () => void;
  tenantId: string | null;
  profile: CustomerProfile | null;
  /** Called with the saved profile so the page can refresh its own copy. */
  onSaved: (p: CustomerProfile) => void;
  /** "Deliver here" — hands an address back to the checkout form. */
  onUseAddress?: (a: SavedAddress) => void;
  onLogout: () => void;
}

export default function CustomerProfilePanel({
  open, onClose, tenantId, profile, onSaved, onUseAddress, onLogout,
}: CustomerProfilePanelProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadPhoto = async (file: File) => {
    // 2 MB matches the bucket's own file_size_limit; refusing here saves the
    // customer a slow upload that Postgres would reject at the end anyway.
    if (file.size > 2 * 1024 * 1024) { toast.error('Please choose a photo under 2 MB.'); return; }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const { uploadCustomerPhoto } = await import('@/lib/customerPhoto.functions');
      const { getCustomerToken } = await import('@/lib/customerAccount');
      const token = getCustomerToken(tenantId);
      if (!token) { toast.error('Please sign in again.'); return; }
      const r = await uploadCustomerPhoto({
        data: {
          token,
          contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
          base64: btoa(bin),
        },
      });
      if (!r.ok) {
        const why: Record<string, string> = {
          too_large: 'That photo is too large.',
          no_session: 'Please sign in again.',
          app_disabled: 'The app is switched off right now.',
        };
        toast.error(why[r.reason] ?? 'The photo could not be saved.');
        return;
      }
      setPhotoUrl(r.url);
      toast.success('Photo updated');
    } catch (e: any) {
      toast.error(e?.message || 'The photo could not be saved.');
    } finally {
      setUploading(false);
    }
  };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [city, setCity] = useState('');
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [draft, setDraft] = useState<SavedAddress | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  // Only meaningful inside the packaged app; the website has no FCM token.

  // Reload the form whenever the panel opens, so an edit abandoned last time
  // never leaks into this one.
  useEffect(() => {
    if (!open || !profile) return;
    setName(profile.name ?? '');
    setPhotoUrl(profile.photoUrl ?? null);
    setEmail(profile.email ?? '');
    setDob(profile.dateOfBirth ?? '');
    setCity(profile.city ?? '');
    const saved = Array.isArray(profile.addresses) ? profile.addresses : [];
    // A profile created before saved addresses existed still has the single
    // `address` column. Show it rather than an empty list.
    if (saved.length === 0 && profile.address) {
      setAddresses([{
        id: newId(), label: 'Home', address: profile.address,
        city: profile.city ?? undefined,
        lat: profile.lat ?? undefined, lng: profile.lng ?? undefined,
      }]);
    } else {
      setAddresses(saved);
    }
    setDraft(null);
  }, [open, profile]);

  // The server row is the truth about whether this account can be reached.
  useEffect(() => {
    if (!open || !profile) return;
  }, [open, profile]);

  if (!open || !profile) return null;

  const persist = async (next: {
    addresses?: SavedAddress[];
    name?: string; email?: string; dateOfBirth?: string; city?: string;
  }) => {
    setBusy(true);
    const list = next.addresses ?? addresses;
    const primary = list[0];
    const r = await customerUpdate({
      tenantId,
      name: next.name ?? name.trim(),
      email: next.email ?? email.trim(),
      city: next.city ?? city.trim(),
      dateOfBirth: next.dateOfBirth ?? dob,
      addresses: list,
      // Keep the flat columns in step with the default address — the POS,
      // the Rider App and the receipt all read `customers.address`.
      ...(primary ? { address: primary.address, lat: primary.lat, lng: primary.lng } : {}),
    });
    setBusy(false);
    if (!r.ok) { toast.error(r.message); return false; }
    onSaved(r.customer);
    return true;
  };

  const saveDetails = async () => {
    if (!name.trim()) { toast.error('Enter your name'); return; }
    if (await persist({})) toast.success('Profile saved');
  };

  const saveAddress = async () => {
    if (!draft) return;
    if (!draft.address.trim()) { toast.error('Enter the address'); return; }
    const entry: SavedAddress = {
      ...draft,
      id: draft.id || newId(),
      label: draft.label.trim() || 'Address',
      address: draft.address.trim(),
      city: (draft.city || '').trim() || undefined,
    };
    const exists = addresses.some(a => a.id === entry.id);
    const next = exists ? addresses.map(a => (a.id === entry.id ? entry : a)) : [...addresses, entry];
    if (next.length > 20) { toast.error('You can save up to 20 addresses'); return; }
    setAddresses(next);
    if (await persist({ addresses: next })) {
      setDraft(null);
      toast.success(exists ? 'Address updated' : 'Address saved');
    }
  };

  const removeAddress = async (id: string) => {
    const next = addresses.filter(a => a.id !== id);
    setAddresses(next);
    if (await persist({ addresses: next })) toast.success('Address removed');
  };

  const makeDefault = async (id: string) => {
    const hit = addresses.find(a => a.id === id);
    if (!hit) return;
    const next = [hit, ...addresses.filter(a => a.id !== id)];
    setAddresses(next);
    if (await persist({ addresses: next })) toast.success(`${hit.label} is now your default`);
  };

  const pinLocation = () => {
    if (!draft) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Your browser cannot share a location');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false);
        setDraft(d => (d ? { ...d, lat: pos.coords.latitude, lng: pos.coords.longitude } : d));
        // The browser gives an approximate position, not a survey point — say
        // so rather than implying it pinned the doorstep.
        toast.success('Approximate location attached');
      },
      () => { setLocating(false); toast.error('Could not read your location'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-background w-full max-w-md h-full overflow-y-auto pos-scrollbar shadow-elegant"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold truncate">My Profile</h2>
              <p className="text-[10px] text-muted-foreground truncate">{profile.phone}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5 mr-1" /> Logout
          </Button>
        </div>

        <div className="p-3 space-y-4">
          {/* ===== v1.32.0 — who this customer is, to themselves and to the shop =====
            *
            * The photo is uploaded by the server function, never by the browser:
            * the customer-photos bucket has a public READ policy and NO write
            * policy, so only the service key can put a file there. An anon write
            * policy on storage is the same shape as the order_items hole found in
            * v1.31.0 — anyone with the public key could have filled the bucket.
            *
            * The code exists because a uuid cannot be read down a phone line. */}
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <div className="h-16 w-16 rounded-full overflow-hidden bg-muted border flex items-center justify-center">
                {photoUrl
                  ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
                  : <User className="h-7 w-7 text-muted-foreground" />}
              </div>
              <label
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground
                           flex items-center justify-center cursor-pointer shadow"
                title="Change photo"
              >
                {uploading
                  ? <span className="text-[10px]">…</span>
                  : <Camera className="h-3.5 w-3.5" />}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadPhoto(f); }}
                />
              </label>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold truncate">{profile.name || 'Your profile'}</p>
              {profile.customerCode && (
                <p className="text-[11px] text-muted-foreground">
                  Customer ID <span className="font-mono font-bold text-foreground">{profile.customerCode}</span>
                </p>
              )}
              <p className="text-[10px] text-muted-foreground">Tell the restaurant this ID to find your orders.</p>
            </div>
          </div>

          {/* Loyalty / order summary — read-only, straight from the server row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-card border rounded-xl p-2.5 text-center">
              <div className="text-base font-extrabold text-primary">{profile.totalOrders}</div>
              <div className="text-[10px] text-muted-foreground">Orders</div>
            </div>
            <div className="bg-card border rounded-xl p-2.5 text-center">
              <div className="text-base font-extrabold text-primary">{profile.loyaltyPoints}</div>
              <div className="text-[10px] text-muted-foreground">Points</div>
            </div>
            <div className="bg-card border rounded-xl p-2.5 text-center">
              <div className="text-base font-extrabold text-primary">{addresses.length}</div>
              <div className="text-[10px] text-muted-foreground">Addresses</div>
            </div>
          </div>

          {/* Details */}
          <section className="space-y-2">
            <h3 className="text-xs font-extrabold flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-primary" /> My Details
            </h3>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Full Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} className="h-10 text-sm mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Mobile Number</label>
              <Input value={profile.phone ?? ''} readOnly disabled className="h-10 text-sm mt-1 opacity-70" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Your number is how the restaurant finds your orders — contact them to change it.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Email (optional)</label>
              <Input value={email} onChange={e => setEmail(e.target.value)} className="h-10 text-sm mt-1" type="email" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">City</label>
              <Input value={city} onChange={e => setCity(e.target.value)} className="h-10 text-sm mt-1" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-muted-foreground">Date of Birth</label>
              <Input
                value={dob}
                onChange={e => setDob(e.target.value)}
                className="h-10 text-sm mt-1"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">So the restaurant can send you a birthday offer.</p>
            </div>
            <Button className="w-full h-10" disabled={busy} onClick={saveDetails}>
              <Save className="h-4 w-4 mr-1.5" /> {busy ? 'Saving…' : 'Save Details'}
            </Button>
          </section>

          {/* Addresses */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-primary" /> My Addresses
              </h3>
              {!draft && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setDraft({ ...BLANK, id: '', city })}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
              )}
            </div>

            {draft && (
              <div className="bg-card border-2 border-primary/30 rounded-xl p-3 space-y-2">
                <Input
                  placeholder="Label (Home, Office, Mum's)"
                  value={draft.label}
                  onChange={e => setDraft({ ...draft, label: e.target.value })}
                  className="h-10 text-sm"
                />
                <Input
                  placeholder="House / street / area"
                  value={draft.address}
                  onChange={e => setDraft({ ...draft, address: e.target.value })}
                  className="h-10 text-sm"
                />
                <Input
                  placeholder="City"
                  value={draft.city || ''}
                  onChange={e => setDraft({ ...draft, city: e.target.value })}
                  className="h-10 text-sm"
                />
                <div className="flex items-center justify-between gap-2">
                  <Button variant="outline" size="sm" className="h-9 text-[11px] flex-1" disabled={locating} onClick={pinLocation}>
                    <Crosshair className="h-3.5 w-3.5 mr-1" />
                    {locating ? 'Locating…' : draft.lat != null ? 'Location attached' : 'Attach location'}
                  </Button>
                  {draft.lat != null && (
                    <button
                      className="text-[10px] text-muted-foreground underline"
                      onClick={() => setDraft({ ...draft, lat: undefined, lng: undefined })}
                    >
                      clear
                    </button>
                  )}
                </div>
                {draft.lat != null && (
                  <p className="text-[10px] text-muted-foreground">
                    Approximate location from your device — the rider still uses the written address.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button className="flex-1 h-9" disabled={busy} onClick={saveAddress}>
                    {busy ? 'Saving…' : 'Save Address'}
                  </Button>
                  <Button variant="ghost" className="h-9" onClick={() => setDraft(null)}>Cancel</Button>
                </div>
              </div>
            )}

            {addresses.length === 0 && !draft && (
              <p className="text-center text-xs text-muted-foreground py-6">
                No saved addresses yet. Add one so checkout fills itself in.
              </p>
            )}

            {addresses.map((a, i) => (
              <div key={a.id} className="bg-card border rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold flex items-center gap-1.5 min-w-0">
                    <Home className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">{a.label}</span>
                    {i === 0 && (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-primary/15 text-primary shrink-0">
                        Default
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {i !== 0 && (
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Set as default" disabled={busy} onClick={() => makeDefault(a.id)}>
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="Remove" disabled={busy} onClick={() => removeAddress(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground break-words">
                  {a.address}{a.city ? `, ${a.city}` : ''}
                </p>
                <div className="flex items-center justify-between pt-1 border-t">
                  <button className="text-[11px] text-primary underline" onClick={() => setDraft({ ...a })}>Edit</button>
                  {onUseAddress && (
                    <button
                      className="text-[11px] font-bold text-primary underline"
                      onClick={() => { onUseAddress(a); onClose(); }}
                    >
                      Deliver here →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

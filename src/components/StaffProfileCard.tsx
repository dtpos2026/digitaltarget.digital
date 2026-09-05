// ============================================================================
// A rider's / order taker's own profile — picture, name, phone.
//
// REPORTED: "rider ka profile me pic lga sky apna name wgara b, or asy he
// order taker b" — and, for the Order Taker, "apna profile" as a whole.
//
// The write RPC (portal_update_me) has existed since v1.41.0 and nothing in
// the app ever called it, so there was no way for a rider to set anything at
// all. This is that screen, shared by both portals so the two cannot drift.
//
// The photo goes through the Edge Function (lib/profilePhoto): the bucket has
// no write policy, and the SERVER picks the file path, so one staff member can
// never overwrite another's picture.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Save, User as UserIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Me { name: string; phone: string; photo: string | null; role: string; username: string }

export default function StaffProfileCard({ onSaved }: { onSaved?: (me: { name: string; phone: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const { hasPortalSession, portalMe } = await import('@/lib/portalData');
      if (!hasPortalSession()) return;
      const res = await portalMe();
      if (!res.ok || !res.data?.ok) return;
      const d = res.data as Record<string, any>;
      const next: Me = {
        name: String(d.name ?? ''),
        phone: String(d.phone ?? ''),
        photo: d.photo ? String(d.photo) : null,
        role: String(d.role ?? ''),
        username: String(d.username ?? ''),
      };
      setMe(next);
      setName(next.name);
      setPhone(next.phone);
    } catch { /* the card just stays closed */ }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      const { portalUpdateMe } = await import('@/lib/portalData');
      const res = await portalUpdateMe({ name: name.trim(), phone: phone.trim() });
      // A portal app has no Supabase session, so a write that silently matches
      // zero rows is the failure mode this whole area was built to stop. Say so.
      if (!res.ok) {
        toast.error(res.message || 'Could not save your profile. Please try again.');
        return;
      }
      if (res.data?.ok === false) {
        toast.error('Could not save your profile. Please try again.');
        return;
      }
      toast.success('Profile saved');
      setMe(m => (m ? { ...m, name: name.trim(), phone: phone.trim() } : m));
      onSaved?.({ name: name.trim(), phone: phone.trim() });
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { getPortalToken } = await import('@/lib/portalData');
      const { uploadProfilePhoto, photoErrorMessage } = await import('@/lib/profilePhoto');
      const token = getPortalToken();
      if (!token) { toast.error('Please sign in again.'); return; }
      const r = await uploadProfilePhoto({ kind: 'staff', token, file });
      if (!r.ok) { toast.error(photoErrorMessage(r.reason)); return; }
      setMe(m => (m ? { ...m, photo: r.url } : m));
      toast.success('Photo updated');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (!me) return null;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-xs font-semibold"
      >
        <span className="h-7 w-7 rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0">
          {me.photo
            ? <img src={me.photo} alt="" className="h-full w-full object-cover" />
            : <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}
        </span>
        <span className="min-w-0 text-left leading-tight">
          <span className="block truncate">{me.name || me.username}</span>
          <span className="block text-[10px] font-normal text-muted-foreground capitalize">
            {me.role.replace('_', ' ')} · My Profile
          </span>
        </span>
        <span className="ml-auto text-muted-foreground">{open ? 'Hide' : 'Edit'}</span>
      </button>

      {open && (
        <div className="border-t p-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="h-16 w-16 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                {me.photo
                  ? <img src={me.photo} alt="" className="h-full w-full object-cover" />
                  : <UserIcon className="h-6 w-6 text-muted-foreground" />}
              </div>
              <button
                type="button"
                title="Change photo"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={e => void pickPhoto(e.target.files?.[0])}
              />
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug">
              JPG, PNG or WEBP, under 2 MB.<br />
              Your picture shows on the order screen so the restaurant knows who is delivering.
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Phone</label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="03001234567" inputMode="tel" />
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={() => void save()} disabled={busy} className="flex-1">
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setName(me.name); setPhone(me.phone); setOpen(false); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Signed in as <span className="font-mono">{me.username}</span>. Your username and
            restaurant are set by the restaurant — only your name, phone and picture are yours to change.
          </p>
        </div>
      )}
    </div>
  );
}

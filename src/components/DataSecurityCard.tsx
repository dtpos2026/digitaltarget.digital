import { ShieldCheck, Lock, Database, Server, Eraser, Layers } from 'lucide-react';
import { getTenantId, getTenantName } from '@/lib/tenant';

/**
 * Read-only status card showing the data isolation & encryption posture.
 * - Server-side: Firestore rules scope every read/write to the owner's tenantId.
 * - Client-side: local cached data is AES-GCM encrypted with a tenant-derived key.
 * - On tenant switch any other tenant's encrypted cache is wiped from the device.
 */
export default function DataSecurityCard() {
  const tid = getTenantId();
  const name = getTenantName();

  const rows = [
    {
      icon: Server,
      title: 'Server-side Tenant Isolation',
      desc: 'Firestore security rules mean any user can only read and write data belonging to their own tenant. Cross-restaurant access is blocked at the server.',
      on: true,
    },
    {
      icon: Lock,
      title: 'AES-256 Local Encryption',
      desc: 'Data cached on the device is encrypted with a tenant-specific AES-GCM key. Another restaurant cannot decrypt it even on the same device.',
      on: true,
    },
    {
      icon: Database,
      title: 'Namespaced Cache',
      desc: 'Every key is prefixed `enc::<tenantId>::` — keys cannot collide, so there is zero chance of data mixing.',
      on: true,
    },
    {
      icon: ShieldCheck,
      title: 'Auto-wipe on Tenant Switch',
      desc: 'As soon as the login changes, encrypted entries belonging to the previous tenant are removed from the device.',
      on: true,
    },
    {
      icon: Eraser,
      title: 'Hard Wipe on Same-Browser Re-login',
      desc: 'If another restaurant logs in on the same browser, localStorage, sessionStorage, IndexedDB (Firestore offline) and CacheStorage are all hard-wiped. Not a trace of the previous data remains.',
      on: true,
    },
    {
      icon: Layers,
      title: 'Multi-Tab Safety',
      desc: 'If a different restaurant logs in on another tab, this tab reloads automatically and shows fresh data, preventing a mixed cache.',
      on: true,
    },
  ];

  return (
    <div className="border-2 border-emerald-500/30 bg-emerald-500/5 rounded-xl p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
            Data Security & Isolation — ACTIVE
          </h3>
          <p className="text-[11px] text-muted-foreground truncate">
            Tenant: <span className="font-mono font-bold">{name || '—'}</span>
            {tid && <span className="text-muted-foreground/70"> · {tid.slice(0, 8)}…</span>}
          </p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-white px-2 py-1 rounded-full">
          🔒 Encrypted
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {rows.map(r => (
          <div key={r.title} className="flex items-start gap-2 bg-background/60 border border-emerald-500/20 rounded-lg p-2.5">
            <r.icon className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[12px] font-bold flex items-center gap-1.5">
                {r.title}
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-[10px] text-muted-foreground border-t border-emerald-500/20 pt-2">
        💡 Defense-in-depth: Server-rules + Per-tenant AES-256-GCM encryption + Auto-wipe.
        One restaurant’s data is never mixed with or shared with another — guaranteed.
      </div>
    </div>
  );
}

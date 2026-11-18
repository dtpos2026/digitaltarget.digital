// The panel of the Users screen (v1.125.1): one person at a glance — how they sign in, where they work, what they can open and do, the
// rules on them and any change waiting for an admin — with the actions that used to be small row buttons. Never shows a password.
import { useMemo } from 'react';
import { KeyRound, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getBranches, getRightsRequests, getRightsRules } from '@/lib/store';
import { matchPreset } from '@/lib/orgStructure';
import { userLine, userPanel } from '@/lib/userPanel';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier', rider: 'Rider', order_taker: 'Order Taker' };

export default function UserDetail({ user, onEdit, onDelete }: { user: User; onEdit: () => void; onDelete: () => void }) {
  const branches = getBranches();
  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? 'Unknown branch';
  const m = useMemo(() => userPanel(user, { rules: getRightsRules(), requests: getRightsRequests(), branchName }), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const preset = matchPreset(user);
  const active = user.isActive !== false;
  return (
    <div className="min-w-0 space-y-4 break-words" data-user-panel={user.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', active ? 'bg-status-success/15 text-status-success' : 'bg-muted text-muted-foreground')} data-panel-status={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</span>
        <span className="text-xs text-muted-foreground" data-panel-line>{userLine(user, preset?.name, ROLE_LABEL[user.role] ?? user.role, branchName)}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Modules</div><div className="font-extrabold tabular-nums" data-panel-pages>{m.pageCount}<span className="text-xs font-semibold text-muted-foreground"> / {m.pageTotal}</span></div></div>
        <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Actions</div><div className="font-extrabold tabular-nums" data-panel-features>{m.featureCount}<span className="text-xs font-semibold text-muted-foreground"> / {m.featureTotal}</span></div></div>
        <div className="rounded-lg bg-muted/50 p-2"><div className="text-[10px] font-bold uppercase text-muted-foreground">Rules</div><div className="font-extrabold tabular-nums" data-panel-rules-count>{m.rules.length}</div></div>
      </div>

      <dl className="space-y-1 text-sm" data-panel-signin>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Signs in with</dt><dd className="font-semibold">{m.signIn === 'phone' ? 'Phone + PIN' : 'Username + password'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{m.signIn === 'phone' ? 'Phone' : 'Username'}</dt><dd className="font-mono text-xs font-semibold">{(m.signIn === 'phone' ? user.phone || user.username : user.username) || '—'}</dd></div>
        {m.signIn === 'username' && user.phone ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Phone</dt><dd className="font-mono text-xs font-semibold">{user.phone}</dd></div> : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} data-panel-edit><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button>
        <Button size="sm" variant="outline" asChild data-panel-rights><a href="#/rights-matrix"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Rights grid</a></Button>
        <Button size="sm" variant="outline" className="text-destructive" onClick={onDelete} data-panel-delete><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button>
      </div>

      {m.waiting.length > 0 && (
        <section data-panel-waiting>
          <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Waiting for an admin</h4>
          <ul className="space-y-1 text-sm">{m.waiting.map(w => <li key={w.id} className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-2.5 py-1.5">{w.summary} <span className="text-xs text-muted-foreground">· asked by {w.by}</span></li>)}</ul>
        </section>
      )}

      {m.rules.length > 0 && (
        <section data-panel-rules>
          <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Rules on this person</h4>
          <ul className="space-y-1 text-sm">
            {m.rules.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-2 rounded-lg border px-2.5 py-1.5">
                <Badge variant="outline" className="text-[10px] uppercase">{r.mode === 'limit' ? 'Limit' : 'Grant'}</Badge>
                <span className="font-semibold">{r.what}</span><span className="text-xs text-muted-foreground">{r.scope}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section data-panel-can-open>
        <h4 className="mb-1 flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground"><KeyRound className="h-3 w-3" aria-hidden /> Can open</h4>
        {m.isAdmin ? <p className="text-sm">Everything — an admin always has every module and every action, in every branch.</p> : m.pages.length === 0 ? <p className="text-sm text-muted-foreground">No module.</p> : (
          <div className="space-y-1.5">{m.pages.map(g => (
            <div key={g.group} className="text-sm"><span className="mr-1.5 text-[11px] font-bold uppercase text-muted-foreground">{g.group}</span>{g.titles.join(' · ')}</div>
          ))}</div>
        )}
      </section>

      {!m.isAdmin && (
        <section data-panel-can-do>
          <h4 className="mb-1 text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Can do</h4>
          {m.features.length === 0 ? <p className="text-sm text-muted-foreground">No action beyond taking orders.</p> : (
            <div className="space-y-1.5">{m.features.map(g => (
              <div key={g.group} className="text-sm"><span className="mr-1.5 text-[11px] font-bold uppercase text-muted-foreground">{g.group}</span>{g.titles.join(' · ')}</div>
            ))}</div>
          )}
        </section>
      )}
    </div>
  );
}

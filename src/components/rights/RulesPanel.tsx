// The "Rules & approvals" tab of Rights (v1.118.0): rights by branch, by hour and by date, and the requests an admin decides.
import { useMemo, useState } from 'react';
import { CalendarClock, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/layout/PageFrame';
import { genId, getBranches, getRightsRequests, getRightsRules, saveRightsRequest, saveRightsRule } from '@/lib/store';
import { logStaffAction } from '@/lib/staffAudit';
import { FEATURE_GROUP_ORDER, FEATURE_PERMISSIONS, GROUP_ORDER, PAGES } from '@/lib/permissions';
import { describeScope, mayDecide, ruleIssues, ruleNeedsApproval, type RightsRequest, type RightsRule, type RuleDraft } from '@/lib/rightsRules';
import { localDay } from '@/lib/productionPlan';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const rightTitle = (kind: 'page' | 'feature', key: string) => (kind === 'page' ? PAGES.find(p => p.key === key)?.title : FEATURE_PERMISSIONS.find(f => f.key === key)?.title) ?? key;
const blank = (): RuleDraft => ({ userId: '', userName: '', mode: 'limit', kind: 'feature', key: '', branchIds: [], fromTime: '', toTime: '', days: [], validFrom: '', validUntil: '', reason: '' });

export default function RulesPanel({ team, me, canEdit, applyRights }: { team: User[]; me: User | null; canEdit: boolean; applyRights: (before: User, after: User) => Promise<boolean> }) {
  const [version, setVersion] = useState(0);
  const today = localDay(new Date());
  const branches = useMemo(() => getBranches().filter(b => b.isActive !== false), []);
  const branchName = (id: string) => branches.find(b => b.id === id)?.name ?? id;
  const rules = useMemo(() => getRightsRules().filter(r => !r.revokedAt), [version]);
  const requests = useMemo(() => getRightsRequests(), [version]);
  const pending = requests.filter(r => r.status === 'pending');
  const decided = requests.filter(r => r.status !== 'pending').sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')).slice(0, 8);
  const people = team.filter(u => u.role !== 'admin');
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const refresh = () => setVersion(v => v + 1);

  const target = draft ? people.find(u => u.id === draft.userId) : undefined;
  const issues = draft ? ruleIssues(draft, target, today) : [];
  const gate = draft && me && target && draft.key ? ruleNeedsApproval(me, target, draft) : { needed: false as boolean, reason: undefined as string | undefined };

  const clean = (d: RuleDraft): RuleDraft => ({
    ...d, userName: target?.name ?? d.userName, reason: d.reason?.trim() || undefined,
    branchIds: d.branchIds?.length ? d.branchIds : undefined, days: d.days?.length ? d.days : undefined,
    fromTime: d.fromTime || undefined, toTime: d.toTime || undefined, validFrom: d.mode === 'grant' ? d.validFrom || undefined : undefined, validUntil: d.mode === 'grant' ? d.validUntil || undefined : undefined,
  });
  const save = () => {
    if (!draft || !me || !target || issues.length) return;
    const d = clean(draft);
    const what = `${d.mode === 'limit' ? 'Limit' : 'Grant'} ${rightTitle(d.kind, d.key)} · ${describeScope(d, branchName)}`;
    if (gate.needed) {
      const req: RightsRequest = { id: genId(), userId: target.id, userName: target.name, requestedBy: me.id, requestedByName: me.name, summary: `${target.name}: ${what}`, payload: { rule: d }, reason: d.reason, status: 'pending', createdAt: new Date().toISOString() };
      saveRightsRequest(req);
      logStaffAction('RIGHTS_REQUEST', { reason: req.summary, meta: { userId: target.id, requestId: req.id } });
      toast.success('Sent to an admin for approval');
    } else {
      saveRightsRule({ ...d, id: genId(), createdAt: new Date().toISOString(), createdBy: me.name });
      logStaffAction('RIGHTS_RULE', { reason: `${target.name}: ${what}`, meta: { userId: target.id, added: true } });
      toast.success('Rule saved — it applies from now');
    }
    setDraft(null); refresh();
  };
  const revoke = (r: RightsRule) => {
    if (!canEdit) return;
    saveRightsRule({ ...r, revokedAt: new Date().toISOString() });
    logStaffAction('RIGHTS_RULE', { reason: `${r.userName}: removed ${r.mode} ${rightTitle(r.kind, r.key)}`, meta: { userId: r.userId, removed: true } });
    toast.success('Rule removed'); refresh();
  };
  const decide = async (req: RightsRequest, approve: boolean) => {
    if (!me) return;
    const ok = mayDecide(me, req);
    if (!ok.ok) { toast.error(ok.reason || 'Not allowed'); return; }
    const now = new Date().toISOString();
    if (approve) {
      if (req.payload.rule) saveRightsRule({ ...req.payload.rule, id: genId(), createdAt: now, createdBy: req.requestedByName });
      else {
        const user = team.find(u => u.id === req.userId);
        if (!user) { toast.error('That person is no longer on the team'); return; }
        const applied = await applyRights(user, { ...user, permissions: req.payload.permissions ?? user.permissions, featurePermissions: req.payload.featurePermissions ?? user.featurePermissions });
        if (!applied) return;
      }
    }
    saveRightsRequest({ ...req, status: approve ? 'approved' : 'rejected', decidedBy: me.id, decidedByName: me.name, decidedAt: now, decisionNote: note[req.id]?.trim() || undefined });
    logStaffAction('RIGHTS_DECISION', { reason: `${approve ? 'Approved' : 'Rejected'}: ${req.summary}`, meta: { requestId: req.id, userId: req.userId, approved: approve } });
    toast.success(approve ? 'Approved and applied' : 'Rejected'); refresh();
  };

  const upd = (patch: Partial<RuleDraft>) => setDraft(d => d && { ...d, ...patch });
  const toggle = <T,>(list: T[] | undefined, v: T): T[] => ((list ?? []).includes(v) ? (list ?? []).filter(x => x !== v) : [...(list ?? []), v]);

  return (
    <div className="space-y-5" data-rules-panel>
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">A <b>limit</b> narrows a right someone already has (only in one branch, only 10:00–22:00, only on some days). A <b>temporary grant</b> gives a right for a time and place, then ends by itself. An admin is never limited.</p>
        {canEdit && <Button size="sm" onClick={() => setDraft(blank())} data-rule-new><Plus className="mr-1 h-3.5 w-3.5" /> New rule</Button>}
      </div>

      {pending.length > 0 && (
        <section className="space-y-2" data-requests>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Waiting for approval ({pending.length})</h3>
          {pending.map(r => {
            const may = me ? mayDecide(me, r) : { ok: false };
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3" data-request={r.id}>
                <div className="min-w-0 flex-1"><div className="font-semibold">{r.summary}</div><div className="text-xs text-muted-foreground">Asked by {r.requestedByName} · {r.createdAt.slice(0, 10)}{r.reason ? ` · “${r.reason}”` : ''}</div></div>
                {may.ok ? (<>
                  <Input placeholder="Note (optional)" value={note[r.id] ?? ''} onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))} className="h-8 w-44" />
                  <Button size="sm" onClick={() => void decide(r, true)} data-request-approve={r.id}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(r, false)} data-request-reject={r.id}>Reject</Button>
                </>) : <Badge variant="secondary" data-request-waiting>Waiting for an admin</Badge>}
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Rules in force</h3>
        {rules.length === 0 ? <EmptyState icon={<CalendarClock />} title="No rules yet" hint="Everyone has exactly the rights on the other two tabs, in every branch, at every hour." /> : (
          <Table data-rules-table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Rule</TableHead><TableHead>Right</TableHead><TableHead>Where and when</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {rules.map(r => {
                const ended = r.mode === 'grant' && !!r.validUntil && r.validUntil < today;
                return (
                  <TableRow key={r.id} data-rule-row={r.id}>
                    <TableCell className="font-semibold">{r.userName}</TableCell>
                    <TableCell><Badge variant={r.mode === 'limit' ? 'outline' : 'secondary'}>{r.mode === 'limit' ? 'Limit' : 'Temporary grant'}</Badge>{ended && <Badge variant="outline" className="ml-1 text-[10px]">Ended</Badge>}</TableCell>
                    <TableCell>{rightTitle(r.kind, r.key)}<span className="ml-1 text-[10px] uppercase text-muted-foreground">{r.kind === 'page' ? 'module' : 'action'}</span></TableCell>
                    <TableCell className="text-sm">{describeScope(r, branchName)}{r.reason ? <div className="text-xs text-muted-foreground">{r.reason}</div> : null}</TableCell>
                    <TableCell className="text-right">{canEdit && <Button size="sm" variant="ghost" onClick={() => revoke(r)} data-rule-revoke={r.id}>Remove</Button>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {decided.length > 0 && (
        <section className="space-y-1" data-requests-decided>
          <h3 className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Recently decided</h3>
          {decided.map(r => <p key={r.id} className="text-sm"><Badge variant={r.status === 'approved' ? 'secondary' : 'destructive'} className="mr-2 text-[10px]">{r.status}</Badge>{r.summary} <span className="text-xs text-muted-foreground">· {r.decidedByName}{r.decisionNote ? ` — ${r.decisionNote}` : ''}</span></p>)}
        </section>
      )}

      <Dialog open={!!draft} onOpenChange={o => !o && setDraft(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-rule-editor>
          <DialogHeader><DialogTitle>New rule</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold">Person
                  <select value={draft.userId} onChange={e => upd({ userId: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-rule-person><option value="">Choose…</option>{people.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                </label>
                <label className="text-xs font-semibold">Kind
                  <select value={draft.mode} onChange={e => upd({ mode: e.target.value as 'limit' | 'grant' })} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-rule-mode><option value="limit">Limit — narrow a right they have</option><option value="grant">Temporary grant — give a right for a while</option></select>
                </label>
              </div>
              <label className="block text-xs font-semibold">Right
                <select value={`${draft.kind}:${draft.key}`} onChange={e => { const [k, ...rest] = e.target.value.split(':'); upd({ kind: k as 'page' | 'feature', key: rest.join(':') }); }} className="h-9 w-full rounded-md border bg-background px-2 text-sm" data-rule-right>
                  <option value=":">Choose…</option>
                  {FEATURE_GROUP_ORDER.map(g => <optgroup key={`f-${g}`} label={`Actions — ${g}`}>{FEATURE_PERMISSIONS.filter(f => f.group === g).map(f => <option key={f.key} value={`feature:${f.key}`}>{f.title}</option>)}</optgroup>)}
                  {GROUP_ORDER.map(g => <optgroup key={`p-${g}`} label={`Modules — ${g}`}>{PAGES.filter(p => p.group === g).map(p => <option key={p.key} value={`page:${p.key}`}>{p.title}</option>)}</optgroup>)}
                </select>
              </label>
              {branches.length > 1 && (
                <div className="text-xs font-semibold">Branches <span className="font-normal text-muted-foreground">(none ticked = every branch)</span>
                  <div className="mt-1 flex flex-wrap gap-1.5" data-rule-branches>{branches.map(b => <button key={b.id} type="button" aria-pressed={draft.branchIds?.includes(b.id)} onClick={() => upd({ branchIds: toggle(draft.branchIds, b.id) })} className={cn('h-8 rounded-full border-2 px-3 text-xs font-semibold', draft.branchIds?.includes(b.id) ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>{b.name}</button>)}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-semibold">From hour<Input type="time" value={draft.fromTime ?? ''} onChange={e => upd({ fromTime: e.target.value })} className="h-9" data-rule-from /></label>
                <label className="text-xs font-semibold">To hour<Input type="time" value={draft.toTime ?? ''} onChange={e => upd({ toTime: e.target.value })} className="h-9" data-rule-to /></label>
              </div>
              <div className="text-xs font-semibold">Days <span className="font-normal text-muted-foreground">(none ticked = every day)</span>
                <div className="mt-1 flex flex-wrap gap-1.5" data-rule-days>{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={draft.days?.includes(i)} onClick={() => upd({ days: toggle(draft.days, i) })} className={cn('h-8 w-12 rounded-full border-2 text-xs font-semibold', draft.days?.includes(i) ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>{d}</button>)}</div>
              </div>
              {draft.mode === 'grant' && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs font-semibold">From day (optional)<Input type="date" min={today} value={draft.validFrom ?? ''} onChange={e => upd({ validFrom: e.target.value })} className="h-9" /></label>
                  <label className="text-xs font-semibold">Until (last day)<Input type="date" min={today} value={draft.validUntil ?? ''} onChange={e => upd({ validUntil: e.target.value })} className="h-9" data-rule-until /></label>
                </div>
              )}
              <label className="block text-xs font-semibold">Why<Input value={draft.reason ?? ''} onChange={e => upd({ reason: e.target.value })} className="h-9" placeholder="Covering for Bilal's leave…" /></label>
              {issues.length > 0 && draft.userId && <ul className="list-disc space-y-0.5 pl-5 text-sm text-destructive" data-rule-issues>{issues.map(m => <li key={m}>{m}</li>)}</ul>}
              {gate.needed && <p className="rounded bg-muted/60 p-2 text-sm" data-rule-gate>{gate.reason} — saving sends it as a request.</p>}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button onClick={save} disabled={issues.length > 0} data-rule-save>{gate.needed ? 'Send for approval' : 'Save rule'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

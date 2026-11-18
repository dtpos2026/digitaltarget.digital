// Rights (v1.116.0) — who can open which module and do which action, for the whole team on one grid. It edits the same two lists the
// Users screen edits (modules and actions per person), so nothing is stored twice; every change is written to the staff audit log.
import { useMemo, useState } from 'react';
import { Check, Download, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, FilterBar, PageHeader } from '@/components/layout/PageFrame';
import { getCurrentUser, getUsers, saveUser } from '@/lib/store';
import { usingSupabaseAuth } from '@/lib/authProvider';
import { logStaffAction } from '@/lib/staffAudit';
import { FEATURE_GROUP_ORDER, FEATURE_PERMISSIONS, GROUP_ORDER, PAGES, userHasFeature } from '@/lib/permissions';
import { ROLE_PRESETS, findPreset, matchPreset } from '@/lib/orgStructure';
import { applyPreset, countsFor, describeChange, diffRights, effectiveFeatures, effectivePages, isLocked, matrixCsv, noChange, setFeature, setPage } from '@/lib/rightsMatrix';
import ReportActions from '@/components/ReportActions';
import type { ReportDoc } from '@/lib/reportExport';
import type { User } from '@/lib/types';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier', rider: 'Rider', order_taker: 'Order Taker' };

export default function RightsMatrixPage() {
  const [users, setUsers] = useState<User[]>(() => getUsers());
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const me = getCurrentUser();
  const canEdit = userHasFeature(me, 'feat.admin.users-manage');
  const team = useMemo(() => users.filter(u => u.isActive !== false).sort((a, b) => (a.role === 'admin' ? -1 : 0) - (b.role === 'admin' ? -1 : 0) || a.name.localeCompare(b.name)), [users]);
  const pageSets = useMemo(() => team.map(u => new Set(effectivePages(u))), [team]);
  const featSets = useMemo(() => team.map(u => new Set(effectiveFeatures(u))), [team]);
  const needle = q.trim().toLowerCase();

  const commit = async (before: User, after: User) => {
    const change = diffRights(before, after);
    if (noChange(change)) return;
    // on the cloud the rights live with the staff login on the server: save there first, and only then show the change
    if (usingSupabaseAuth()) {
      try {
        const { setStaffRights } = await import('@/lib/staffAuth.functions');
        await setStaffRights({ data: { username: before.username, permissions: after.permissions ?? [], featurePermissions: after.featurePermissions ?? [] } });
      } catch (e: unknown) { toast.error((e as Error)?.message || 'Could not save the rights'); return; }
    }
    saveUser(after);
    logStaffAction('RIGHTS_CHANGED', { reason: `${before.name}: ${describeChange(change)}`, meta: { userId: before.id, role: after.role, ...change } });
    setUsers(getUsers());
  };
  const togglePage = (u: User, key: string, on: boolean) => { if (canEdit) void commit(u, setPage(u, key, on)); else toast.error('Only an admin can change rights'); };
  const toggleFeat = (u: User, key: string, on: boolean) => { if (canEdit) void commit(u, setFeature(u, key, on)); else toast.error('Only an admin can change rights'); };
  const preset = (u: User, id: string) => {
    const p = findPreset(id);
    if (!p || !canEdit) return;
    void commit(u, applyPreset(u, p)).then(() => toast.success(`${u.name} is now set up as ${p.name}`));
  };
  const csv = () => {
    const url = URL.createObjectURL(new Blob([matrixCsv(team)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'staff-rights.csv'; a.click(); URL.revokeObjectURL(url);
  };

  // the grid as it stands, modules then actions, one column per person — for Print / PDF / JPG
  const reportDoc = (): ReportDoc => {
    const rows: Record<string, string | number>[] = [];
    PAGES.forEach(p => rows.push({ item: `Module · ${p.title}`, ...Object.fromEntries(team.map((u, i) => [u.id, pageSets[i].has(p.key) ? '✓' : '—'])) }));
    FEATURE_PERMISSIONS.forEach(f => rows.push({ item: `Action · ${f.title}`, ...Object.fromEntries(team.map((u, i) => [u.id, featSets[i].has(f.key) ? '✓' : '—'])) }));
    return {
      title: 'Staff rights', subtitle: new Date().toISOString().slice(0, 10), filename: 'staff-rights', rows,
      columns: [{ key: 'item', label: 'Module / action' }, ...team.map(u => ({ key: u.id, label: `${u.name} (${ROLE_LABEL[u.role] ?? u.role})`, align: 'center' as const }))],
      notes: ['✓ = allowed, — = not allowed. Admins have full access.'],
    };
  };

  const Cell = ({ locked, on, label, onChange }: { locked: boolean; on: boolean; label: string; onChange: (v: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={locked || !canEdit} onClick={() => onChange(!on)} data-right-cell={on ? 'on' : 'off'}
      className={cn('mx-auto grid h-7 w-7 place-items-center rounded-lg border transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50', (locked || !canEdit) && 'cursor-not-allowed opacity-60')}>
      {on && <Check className="h-4 w-4" aria-hidden />}
    </button>
  );

  const header = (
    <TableRow>
      <TableHead className="sticky left-0 z-10 min-w-[12rem] bg-card">&nbsp;</TableHead>
      {team.map(u => {
        const pos = matchPreset(u);
        return (
          <TableHead key={u.id} className="min-w-[8.5rem] text-center align-top" data-right-user={u.id}>
            <div className="truncate font-bold text-foreground">{u.name}</div>
            <Badge variant="outline" className="mt-1 text-[10px]">{ROLE_LABEL[u.role] ?? u.role}</Badge>
            <div className="mt-1 text-[10px] font-normal text-muted-foreground">{isLocked(u) ? 'Full access' : `${countsFor(u).pages} modules · ${countsFor(u).features} actions`}</div>
            {!isLocked(u) && (
              <select value={pos?.id ?? ''} onChange={e => e.target.value && preset(u, e.target.value)} disabled={!canEdit} aria-label={`Position of ${u.name}`} data-right-preset={u.id} className="mt-1 w-full text-[11px]">
                <option value="">{pos ? pos.name : 'Custom'}</option>
                {ROLE_PRESETS.filter(p => p.role === u.role && p.id !== pos?.id).map(p => <option key={p.id} value={p.id}>Set as {p.name}</option>)}
              </select>
            )}
          </TableHead>
        );
      })}
    </TableRow>
  );

  return (
    <div className="space-y-4 p-4 lg:p-6" data-rights-matrix>
      <PageHeader icon={<ShieldCheck />} title="Rights" subtitle="Who can open which module and do which action — the whole team on one grid"
        actions={<><Button size="sm" variant="outline" onClick={csv} disabled={team.length === 0} data-rights-csv><Download className="mr-1 h-3.5 w-3.5" /> Export CSV</Button><ReportActions build={reportDoc} disabled={team.length === 0} pos={false} /></>} />
      <FilterBar label="Rights filters">
        <Input type="search" placeholder="Search a module or action" aria-label="Search" value={q} onChange={e => setQ(e.target.value)} data-filter-grow data-rights-search />
        <select value={group} onChange={e => setGroup(e.target.value)} aria-label="Group" data-rights-group>
          <option value="all">All groups</option>
          {GROUP_ORDER.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {!canEdit && <Badge variant="secondary" data-rights-readonly>Read only — only an admin can change rights</Badge>}
      </FilterBar>

      {team.length === 0 ? <EmptyState icon={<ShieldCheck />} title="No staff yet" hint="Add people in Users, then set what each of them may do here." /> : (
        <Tabs defaultValue="modules">
          <TabsList>
            <TabsTrigger value="modules" data-rights-tab-modules>Modules</TabsTrigger>
            <TabsTrigger value="actions" data-rights-tab-actions>Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="modules">
            <Table data-rights-table="modules">
              <TableHeader>{header}</TableHeader>
              <TableBody>
                {GROUP_ORDER.filter(g => group === 'all' || group === g).flatMap(g => {
                  const rows = PAGES.filter(p => p.group === g && (!needle || p.title.toLowerCase().includes(needle)));
                  if (!rows.length) return [];
                  return [
                    <TableRow key={`g-${g}`} className="bg-muted/40"><TableCell colSpan={team.length + 1} className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{g}</TableCell></TableRow>,
                    ...rows.map(p => (
                      <TableRow key={p.key} data-right-row={p.key}>
                        <TableCell className="sticky left-0 z-10 bg-card font-semibold">{p.title}</TableCell>
                        {team.map((u, i) => <TableCell key={u.id} className="text-center"><Cell locked={isLocked(u)} on={pageSets[i].has(p.key)} label={`${u.name} — ${p.title}`} onChange={v => togglePage(u, p.key, v)} /></TableCell>)}
                      </TableRow>
                    )),
                  ];
                })}
              </TableBody>
            </Table>
          </TabsContent>

          <TabsContent value="actions">
            <Table data-rights-table="actions">
              <TableHeader>{header}</TableHeader>
              <TableBody>
                {FEATURE_GROUP_ORDER.filter(g => group === 'all' || group === g).flatMap(g => {
                  const rows = FEATURE_PERMISSIONS.filter(f => f.group === g && (!needle || f.title.toLowerCase().includes(needle) || f.desc.toLowerCase().includes(needle)));
                  if (!rows.length) return [];
                  return [
                    <TableRow key={`g-${g}`} className="bg-muted/40"><TableCell colSpan={team.length + 1} className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{g}</TableCell></TableRow>,
                    ...rows.map(f => (
                      <TableRow key={f.key} data-right-row={f.key}>
                        <TableCell className="sticky left-0 z-10 bg-card font-semibold">{f.title}<span className="block text-[11px] font-normal text-muted-foreground">{f.desc}</span></TableCell>
                        {team.map((u, i) => <TableCell key={u.id} className="text-center"><Cell locked={isLocked(u)} on={featSets[i].has(f.key)} label={`${u.name} — ${f.title}`} onChange={v => toggleFeat(u, f.key, v)} /></TableCell>)}
                      </TableRow>
                    )),
                  ];
                })}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      )}
      <p className="text-[11px] text-muted-foreground">
        An admin always has everything. A change takes effect the next time that person opens the screen, and every change is written to the staff audit log (who changed whose rights, and what was added or removed).
      </p>
    </div>
  );
}

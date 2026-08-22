import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Users, Trash2, Plus, RefreshCw, Shield, CheckCircle2, XCircle, History, X } from 'lucide-react';
import {
  TeamMember, SuperAdminRole, ROLE_LABELS, ROLE_DESCRIPTIONS, permissionsFor,
  listTeam, saveTeamMember, removeTeamMember, setMemberActive,
  recentActivity, ActivityEntry, logActivity, deleteActivity, clearAllActivity,
} from '@/lib/superAdminTeam';

interface Props {
  currentEmail: string;
  currentRole: SuperAdminRole;
}

export default function TeamPanel({ currentEmail, currentRole }: Props) {
  const perms = permissionsFor(currentRole);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // form state
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<SuperAdminRole>('support');

  const load = async () => {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([listTeam(), recentActivity(80)]);
      setMembers(t);
      setActivity(a);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load team');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onAdd = async () => {
    if (!email.trim()) { toast.error('Email required'); return; }
    if (!perms.manageTeam) { toast.error('Only Owner can manage team'); return; }
    try {
      await saveTeamMember({ email, name, role, active: true, createdBy: currentEmail });
      await logActivity({ actorEmail: currentEmail, actorRole: currentRole, action: 'team.add', target: email.toLowerCase(), meta: { role } });
      toast.success(`${email} added as ${ROLE_LABELS[role]}`);
      setEmail(''); setName(''); setRole('support'); setShowAdd(false);
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  const onToggleActive = async (m: TeamMember) => {
    if (!perms.manageTeam) return;
    try {
      await setMemberActive(m.email, !(m.active !== false));
      await logActivity({ actorEmail: currentEmail, actorRole: currentRole, action: m.active !== false ? 'team.deactivate' : 'team.activate', target: m.email });
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  const onRemove = async (m: TeamMember) => {
    if (!perms.manageTeam) return;
    if (!confirm(`Remove ${m.email} from team?`)) return;
    try {
      await removeTeamMember(m.email);
      await logActivity({ actorEmail: currentEmail, actorRole: currentRole, action: 'team.remove', target: m.email });
      toast.success('Removed');
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  const onChangeRole = async (m: TeamMember, newRole: SuperAdminRole) => {
    if (!perms.manageTeam) return;
    try {
      await saveTeamMember({ email: m.email, name: m.name, role: newRole, active: m.active !== false });
      await logActivity({ actorEmail: currentEmail, actorRole: currentRole, action: 'team.role', target: m.email, meta: { role: newRole } });
      toast.success(`Role updated → ${ROLE_LABELS[newRole]}`);
      load();
    } catch (e: any) { toast.error(e?.message); }
  };

  const onDeleteActivity = async (id: string) => {
    if (!perms.viewLogs) return;
    try {
      await deleteActivity(id);
      setActivity(prev => prev.filter(a => a.id !== id));
      toast.success('Activity deleted');
    } catch (e: any) { toast.error(e?.message || 'Failed to delete'); }
  };

  const onClearAllActivity = async () => {
    if (!perms.viewLogs) return;
    if (!confirm('Clear all activity logs?')) return;
    try {
      await clearAllActivity();
      setActivity([]);
      toast.success('Activity cleared');
    } catch (e: any) { toast.error(e?.message || 'Failed to clear'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider text-violet-600 flex items-center gap-2">
            <Users className="h-4 w-4" /> Super Admin Team ({members.length + 1})
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Manage admin accounts. You are signed in as <b>{ROLE_LABELS[currentRole]}</b>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          {perms.manageTeam && (
            <Button size="sm" onClick={() => setShowAdd(s => !s)}>
              <Plus className="h-4 w-4 mr-1" />Add Admin
            </Button>
          )}
        </div>
      </div>

      {showAdd && perms.manageTeam && (
        <div className="bg-card border border-border/60 rounded-xl p-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-2">
            <Input placeholder="admin@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            <Input placeholder="Full name (optional)" value={name} onChange={e => setName(e.target.value)} />
            <select value={role} onChange={e => setRole(e.target.value as SuperAdminRole)} className="h-10 border rounded-md px-3 bg-card text-sm">
              {(['owner','support','sales','billing','technical'] as SuperAdminRole[]).map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ⚠️ This email must also exist in Firebase Authentication. Create the Auth user in Firebase Console first, then add here to grant Super Admin access.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onAdd}><CheckCircle2 className="h-4 w-4 mr-1" />Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {/* Hardcoded owner — always visible */}
        <MemberCard
          locked
          member={{ email: currentRole === 'owner' ? currentEmail : '—', role: 'owner', active: true } as any}
          isSelf={true}
          label="Bootstrap Owner"
          canManage={false}
          onToggle={() => {}}
          onRemove={() => {}}
          onRoleChange={() => {}}
        />

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-xs text-muted-foreground italic px-4 py-6 bg-muted/30 rounded-lg border border-dashed text-center">
            No team members. {perms.manageTeam ? 'Add one.' : ''}
          </div>
        ) : members.map(m => (
          <MemberCard
            key={m.email}
            member={m}
            isSelf={m.email === currentEmail.toLowerCase()}
            canManage={perms.manageTeam}
            onToggle={() => onToggleActive(m)}
            onRemove={() => onRemove(m)}
            onRoleChange={(r) => onChangeRole(m, r)}
          />
        ))}
      </div>

      {/* Activity log */}
      {perms.viewLogs && (
        <div>
          <div className="flex items-center justify-between mb-3 mt-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <History className="h-4 w-4" /> Activity Log
            </h3>
            {activity.length > 0 && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onClearAllActivity}>
                <X className="h-4 w-4 mr-1" />Clear Activity
              </Button>
            )}
          </div>
          {activity.length === 0 ? (
            <div className="text-xs text-muted-foreground italic px-4 py-4 bg-muted/30 rounded-lg border border-dashed text-center">
              No activity yet.
            </div>
          ) : (
            <div className="bg-card border rounded-xl divide-y">
              {activity.map((a, i) => (
                <div key={a.id || i} className="flex items-center justify-between px-3 py-2 text-xs group">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      {a.at?.toDate ? a.at.toDate().toLocaleString() : ''}
                    </span>
                    <span className="font-medium truncate">{a.actorEmail}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-violet-600 font-medium">{a.action}</span>
                    {a.target && <><span className="text-muted-foreground">→</span><span className="truncate">{a.target}</span></>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.actorRole && <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full">{a.actorRole}</span>}
                    <button
                      onClick={() => a.id && onDeleteActivity(a.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-destructive"
                      title="Delete"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemberCard({
  member, isSelf, canManage, onToggle, onRemove, onRoleChange, locked, label,
}: {
  member: TeamMember;
  isSelf: boolean;
  canManage: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onRoleChange: (r: SuperAdminRole) => void;
  locked?: boolean;
  label?: string;
}) {
  const active = member.active !== false;
  return (
    <div className={`flex items-center justify-between bg-card border rounded-xl p-3 gap-3 ${!active ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-lg bg-violet-500/10 text-violet-600 flex items-center justify-center font-bold shrink-0">
          <Shield className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate flex items-center gap-2">
            {member.name || member.email}
            {isSelf && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">YOU</span>}
            {locked && <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-bold">{label}</span>}
          </div>
          <div className="text-xs text-muted-foreground truncate">{member.email}</div>
          <div className="text-[10px] text-muted-foreground">{ROLE_DESCRIPTIONS[member.role]}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {locked ? (
          <span className="text-xs font-semibold px-3 py-1.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
            {ROLE_LABELS[member.role]}
          </span>
        ) : canManage ? (
          <>
            <select
              value={member.role}
              onChange={(e) => onRoleChange(e.target.value as SuperAdminRole)}
              className="h-8 text-xs border rounded px-2 bg-card"
              disabled={isSelf}
              title={isSelf ? "Can't change your own role" : ''}
            >
              {(['owner','support','sales','billing','technical'] as SuperAdminRole[]).map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            {active ? (
              <Button size="sm" variant="outline" onClick={onToggle} disabled={isSelf}>
                <XCircle className="h-4 w-4 mr-1" />Disable
              </Button>
            ) : (
              <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={onToggle}>
                <CheckCircle2 className="h-4 w-4 mr-1" />Enable
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={onRemove} disabled={isSelf}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <span className="text-xs px-3 py-1.5 rounded bg-muted">{ROLE_LABELS[member.role]}</span>
        )}
      </div>
    </div>
  );
}

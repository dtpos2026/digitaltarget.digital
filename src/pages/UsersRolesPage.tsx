import { useEffect, useState } from 'react';
import { getUsers, saveUser, deleteUser, genId, getBranches, getRiders, saveRider, deleteRider } from '@/lib/store';
import { usingSupabaseAuth } from '@/lib/authProvider';
import { User, UserRole } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import WorkspaceCodeCard from '@/components/WorkspaceCodeCard';
import { Plus, Trash2, Edit2, Save, ShieldCheck, KeyRound } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PAGES, defaultPermissionsForRole, FEATURE_PERMISSIONS, FEATURE_GROUP_ORDER, defaultFeaturePermissionsForRole } from '@/lib/permissions';
import { Zap } from 'lucide-react';

const roleColors: Record<UserRole, string> = {
  admin: 'bg-status-danger text-status-danger-foreground',
  manager: 'bg-status-purple text-status-purple-foreground',
  cashier: 'bg-status-info text-status-info-foreground',
  rider: 'bg-status-teal text-status-teal-foreground',
  order_taker: 'bg-status-warning text-status-warning-foreground',
};

export default function UsersRolesPage() {
  const [users, setUsers] = useState(() => (usingSupabaseAuth() ? [] : getUsers()));
  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, []);
  const [showDialog, setShowDialog] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  /**
   * v1.21.3 — on Supabase the staff list lives in `user_profiles`, not in the
   * local `users` array. Without this, a user created through the dialog was
   * saved correctly server-side and then never appeared on screen.
   */
  const refresh = async () => {
    if (usingSupabaseAuth()) {
      try {
        const { sb } = await import('@/lib/supabase');
        const { data, error } = await sb().rpc('pos_list_users');
        if (error) throw error;
        setUsers(((data ?? []) as any[]).map(r => ({
          id: r.user_id,
          username: r.username,
          name: r.display_name,
          role: r.role,
          branchId: r.branch_id,
          permissions: r.permissions ?? [],
          isActive: r.is_active !== false,
          // The password hash deliberately never leaves the database, so there
          // is nothing to show here — the dialog sets a new one instead.
          password: '',
        })) as any);
      } catch (e: any) {
        console.error('[users] list failed', e);
        toast.error(e?.message || 'Could not load users');
      }
      return;
    }
    setUsers(getUsers());
  };

  const openNew = () => {
    setEditUser({
      id: genId(),
      username: '',
      password: '',
      name: '',
      role: 'cashier',
      isActive: true,
      permissions: defaultPermissionsForRole('cashier'),
      featurePermissions: defaultFeaturePermissionsForRole('cashier'),
    });
    setShowDialog(true);
  };

  const openEdit = (u: User) => {
    setEditUser({
      ...u,
      permissions: u.permissions && u.permissions.length > 0
        ? [...u.permissions]
        : defaultPermissionsForRole(u.role),
      featurePermissions: u.featurePermissions && u.featurePermissions.length > 0
        ? [...u.featurePermissions]
        : defaultFeaturePermissionsForRole(u.role),
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!editUser) return;
    if (!editUser.name) { toast.error('A name is required'); return; }
    // For order_taker / rider: phone+PIN ke ilawa username/password ki zarurat nahi.
    // Auto-fill username=phone and password=pin so legacy login bhi chale.
    let toSave = { ...editUser };
    if (editUser.role === 'order_taker' || editUser.role === 'rider') {
      const phone = (editUser.phone || '').replace(/\D/g, '');
      const pin = (editUser.pin || '').replace(/\D/g, '');
      if (phone.length < 10) { toast.error('A valid phone number is required (at least 10 digits)'); return; }
      if (pin.length < 4) { toast.error('A 4-digit PIN is required'); return; }
      toSave = { ...toSave, phone, pin, username: phone, password: pin };
    } else {
      if (!editUser.username || !editUser.password) {
        toast.error('A username and password are required');
        return;
      }
    }
    // ===== v1.21.3 — POS users live in the database on Supabase =====
    // saveUser() writes to the local `users` array with the password in plain
    // text. That is how the Firebase build worked, and it is why a user
    // created here could never log in on Supabase: the login path compares a
    // bcrypt hash held in Postgres, and this record never reached it.
    //
    // pos_create_user() hashes server-side, so the password is never stored
    // or transmitted in the clear.
    if (usingSupabaseAuth()) {
      try {
        const { saveStaffUser } = await import('@/lib/staffAuth.functions');
        await saveStaffUser({ data: {
          userId: editUser.id,
          username: String(toSave.username || '').trim().toLowerCase(),
          password: String(toSave.password || ''),
          displayName: toSave.name,
          role: toSave.role,
          branchId: toSave.branchId ?? null,
          permissions: (toSave.permissions ?? []) as string[],
          featurePermissions: (toSave.featurePermissions ?? []) as string[],
          phone: toSave.phone ?? null,
          allBranches: false,
          isActive: toSave.isActive !== false,
        } });
        if (toSave.role === 'rider') syncRiderRecord(toSave as User);
        setShowDialog(false);
        refresh();
        toast.success('User saved');
      } catch (e: any) {
        toast.error(e?.message || 'Could not save the user');
      }
      return;
    }

    saveUser(toSave);
    if (toSave.role === 'rider') syncRiderRecord(toSave as User);
    setShowDialog(false);
    refresh();
    toast.success('User saved');
  };

  /**
   * Riders used to be created in two unconnected places — here and in
   * Settings → Riders — so a rider made on this screen never showed up in the
   * Rider Portal. Users & Access is now the single source: saving a rider
   * user also writes (or removes) the matching rider record.
   */
  const syncRiderRecord = (u: User) => {
    const existing = getRiders().find(r => r.id === u.id);
    saveRider({
      ...(existing ?? { id: u.id, name: '', phone: '', isActive: true }),
      id: u.id,
      name: u.name,
      phone: (u.phone || u.username || '').replace(/\D/g, ''),
      pin: (u.pin || u.password || '').replace(/\D/g, '') || existing?.pin || '0000',
      isActive: u.isActive !== false,
    });
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Delete ${u.name}?`)) return;
    try {
      if (usingSupabaseAuth()) {
        const { deleteStaffUser } = await import('@/lib/staffAuth.functions');
        await deleteStaffUser({ data: { userId: u.id } });
      }
      deleteUser(u.id);
      if (u.role === 'rider') deleteRider(u.id);
      await refresh();
      toast.success('User deleted');
    } catch (e: any) {
      toast.error(e?.message || 'Could not delete the user');
    }
  };

  const togglePerm = (key: string) => {
    if (!editUser) return;
    const cur = editUser.permissions || [];
    setEditUser({
      ...editUser,
      permissions: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key],
    });
  };

  const toggleFeature = (key: string) => {
    if (!editUser) return;
    const cur = editUser.featurePermissions || [];
    setEditUser({
      ...editUser,
      featurePermissions: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key],
    });
  };

  const applyRoleDefaults = (role: UserRole) => {
    if (!editUser) return;
    setEditUser({
      ...editUser,
      role,
      permissions: defaultPermissionsForRole(role),
      featurePermissions: defaultFeaturePermissionsForRole(role),
    });
  };

  const groups: Array<PageDef['group']> = ['Operations', 'Marketing', 'Inventory', 'Accounts', 'Staff', 'Reports', 'Admin'];
  const isAdmin = editUser?.role === 'admin';
  const isPortalRole = editUser?.role === 'order_taker' || editUser?.role === 'rider';

  return (
    <div className="p-4 lg:p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-9 w-9 rounded-lg bg-gradient-gold flex items-center justify-center shadow-gold">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">Users & Access</h2>
          <p className="text-[11px] text-muted-foreground">Manage logins and what each user can see</p>
        </div>
        <Button size="sm" className="ml-auto bg-gradient-gold text-primary shadow-gold font-bold" onClick={openNew}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add User
        </Button>
      </div>

      <WorkspaceCodeCard />


      <div className="bg-card border rounded-xl overflow-x-auto shadow-card">
        <table className="w-full text-xs">
          <thead><tr className="border-b bg-muted/40">
            <th className="text-left px-4 py-2.5 text-muted-foreground font-bold uppercase text-[10px] tracking-wider">Name</th>
            <th className="text-left px-4 py-2.5 text-muted-foreground font-bold uppercase text-[10px] tracking-wider">Username</th>
            <th className="text-left px-4 py-2.5 text-muted-foreground font-bold uppercase text-[10px] tracking-wider">Role</th>
            <th className="text-left px-4 py-2.5 text-muted-foreground font-bold uppercase text-[10px] tracking-wider">Pages</th>
            <th className="text-left px-4 py-2.5 text-muted-foreground font-bold uppercase text-[10px] tracking-wider">Status</th>
            <th className="px-4 py-2"></th>
          </tr></thead>
          <tbody>
            {users.map(u => {
              const perms = u.role === 'admin'
                ? PAGES.length
                : (u.permissions && u.permissions.length > 0 ? u.permissions.length : defaultPermissionsForRole(u.role).length);
              return (
                <tr key={u.id} className="border-b hover:bg-muted/30 transition-smooth">
                  <td className="px-4 py-2.5 font-bold">{u.name}</td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">{u.username}</td>
                  <td className="px-4 py-2.5"><Badge className={`text-[10px] ${roleColors[u.role]}`}>{u.role}</Badge></td>
                  <td className="px-4 py-2.5">
                    <span className="font-bold text-foreground">{perms}</span>
                    <span className="text-muted-foreground"> / {PAGES.length}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant={u.isActive ? 'default' : 'secondary'} className={`text-[10px] ${u.isActive ? 'bg-status-success text-status-success-foreground' : ''}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(u)}><Edit2 className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleDelete(u)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-gold" />
              {editUser?.username ? `Edit User — ${editUser.username}` : 'Add User'}
            </DialogTitle>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Full Name</label>
                  <Input placeholder="Full Name" value={editUser.name} onChange={e => setEditUser({ ...editUser, name: e.target.value })} />
                </div>
                {isPortalRole ? (
                  <>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                        📱 Phone Number
                      </label>
                      <Input
                        placeholder="03xx-xxxxxxx"
                        inputMode="tel"
                        value={editUser.phone || ''}
                        onChange={e => setEditUser({ ...editUser, phone: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">🔢 4-Digit PIN</label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="e.g. 1234"
                        value={editUser.pin || ''}
                        onChange={e => setEditUser({ ...editUser, pin: e.target.value.replace(/\D/g, '') })}
                        className="font-mono tracking-widest"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Username</label>
                      <Input placeholder="Username" value={editUser.username} onChange={e => setEditUser({ ...editUser, username: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Password</label>
                      <Input type="text" placeholder="Password" value={editUser.password} onChange={e => setEditUser({ ...editUser, password: e.target.value })} />
                    </div>
                  </>
                )}
                <div className={isPortalRole ? '' : ''}>
                  <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Role</label>
                  <Select value={editUser.role} onValueChange={(v: UserRole) => applyRoleDefaults(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin (full access)</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="cashier">Cashier</SelectItem>
                      <SelectItem value="rider">🏍️ Rider (Phone+PIN portal)</SelectItem>
                      <SelectItem value="order_taker">📱 Order Taker (Phone+PIN portal)</SelectItem>
                    </SelectContent>
                  </Select>
                  {isPortalRole && (
                    <p className="text-[10px] text-violet-600 mt-1 font-medium">
                      Portal login phone + PIN se hoga (waiter/rider jaisa).
                    </p>
                  )}
                </div>
                {getBranches().length > 0 && (
                  <div className="col-span-2">
                    <label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Assigned Branch</label>
                    <Select
                      value={editUser.branchId || 'none'}
                      onValueChange={(v) => setEditUser({ ...editUser, branchId: v === 'none' ? undefined : v })}
                    >
                      <SelectTrigger><SelectValue placeholder="No branch lock" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No branch lock (all branches)</SelectItem>
                        {getBranches().filter(b => b.isActive).map(b => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Order Taker / Cashier ko branch assign karne se woh sirf isi branch ke orders dekhega — branch change nahi kar sakega.
                    </p>
                  </div>
                )}
              </div>


              <div className="flex items-center justify-between bg-muted/40 px-3 py-2 rounded-lg">
                <div>
                  <div className="text-xs font-bold">Account Active</div>
                  <div className="text-[10px] text-muted-foreground">Inactive users cannot sign in</div>
                </div>
                <Switch checked={editUser.isActive} onCheckedChange={(v) => setEditUser({ ...editUser, isActive: v })} />
              </div>

              {/* Permissions Matrix */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-gold" /> Page Access
                    </h3>
                    <p className="text-[10px] text-muted-foreground">
                      {isAdmin ? 'Admin has full access to every page.' : 'Tick the pages this user can open from the sidebar.'}
                    </p>
                  </div>
                  {!isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-7"
                      onClick={() => setEditUser({ ...editUser, permissions: defaultPermissionsForRole(editUser.role) })}
                    >
                      Reset to {editUser.role} defaults
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {groups.map(grp => (
                    <div key={grp} className="border rounded-lg p-3 bg-card">
                      <div className="text-[10px] uppercase font-extrabold tracking-wider text-gold mb-2">{grp}</div>
                      <div className="space-y-1.5">
                        {PAGES.filter(p => p.group === grp).map(p => {
                          const checked = isAdmin || (editUser.permissions || []).includes(p.key);
                          return (
                            <label
                              key={p.key}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-smooth text-xs ${
                                checked ? 'bg-primary/10 text-foreground font-semibold' : 'text-muted-foreground hover:bg-muted/40'
                              } ${isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isAdmin}
                                onChange={() => togglePerm(p.key)}
                                className="h-3.5 w-3.5 accent-primary"
                              />
                              {p.title}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Feature / Action Permissions Matrix */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold flex items-center gap-2">
                      <Zap className="h-4 w-4 text-violet-500" /> Feature Control
                    </h3>
                    <p className="text-[10px] text-muted-foreground">
                      {isAdmin
                        ? 'Admin can perform every action.'
                        : 'Tick which actions this user is allowed to perform (discount, void, refund, etc.).'}
                    </p>
                  </div>
                  {!isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-[10px] h-7"
                      onClick={() => setEditUser({ ...editUser, featurePermissions: defaultFeaturePermissionsForRole(editUser.role) })}
                    >
                      Reset to {editUser.role} defaults
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {FEATURE_GROUP_ORDER.map(grp => {
                    const items = FEATURE_PERMISSIONS.filter(f => f.group === grp);
                    if (!items.length) return null;
                    return (
                      <div key={grp} className="border rounded-lg p-3 bg-card">
                        <div className="text-[10px] uppercase font-extrabold tracking-wider text-violet-500 mb-2">{grp}</div>
                        <div className="space-y-1.5">
                          {items.map(f => {
                            const checked = isAdmin || (editUser.featurePermissions || []).includes(f.key);
                            return (
                              <label
                                key={f.key}
                                className={`flex items-start gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-smooth text-xs ${
                                  checked ? 'bg-violet-500/10 text-foreground font-semibold' : 'text-muted-foreground hover:bg-muted/40'
                                } ${isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={isAdmin}
                                  onChange={() => toggleFeature(f.key)}
                                  className="h-3.5 w-3.5 accent-violet-500 mt-0.5"
                                />
                                <span className="flex-1">
                                  <span className="block">{f.title}</span>
                                  <span className="block text-[9px] text-muted-foreground font-normal leading-tight">{f.desc}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button onClick={handleSave} className="w-full bg-gradient-gold text-primary shadow-gold font-extrabold">
                <Save className="h-4 w-4 mr-2" /> Save User
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Type-only helper import (avoids circular)
import type { PageDef } from '@/lib/permissions';

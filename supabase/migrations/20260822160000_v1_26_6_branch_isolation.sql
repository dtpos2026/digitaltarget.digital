-- ============================================================================
-- v1.26.6 — branch isolation: close the NULL hole, cover the last two tables
--
-- Branch enforcement is broadly in place already: 21 of the 23 branch-scoped
-- tables carry `can_access_branch(branch_id)` in their policy. Two do not, and
-- the helper itself has a hole.
--
-- THE HOLE
--   can_access_branch(target) was:
--     (target is null or p.all_branches or p.role in ('owner','admin')
--      or p.branch_id = target)
--
--   `target is null or …` short-circuits before any of the user's own
--   attributes are consulted. So a row whose branch_id is NULL is readable AND
--   writable by every cashier in the restaurant, whichever branch they belong
--   to — and a branch cashier can create such a row simply by omitting the
--   branch, after which every other branch sees it.
--
--   No such row exists in this database today (checked: 0 across orders,
--   dining_tables, shifts, floors, kitchens, inventory_items, transactions,
--   day_closes, attendance, ledger_entries), so this is a latent hole rather
--   than a live leak. It is exactly the kind that opens quietly later.
--
--   The fix keeps NULL permissive for people who legitimately span branches —
--   an owner or admin with all_branches, whose session may carry no single
--   branch — and denies it to a branch-restricted user, who must match their
--   own branch exactly. Verified first that every active user has a branch_id
--   set and that owners/admins carry all_branches, so nobody is locked out.
--
-- THE TWO UNCOVERED TABLES
--   attendance and ledger_entries both have a branch_id column and both were
--   filtered by tenant alone, so one branch's staff attendance and accounting
--   entries were visible to every other branch's cashier.
-- ============================================================================

create or replace function public.can_access_branch(target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from user_profiles p
    where p.user_id = auth.uid()
      and p.is_active
      and (
        -- Spans every branch: owners, admins, and anyone explicitly flagged.
        -- These may have no single branch on their session, so a NULL target
        -- must stay allowed for them.
        p.all_branches
        or p.role in ('owner', 'admin')
        -- Branch-restricted: an exact match, and never a NULL. A row with no
        -- branch belongs to no branch, so it is not theirs.
        or (target is not null and p.branch_id = target)
      )
  )
$function$;

-- attendance — staff hours are branch business.
drop policy if exists attendance_tenant_rw on public.attendance;
drop policy if exists attendance_branch_rw on public.attendance;
create policy attendance_branch_rw on public.attendance
  for all to authenticated
  using      (tenant_id = auth_tenant_id() and can_access_branch(branch_id))
  with check (tenant_id = auth_tenant_id() and can_access_branch(branch_id));

-- ledger_entries — one branch's accounting is not another's.
drop policy if exists ledger_entries_tenant_rw on public.ledger_entries;
drop policy if exists ledger_entries_branch_rw on public.ledger_entries;
create policy ledger_entries_branch_rw on public.ledger_entries
  for all to authenticated
  using      (tenant_id = auth_tenant_id() and can_access_branch(branch_id))
  with check (tenant_id = auth_tenant_id() and can_access_branch(branch_id));

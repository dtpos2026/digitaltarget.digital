-- ============================================================================
-- v1.31.4 — the billing guard had two gaps, found by writing through them
--
-- trg_guard_tenant_billing is attached and enabled, and it does block plan,
-- plan_expires_at, is_active, owner_user_id and slug. Tested as a real
-- signed-in owner of a live restaurant, each column separately, measured by
-- the VALUE afterwards rather than by row_count — because a BEFORE trigger
-- that quietly reverts still reports one row updated:
--
--   plan                 refused: plan can only be changed by Digital Target
--   plan_expires_at      refused
--   is_active            refused
--   custom_device_limit  null   -> 9999      *** went through ***
--   workspace_code       6FC459 -> 'HACKED'  *** went through ***
--
-- custom_device_limit OVERRIDES the device cap the plan sells. A restaurant on
-- a two-device trial could set it to 9999 from the browser and run unlimited
-- tills. That is not a data breach; it is the product being given away.
--
-- workspace_code is how staff and customers find a restaurant. A tenant that
-- can rewrite its own can collide with — or squat — another restaurant's code.
--
-- Neither is the tenant's to set. Both are added to the same guard rather than
-- to a new mechanism, so there is one place that answers "what may a
-- restaurant change about its own commercial record".
--
-- CAREFUL WITH workspace_code: the tenants_workspace_code trigger GENERATES it
-- when it is missing, and fires before this one (alphabetical order, same
-- timing). So this blocks value -> different value, and deliberately allows
-- null -> value, or the generator would trip the guard it shares a table with.
-- ============================================================================

create or replace function public.guard_tenant_billing_columns()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  -- Super admins may change anything. sa_set_plan runs as SECURITY DEFINER
  -- and still carries the caller's auth.uid(), so this check holds there too.
  if is_super_admin() then
    return new;
  end if;

  -- The pending-owner claim runs inside GoTrue's insert, where there is no
  -- JWT and therefore no auth.uid(). Only claim_pending_owner() sets this,
  -- and only for the duration of its own UPDATE.
  if coalesce(current_setting('app.claiming_pending_owner', true), '') = 'on' then
    return new;
  end if;

  if new.plan is distinct from old.plan then
    raise exception 'plan can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.plan_expires_at is distinct from old.plan_expires_at then
    raise exception 'plan expiry can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'account status can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'ownership can only be changed by Digital Target' using errcode = '42501';
  end if;
  if new.slug is distinct from old.slug then
    raise exception 'slug can only be changed by Digital Target' using errcode = '42501';
  end if;

  -- v1.31.4 — the two that were missing.
  if new.custom_device_limit is distinct from old.custom_device_limit then
    raise exception 'the device limit can only be changed by Digital Target' using errcode = '42501';
  end if;
  if old.workspace_code is not null
     and new.workspace_code is distinct from old.workspace_code then
    raise exception 'the workspace code can only be changed by Digital Target' using errcode = '42501';
  end if;

  return new;
end $function$;

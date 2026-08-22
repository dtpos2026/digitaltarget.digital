-- ===========================================================================
-- v1.25.9 / v1.25.10 — RPC contract breaks + missing columns
--
-- ===== BUG 1: register_device rejected EVERY call =====
-- src/lib/supabaseSync.ts sends p_meta and p_ip; the function accepted only
-- five arguments. PostgREST resolves overloads by ARGUMENT NAME, so no
-- candidate matched at all:
--     "Could not find the function public.register_device(...)"
-- Device registration is the FIRST thing a till does. Failing here means the
-- device never gets an id, so NOTHING after it can sync.
--
-- The function also returned only device_id/approved/branch_id while the
-- caller reads `blocked` and `auto_approved` — both came back undefined, so a
-- blocked device still looked usable.
--
-- ===== BUG 2: sa_set_plan was ambiguous =====
-- Two overloads (p_expires as text and as timestamptz). PostgREST cannot
-- choose and fails, so setting a restaurant's plan was broken.
--
-- NOTE: CREATE OR REPLACE cannot change a signature — it creates a SECOND
-- overload and reintroduces exactly this ambiguity. The old versions must be
-- dropped explicitly, which is what the DROP statements below are for.
-- ===========================================================================

alter table public.devices
  add column if not exists ip               text,
  add column if not exists meta             jsonb not null default '{}'::jsonb,
  add column if not exists blocked          boolean not null default false,
  add column if not exists blocked_at       timestamptz,
  add column if not exists blocked_reason   text,
  add column if not exists auto_approved    boolean not null default false,
  add column if not exists is_kds           boolean not null default false,
  add column if not exists kds_kitchen_id   uuid,
  add column if not exists kds_kitchen_name text,
  add column if not exists login_count      integer not null default 0,
  add column if not exists last_login_at    timestamptz;

drop function if exists public.register_device(text, text, uuid, text, text);

create or replace function public.register_device(
  p_hardware_id text, p_label text, p_branch_id uuid,
  p_platform text default null, p_app_version text default null,
  p_meta jsonb default '{}'::jsonb, p_ip text default null
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public' as $function$
declare
  v_tenant uuid := auth_tenant_id();
  v_id uuid; v_appr boolean; v_blk boolean; v_auto boolean;
begin
  if v_tenant is null then
    raise exception 'no tenant for caller' using errcode = '42501';
  end if;
  if not can_access_branch(p_branch_id) then
    raise exception 'branch not permitted' using errcode = '42501';
  end if;

  v_auto := auth_role() in ('owner','admin');

  insert into devices (tenant_id, branch_id, hardware_id, device_label,
                       platform, app_version, last_seen_at, last_login_at,
                       login_count, meta, ip, approved, auto_approved)
  values (v_tenant, p_branch_id, p_hardware_id, p_label,
          p_platform, p_app_version, now(), now(),
          1, coalesce(p_meta, '{}'::jsonb), p_ip, v_auto, v_auto)
  on conflict (tenant_id, hardware_id) do update
    set device_label  = excluded.device_label,
        app_version   = excluded.app_version,
        platform      = coalesce(excluded.platform, devices.platform),
        meta          = coalesce(excluded.meta, devices.meta),
        ip            = coalesce(excluded.ip, devices.ip),
        last_seen_at  = now(),
        last_login_at = now(),
        login_count   = devices.login_count + 1
        -- approved is deliberately NOT touched: re-registering must never
        -- silently re-approve a device an admin has revoked.
  returning id, approved, blocked, auto_approved
  into v_id, v_appr, v_blk, v_auto;

  return jsonb_build_object('device_id', v_id,
    'approved', coalesce(v_appr,false), 'blocked', coalesce(v_blk,false),
    'auto_approved', coalesce(v_auto,false), 'branch_id', p_branch_id);
end $function$;

drop function if exists public.sa_set_plan(uuid, text, text);

-- ===== v1.25.10: tenants.custom_device_limit =====
-- The Super Admin panel writes this to raise a restaurant's device limit above
-- its plan. The column did not exist, so the override silently did nothing:
-- no error, and the extra till still could not register.
-- NULL = no override, use the plan limit (see effectiveDeviceLimit in plans.ts).
alter table public.tenants
  add column if not exists custom_device_limit integer;

comment on column public.tenants.custom_device_limit is
  'Super Admin override for the plan device limit. NULL = use the plan value.';

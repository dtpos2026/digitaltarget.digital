-- ============================================================================
-- v1.26.8 — one physical machine should be one approved device
--
-- register_device() dedups on (tenant_id, hardware_id), and hardware_id comes
-- from getDeviceId(): a random uuid in localStorage. localStorage is scoped to
-- the browser PROFILE, so one Windows PC opened in Chrome, Edge and Firefox
-- registers three times and asks for approval three times. A restaurant with a
-- few machines and staff who switch browsers ends up with a device list nobody
-- can read.
--
-- A web page cannot read a machine serial, so this adds a low-entropy
-- FINGERPRINT (screen geometry, cpu/memory counts, platform, timezone) as a
-- merge hint. It is explicitly not the identity and not a security boundary:
--
--   * hardware_id stays the unguessable per-profile id.
--   * The caller must already hold valid credentials for this restaurant —
--     auth_tenant_id() and can_access_branch() are unchanged — so forging a
--     fingerprint grants nothing that was not already reachable.
--   * A merged registration inherits BLOCKED as well as APPROVED. Without
--     that, blocking a machine could be undone by opening another browser,
--     which would make the whole feature worse than useless.
--   * IP is recorded as metadata only, never as identity: it changes with
--     wifi, hotspots and VPNs, and every device behind one router shares it.
--
-- Electron passes a real per-installation id as hardware_id, in which case the
-- fingerprint merely agrees with it.
-- ============================================================================

alter table public.devices add column if not exists fingerprint text;

comment on column public.devices.fingerprint is
  'Low-entropy machine hint used to merge the same PC seen in another browser. Never an identity or an authorisation input.';

-- Only meaningful within one restaurant, and only for rows that have one.
create index if not exists devices_tenant_fingerprint_idx
  on public.devices (tenant_id, fingerprint) where fingerprint is not null;

create or replace function public.register_device(
  p_hardware_id text,
  p_label       text,
  p_branch_id   uuid,
  p_platform    text  default null,
  p_app_version text  default null,
  p_meta        jsonb default '{}'::jsonb,
  p_ip          text  default null,
  p_fingerprint text  default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_tenant uuid := auth_tenant_id();
  v_id     uuid;
  v_appr   boolean;
  v_blk    boolean;
  v_auto   boolean;
  v_fp     text := nullif(btrim(coalesce(p_fingerprint, '')), '');
  v_merged boolean := false;
begin
  if v_tenant is null then
    raise exception 'no tenant for caller' using errcode = '42501';
  end if;
  if not can_access_branch(p_branch_id) then
    raise exception 'branch not permitted' using errcode = '42501';
  end if;

  -- An owner or admin registering a device approves it implicitly; anyone
  -- else must wait for approval. Recorded in auto_approved so the Devices
  -- screen can tell an implicit approval from a deliberate one.
  v_auto := auth_role() in ('owner','admin');

  -- Same machine, different browser: adopt the device row that already
  -- exists rather than asking the operator to approve the PC again. Only
  -- when this exact hardware_id is not already known, so a returning browser
  -- always keeps its own row.
  if v_fp is not null then
    select d.id into v_id
      from devices d
     where d.tenant_id = v_tenant
       and d.fingerprint = v_fp
       and d.hardware_id is distinct from p_hardware_id
     order by d.created_at
     limit 1;

    if v_id is not null
       and not exists (select 1 from devices d
                        where d.tenant_id = v_tenant and d.hardware_id = p_hardware_id) then
      update devices d
         set device_label  = coalesce(p_label, d.device_label),
             app_version   = coalesce(p_app_version, d.app_version),
             platform      = coalesce(p_platform, d.platform),
             ip            = coalesce(p_ip, d.ip),
             last_seen_at  = now(),
             last_login_at = now(),
             login_count   = d.login_count + 1,
             -- Keep a record of the other browser profiles seen on this machine
             -- so the Devices screen can explain why one row covers several.
             meta = coalesce(d.meta, '{}'::jsonb) || jsonb_build_object(
                      'mergedProfiles',
                      (coalesce(d.meta->'mergedProfiles', '[]'::jsonb)
                        || to_jsonb(array[p_hardware_id]))
                    )
       where d.id = v_id
      returning d.approved, d.blocked, d.auto_approved
      into v_appr, v_blk, v_auto;

      v_merged := true;
    else
      v_id := null;
    end if;
  end if;

  if not v_merged then
    insert into devices (tenant_id, branch_id, hardware_id, fingerprint, device_label,
                         platform, app_version, last_seen_at, last_login_at,
                         login_count, meta, ip, approved, auto_approved)
    values (v_tenant, p_branch_id, p_hardware_id, v_fp, p_label,
            p_platform, p_app_version, now(), now(),
            1, coalesce(p_meta, '{}'::jsonb), p_ip, v_auto, v_auto)
    on conflict (tenant_id, hardware_id) do update
      set device_label  = excluded.device_label,
          app_version   = excluded.app_version,
          platform      = coalesce(excluded.platform, devices.platform),
          fingerprint   = coalesce(devices.fingerprint, excluded.fingerprint),
          meta          = coalesce(excluded.meta, devices.meta),
          ip            = coalesce(excluded.ip, devices.ip),
          last_seen_at  = now(),
          last_login_at = now(),
          login_count   = devices.login_count + 1
          -- approved is deliberately NOT touched here: re-registering must never
          -- silently re-approve a device an admin has revoked.
    returning id, approved, blocked, auto_approved
    into v_id, v_appr, v_blk, v_auto;
  end if;

  return jsonb_build_object(
    'device_id',     v_id,
    'approved',      coalesce(v_appr, false),
    -- Inherited on a merge: switching browsers must never shed a block.
    'blocked',       coalesce(v_blk, false),
    'auto_approved', coalesce(v_auto, false),
    'merged',        v_merged,
    'branch_id',     p_branch_id
  );
end
$function$;

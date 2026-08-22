-- ===========================================================================
-- v1.25.23 — the three largest error sources, from postgres_logs
--
--   447  menu_items_kitchen_id_fkey violation
--   353  menu_items_category_id_fkey violation
--   134  inventory_items_category_id_fkey violation
--   133  column orders.deleted_at does not exist   <- stale PostgREST cache
--    71  inventory_items_base_unit_check
--    31  admin_support_messages_direction_check
--
-- BUG 1 — dangling FKs rejected the WHOLE row.
-- Before v1.25.19 a legacy FK was nulled, destroying the link. v1.25.19 made
-- it derive a real uuid — correct — but a POS syncing a backlog pushes
-- children before parents, and the backup has kitchens: 0 while 447 menu items
-- carry a kitchenId. The FK had nothing to point at, so the whole menu item
-- was rejected.
--
-- Neither extreme is acceptable: nulling loses the link, rejecting loses the
-- record. A BEFORE trigger backfills a PLACEHOLDER parent with the exact id
-- the real parent will use. cloudId() is deterministic, so when the real
-- category or kitchen syncs it upserts over the placeholder by primary key and
-- the link is already correct.
--
-- inventory_item_id is the exception: a fake stock record would look like real
-- inventory and corrupt stock maths, so that link is dropped instead.
--
-- BUG 2 — PostgREST served a stale schema cache. 133 failures claimed
-- orders.deleted_at "does not exist" AFTER v1.25.15 created it. Migrations
-- were live in Postgres but invisible to the API. NOTIFY forces the reload.
-- ===========================================================================

create or replace function public.ensure_menu_item_parents()
returns trigger language plpgsql security definer
set search_path to 'public' as $function$
begin
  if new.category_id is not null
     and not exists (select 1 from categories c where c.id = new.category_id) then
    insert into categories (id, tenant_id, name, sort_order, is_active)
    values (new.category_id, new.tenant_id, 'Uncategorised', 9999, true)
    on conflict (id) do nothing;
  end if;

  if new.kitchen_id is not null
     and not exists (select 1 from kitchens k where k.id = new.kitchen_id) then
    insert into kitchens (id, tenant_id, name, is_active)
    values (new.kitchen_id, new.tenant_id, 'Unassigned Kitchen', true)
    on conflict (id) do nothing;
  end if;

  if new.inventory_item_id is not null
     and not exists (select 1 from inventory_items i where i.id = new.inventory_item_id) then
    new.inventory_item_id := null;
  end if;

  return new;
end $function$;

drop trigger if exists trg_ensure_menu_item_parents on public.menu_items;
create trigger trg_ensure_menu_item_parents
  before insert or update on public.menu_items
  for each row execute function public.ensure_menu_item_parents();

create or replace function public.ensure_inventory_item_parents()
returns trigger language plpgsql security definer
set search_path to 'public' as $function$
begin
  if new.category_id is not null
     and not exists (select 1 from inventory_categories c where c.id = new.category_id) then
    insert into inventory_categories (id, tenant_id, name, sort_order)
    values (new.category_id, new.tenant_id, 'Uncategorised', 9999)
    on conflict (id) do nothing;
  end if;
  return new;
end $function$;

drop trigger if exists trg_ensure_inventory_item_parents on public.inventory_items;
create trigger trg_ensure_inventory_item_parents
  before insert or update on public.inventory_items
  for each row execute function public.ensure_inventory_item_parents();

create or replace function public.ensure_dining_table_parents()
returns trigger language plpgsql security definer
set search_path to 'public' as $function$
begin
  if new.floor_id is not null
     and not exists (select 1 from floors f where f.id = new.floor_id) then
    insert into floors (id, tenant_id, branch_id, name, sort_order)
    values (new.floor_id, new.tenant_id, new.branch_id, 'Main Floor', 9999)
    on conflict (id) do nothing;
  end if;
  return new;
end $function$;

drop trigger if exists trg_ensure_dining_table_parents on public.dining_tables;
create trigger trg_ensure_dining_table_parents
  before insert or update on public.dining_tables
  for each row execute function public.ensure_dining_table_parents();

-- The inventory mapper defaults base_unit to 'unit'; the CHECK allowed only
-- kg/g/l/ml/pcs. Real data also uses litre, dozen, packet, tin.
alter table public.inventory_items drop constraint if exists inventory_items_base_unit_check;
alter table public.inventory_items add constraint inventory_items_base_unit_check
  check (base_unit is null or length(btrim(base_unit)) between 1 and 24);

alter table public.admin_support_messages drop constraint if exists admin_support_messages_direction_check;
alter table public.admin_support_messages add constraint admin_support_messages_direction_check
  check (direction is null or direction = any (array['in','out','inbound','outbound']));

alter table public.admin_marketing_contacts alter column name drop not null;

notify pgrst, 'reload schema';

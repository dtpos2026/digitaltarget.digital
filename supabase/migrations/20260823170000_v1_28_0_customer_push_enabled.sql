-- ===========================================================================
-- v1.28.0 — Tell the customer whether this account can be reached by push
--
-- The profile screen needs to show the alerts toggle in the right position,
-- and the only truth about that is the server row. The token itself is never
-- returned — a boolean is all the client needs, and the token is a routable
-- address to somebody's phone.
-- ===========================================================================
create or replace function public.customer_public_json(c public.customers)
returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'id',            c.id,
    'name',          c.name,
    'phone',         c.phone,
    'email',         c.email,
    'address',       c.address,
    'city',          c.city,
    'area',          c.area,
    'fullAddress',   c.full_address,
    'addresses',     coalesce(c.addresses, '[]'::jsonb),
    'dateOfBirth',   c.date_of_birth,
    'gender',        c.gender,
    'lat',           c.lat,
    'lng',           c.lng,
    'loyaltyPoints', c.loyalty_points,
    'totalOrders',   c.total_orders,
    'lastOrderAt',   c.last_order_at,
    -- Whether a device is registered, never which device.
    'pushEnabled',   nullif(btrim(coalesce(c.push_token, '')), '') is not null);
$$;

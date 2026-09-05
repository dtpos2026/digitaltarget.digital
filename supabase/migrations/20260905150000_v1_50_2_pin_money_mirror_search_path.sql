-- The linter is right and this one is mine: sync_order_money_mirror was created
-- without a pinned search_path. A trigger function with a mutable search_path
-- resolves its unqualified names against whatever the caller's path happens to
-- be, which is a hijack waiting for someone who can create objects in an
-- earlier schema. Every other function added in this work pins it; this one was
-- missed. Body unchanged.
alter function public.sync_order_money_mirror() set search_path = public, extensions;

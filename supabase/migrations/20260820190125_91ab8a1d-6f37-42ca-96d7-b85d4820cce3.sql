REVOKE EXECUTE ON FUNCTION public.public_place_order(uuid, uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_track_order(uuid, uuid, integer, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.public_call_waiter(uuid, uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_place_order(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_track_order(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.public_call_waiter(uuid, uuid, text, text, text) TO service_role;
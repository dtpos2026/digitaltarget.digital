ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS custom_device_limit integer;

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS is_kds boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS kds_kitchen_id text,
  ADD COLUMN IF NOT EXISTS kds_kitchen_name text;
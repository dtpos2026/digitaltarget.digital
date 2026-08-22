ALTER TABLE public.admin_marketing_contacts
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS linked_device_ids uuid[] NOT NULL DEFAULT '{}';
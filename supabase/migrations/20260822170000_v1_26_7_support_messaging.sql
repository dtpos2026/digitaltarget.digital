-- ============================================================================
-- v1.26.7 — support messaging never worked in either direction
--
-- REPORTED: Super Admin sends a message, the POS never receives it. The POS
-- sends one, the Super Admin never receives it. Images "fail". Retry appears
-- but nothing reaches the other side.
--
-- ROOT CAUSE 1 — the CHECK constraint rejects every message the code sends.
--
--   live:  CHECK (direction IS NULL OR direction IN ('in','out','inbound','outbound'))
--   code:  dirFromSide() returns 'owner' | 'support'
--
-- So every insert fails with 23514, in both directions, for text and images
-- alike. Verified by impersonating both a Super Admin and a restaurant owner:
-- both got "violates check constraint admin_support_messages_direction_check".
-- The table holds 0 rows — no support message has ever been stored.
--
-- support.ts even documents the contract it expected:
--   "The table's CHECK constraint allows only 'in' | 'out' | 'owner' | 'support'."
-- That is what the widened constraint was supposed to be. Like the Workspace
-- Code generator, the migration that widened it never reached this database.
--
-- Widening the constraint is the right direction rather than changing the
-- client: the reader (sideFromDir) already understands both vocabularies, and
-- any legacy row using 'in'/'out' stays valid.
--
-- ROOT CAUSE 2 — the Super Admin cannot touch support attachments.
--
-- The only policy on the support-attachments bucket is
--   (storage.foldername(name))[1] = auth_tenant_id()::text
-- A Super Admin has no user_profiles row, so auth_tenant_id() is NULL and the
-- predicate evaluates to NULL — never true. Verified live: is_super_admin()
-- true, auth_tenant_id() null. So the Super Admin could neither upload an
-- image nor sign a URL to view one the restaurant had sent. That is both
-- halves of the image complaint.
--
-- Restaurants keep exactly the access they had: their own tenant folder only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Accept the vocabulary the application speaks.
-- ---------------------------------------------------------------------------
alter table public.admin_support_messages
  drop constraint if exists admin_support_messages_direction_check;

alter table public.admin_support_messages
  add constraint admin_support_messages_direction_check
  check (
    direction is null
    or direction = any (array[
      -- what the application sends
      'owner'::text, 'support'::text,
      -- kept so any historic row remains valid
      'in'::text, 'out'::text, 'inbound'::text, 'outbound'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. Let the Super Admin handle attachments for the restaurant they are
--    helping. Scoped to this one bucket, and to super admins only.
-- ---------------------------------------------------------------------------
drop policy if exists "support-attachments_super_admin" on storage.objects;
create policy "support-attachments_super_admin" on storage.objects
  for all to authenticated
  using      (bucket_id = 'support-attachments' and public.is_super_admin())
  with check (bucket_id = 'support-attachments' and public.is_super_admin());

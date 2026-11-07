-- Rollback for 20261107150000_v1_113_0_promo_code_fields.sql. Only needed if the three columns must be removed; nothing else depends on them in the database.
alter table public.promo_codes
  drop column if exists min_order_amount,
  drop column if exists accounts_only,
  drop column if exists notes;

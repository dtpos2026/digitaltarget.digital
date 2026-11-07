-- v1.113.0 — promo codes: the conditions a restaurant sets on a code never reached the cloud, and a code could be made for account holders only.
-- Additive: three new columns, nothing dropped or rewritten, no existing row changes (the table has no rows today). The app's own words are
-- mapped onto the existing columns in code (percent / pkr <-> percent / fixed, usageLimit <-> max_uses, startDate / endDate <-> valid_from / valid_until).
-- Rollback: docs/rollback/2026-11-07-v1_113_0-promo-code-fields.sql
alter table public.promo_codes
  add column if not exists min_order_amount numeric(12,2),
  add column if not exists accounts_only    boolean not null default false,
  add column if not exists notes            text;
comment on column public.promo_codes.accounts_only is 'v1.113.0 — the code is only for a customer who is signed in on the ordering site (the till is not affected).';

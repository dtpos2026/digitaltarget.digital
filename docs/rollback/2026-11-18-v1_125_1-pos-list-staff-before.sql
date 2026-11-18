-- Rollback for 20261118130000_v1_125_1_pos_list_staff.sql: removes the read-only function. Nothing else changed in the database
-- (pos_list_users was not touched), so this puts the database back exactly as it was. The Users screen falls back to pos_list_users.
drop function if exists public.pos_list_staff();

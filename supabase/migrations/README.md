# Migration history is incomplete — read this before rebuilding

`supabase/migrations/` does **not** contain the whole backend. 28 of the 63
functions that exist in the live database were created by hand in the SQL
editor and were never written back to a migration file, among them
`pos_create_user`, `custom_access_token_hook`, `can_access_branch`,
`auth_role`, `auth_branch_id`, `verify_manager_password` and
`resolve_order_number_collision`.

Nothing breaks today: the live database has them. But **this repository
cannot recreate the backend from scratch**, so a fresh project built from
these files alone would have working tables and a broken login.

## Fixing it

`supabase/config.toml` used to name a project that does not exist on this
account (`grtrixkbcponjmomgmat`), so every CLI command run from the repo
silently targeted nothing. That is corrected, so the standard tool now works:

```sh
supabase link --project-ref drpzxzpvkpqfxcjbwypo
supabase db pull            # writes the live schema back as a migration
```

Run that and commit the result. It is worth doing before the next schema
change, not after.

Do this with the CLI rather than by copying definitions by hand: several of
the missing functions hash passwords, mint JWT claims or enforce
branch-level access, and a transcription slip in one of those is a security
bug rather than a typo.

## The functions that ARE covered

Anything created by the numbered migrations in this directory, plus
everything in `20260822100000_v1_26_0_sync_foundations.sql`, which is
idempotent and safe to re-run.

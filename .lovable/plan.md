# Fix restaurant cloud sync and UI regressions

## What will change

1. **Make Lovable Cloud the active data path**
   - Replace the legacy Firebase-only gate used by store initialization and normal entity writes with a backend-aware cloud gate.
   - Keep local-first saving, but ensure categories, menu items, settings, and related records are immediately queued/written to the database.
   - Preserve good local menu rows when a cloud read fails instead of replacing them with empty data.

2. **Correct menu/category database mapping**
   - Translate app fields such as menu/category images and soft-delete timestamps to the actual database columns.
   - Add the missing category image/icon columns and allow all menu pricing modes already supported by the UI.
   - Make Excel import await cloud persistence and report an exact failed row/reason instead of showing success before syncing.

3. **Fix image upload routing**
   - Route restaurant menu images directly to Lovable Cloud storage before checking any removed Firebase path.
   - Create/configure the required image buckets and tenant-scoped access policies if they are missing.

4. **Keep sidebar modules after branch selection**
   - Remove the full-page reload from branch selection.
   - Preserve the authenticated POS user and re-render branch-aware content without clearing the locally mirrored user used by permissions.
   - Keep plan-based module filtering intact.

5. **Remove visible Firebase errors**
   - Stop order/service background notifiers from calling removed Firebase APIs on cloud restaurants.
   - Use the cloud order refresh path where available and gracefully skip unsupported legacy service-call polling.

6. **Make Payment Receive readable**
   - Constrain the dialog to the viewport, add an internal vertical scroll region, and keep the title/confirm action accessible.

## Verification

- Import a small Excel menu, refresh, and confirm categories/items remain from the database.
- Upload a menu image and confirm its stored URL renders after refresh.
- Select a branch and confirm sidebar modules remain visible according to the restaurant plan.
- Open Payment Receive at desktop and short viewport sizes and confirm all fields can be scrolled/read.
- Confirm no `firebase-removed initializeApp` runtime error is emitted by the affected screens.

## Technical details

- Changes will stay within the existing local-first store architecture; this is not a rewrite.
- Database changes will use a migration with explicit grants/RLS-compatible storage policies.
- Existing tenant isolation remains enforced on every read, write, and upload path.

# How to check the live site is running THIS build

A whole day was lost to one question: *is the deployed site actually running
the new build?* Database fixes apply instantly; **code fixes only apply after a
redeploy**, and there was no way to tell them apart from outside.

Now there is.

## After deploying

1. Open the live site.
2. Press **F12** → **Console** tab.
3. Look for a blue badge near the top:

```
DT-POS-1.25.21   cloudFk-foreign-key-mapping | settings-save-no-throw |
                 cloudflare-workers-env-bindings | order-document-columns |
                 fail-safe-sync-merge
```

**If you see `DT-POS-1.25.21`** → the new build is live. Any remaining problem
is a real bug; send the console errors.

**If you do NOT see it** → the deploy did not reach the domain. The code fixes
are not active, and no amount of database work will help. Fix the deploy first:

```cmd
npm install
npm run build
wrangler pages deploy dist --project-name dt-pos
```

Then check the **Deployments** tab in Cloudflare: the newest deployment must be
the one your custom domain points at. A `*.pages.dev` preview URL updating while
`digitaltarget.digital` stays stale means the production alias did not move.

## Then run these, in order

| # | Test | Expected |
|---|---|---|
| 1 | Open Menu | Items appear **under their categories**, not uncategorised |
| 2 | Hard refresh (Ctrl+Shift+R) | Same items, same categories |
| 3 | Change restaurant name + logo, Save, refresh | New name and logo persist |
| 4 | Second browser, same account, hard refresh | Same name, logo and menu |
| 5 | Create an order | Appears in the second browser after refresh |

Test 1 is the important one. Until this build, every menu item synced with
`category_id = NULL`, so the menu could not reassemble itself from the cloud.

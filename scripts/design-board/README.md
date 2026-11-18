# Design-match board

Puts the Design Package's own preview of every desktop screen (`design-project/02-restaurant-software/previews/sw-xx.png`, 1440×900) next to
the real screen of this software at the same size, so the differences can be seen and fixed one screen at a time.
The package is the reference (it is the same as `DT-POS-Design-Package-v1.1.zip`); the plan and the findings are in `docs/design-match/PLAN.md`.

```bash
export BOARD_DIR=$PWD/.design-board CHROMIUM_PATH=/opt/pw-browsers/chromium      # CHROMIUM_PATH only where Playwright's own browser is missing
python3 scripts/design-board/build-harness.py                                      # screens.json + the harness page
cp $BOARD_DIR/shotHarness.tsx src/shotHarness.tsx
printf "import { createFileRoute, ClientOnly } from '@tanstack/react-router';\nimport { lazy, Suspense } from 'react';\nconst Harness = lazy(() => import('@/shotHarness'));\nexport const Route = createFileRoute('/shot')({ component: () => <ClientOnly fallback={null}><Suspense fallback={null}><Harness /></Suspense></ClientOnly> });\n" > src/routes/shot.tsx
npx vite dev --port 5188 --host 127.0.0.1 &                                        # wait until http://127.0.0.1:5188/shot answers
node scripts/design-board/board.cjs                                                # all screens, or: node scripts/design-board/board.cjs SW-06 SW-10
python3 scripts/design-board/compose.py                                            # one design | ours PNG per screen in $BOARD_DIR/pairs
# clean up: stop vite; rm src/shotHarness.tsx src/routes/shot.tsx; git checkout -- src/routeTree.gen.ts
```
The harness route (`/shot`) is temporary and must never be committed (it skips the cloud sign-in). The seeded data is a small sample restaurant
(8 categories, 12 items, 12 orders, 8 tables, 6 customers), so a screen can show a state the real data would not; compare layout, not numbers.

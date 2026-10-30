# release-tooling/windows-zip

The four files that sit at the **root** of the delivered `DT-POS-Enterprise-Windows-source-<version>.zip`.
They are kept here so the ZIP can be rebuilt any time instead of living only on one machine.

| File | Role |
|---|---|
| `package.json` | root `npm install` / `build` / `dist` / `test` / `deploy` |
| `scripts/build-all.mjs` | runs the web app and the Electron shell in the right order; stamps the shell's version from the web app's |
| `README-BUILD.md` | the instructions the person building the ZIP reads first |
| `.env.example` | where each setting lives (nothing to fill in for a normal build) |

## Assemble the ZIP

```bash
OUT=DT-POS-Enterprise-Windows
mkdir -p $OUT/digitaltarget.digital $OUT/dtpos-desktop
git -C digitaltarget.digital archive HEAD | tar -x -C $OUT/digitaltarget.digital
git -C dtpos-desktop archive <shell commit> | tar -x -C $OUT/dtpos-desktop     # tracked files only: no node_modules, no build output
cp -r digitaltarget.digital/release-tooling/windows-zip/. $OUT/                  # then delete $OUT/README.md
zip -r DT-POS-Enterprise-Windows-source-<version>.zip $OUT
```

Then verify from a **fresh extract**: `npm install`, `npm run build`, `npm test`.

# Theme Manager, Modern shell, More menu and Module Management — brought across from the offline POS (v1.21.0)

**Release:** v1.78.0 · 2026-11-01

The owner asked for the offline POS's Appearance → Theme Manager, its sidebar with a "More" launcher, and Module Management in
the cloud app, "same as same". This file says what came across, what was changed on purpose for the cloud app, and what is **not**
done yet.

## What came across
| Piece | Where | Notes |
|---|---|---|
| Interface style: **Modern** or **DT Enterprise (Classic)** | `Settings → Appearance` (`InterfaceStyleCard`) | Classic is the look every restaurant already has. |
| **13 Modern themes** (Ember Orange … Navy Night) | `lib/uiThemes.ts`, `styles/ui-tokens.css` | Each sets page, panels, borders, text, accent, sidebar light/dark. |
| **8 DT Retail themes** (Royal Purple, Crimson, Black & Gold, Emerald, Sunset, Ocean, Night, Espresso) | same | Gradient sidebar, greeting banner on the dashboard, KPI highlight, motion; two dark pages. |
| **Custom themes / "My own colours"** | `CustomThemeManager`, `lib/customTheme.ts` | Design, save, edit, copy, export/import a theme file; readability is enforced. |
| Accent override on any theme | `InterfaceStyleCard` | Presets or `#rrggbb`; darkened until white text reads. |
| Theme previews | `ThemePreview` | A miniature POS in each theme's own colours. |
| Smooth animations switch, "Back to my previous look" | `InterfaceStyleCard` | |
| **Restart application / Reload screen** | `lib/appRestart.ts` | Lets the upload queue drain (up to 2.5 s) first; never clears data. |
| **Modern sidebar** (collapsible, favourites, More with count) and **header** | `components/shell/*` | The cloud's own status chips are kept (online, print mode, setup check, version, billing, pending sync, restaurant identity, branch, sync badge). |
| **More launcher** — every module the user may open, grouped, searchable, star to pin | `ModuleLauncher` | The "four boxes" panel. |
| **Module Management** — Sidebar / More / Hidden per module, favourites, reorder, restore default | `Settings → Modules` (`ModuleManagementCard`), `lib/navPrefs.ts` | Saved on the device; survives a restart. Settings itself cannot be hidden. |
| Settings as a left-hand list (Modern) | `SettingsPage` | The card grid stays in Classic. `?tab=` opens a section directly. |
| Modern dashboard, UI kit | `components/dashboard/ModernDashboard`, `components/ui-kit/*` | |
| Colour dots and counts on category pills, initials tiles | `POSScreen` hooks, `lib/categoryColors.ts`, `lib/tileLook.ts` | Visible in the Espresso / DT Retail looks. |
| Premium Polish (soft shadows, focus ring) | `lib/premiumPolish.ts` | Classic only, as in the offline POS. |
| 4 stylesheets | `styles/ui-{tokens,modern,pos,retail}.css` | Every rule hangs off `html[data-ui="modern"]`; with Classic selected none of it matches. |

## What is different in the cloud app (on purpose)
1. **Default stays Classic / DT Enterprise.** The offline POS defaults to Modern; every cloud restaurant already has the DT
   Enterprise look, so nobody's screen changes until they choose.
2. **Modern is a premium allotment.** Super Admin allots it per restaurant (the same `premiumThemeAllowed` switch the v1.61.0 /
   v1.68.0 premium themes use). Without it the Modern tile shows a lock and the boot gate puts a revoked restaurant back on
   Classic. This is the SaaS "Feature Access Control" in practice.
3. **A restaurant that had picked one of the 21 v1.68.0 reference themes keeps its look**: it is moved once to the Modern style
   with the same theme. Those 21 palette-only entries no longer repeat in the Classic list.
4. **The Modern menu follows the same rules as the Classic one** (role, plan, modules the restaurant switched on). The first
   port of the sidebar ignored the plan and the module switches — caught by the ported tests and fixed.
5. The restaurant's name leads the sidebar on every theme except the one that is itself a brand (the v1.68.0 rule).
6. Offline-only screens were **not** ported: the Espresso sign-in panel with PIN page and the default-password warning (the
   cloud has its own sign-in and server-side passwords).

## NOT done (so nothing is assumed)
- **The Modern POS order screen layout.** The offline POS's `ui-pos.css` styles the sale screen through ~60 `data-pos-*` marks and
  has Screen & Layout presets (`ScreenLayoutTab`, `usePosLayout`). The cloud `POSScreen` has diverged by ~2,000 lines and carries
  only a handful of those marks, so in Modern the sale screen gets the Modern colours, radius and category pills but **not** the
  offline layout. Porting it is the next piece of work, together with the Screen & Layout settings section.
- **Retail variants of the sign-in and splash screens.**
- **"OK Art" theme.** No theme of that name exists anywhere in the offline source (searched code, docs and READMEs). If it is a
  differently-named theme, tell me which one; a theme like it can already be designed under Appearance → Custom.
- **Per-restaurant sync of the look.** The choice is stored on the device (as in the offline POS, "on this computer"). Two
  devices of one restaurant can therefore look different, and two restaurants on one browser share the setting. Storing the
  look and the menu layout in the restaurant's cloud settings is a follow-up.
- **First paint.** The saved style is applied as soon as the client bundle runs, not from an inline script, so a very slow
  device may show the default look for an instant.
- Real devices: checked in a desktop Chromium only (screenshots of dashboard, Settings → Appearance / Modules, the More
  launcher, Black & Gold, Night, Royal Purple, Emerald). Not checked: the Windows shell, tablets, other browsers.

## Verification
| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| Full suite | see `docs/qa/2026-11-01-QAT-UAT-v1.78.0-theme-manager.md` |
| Ported offline suites | `v121-ui-themes`, `v121-ui-style`, `v121-dt-retail-look`, `v121-custom-theme`, `v121-modern-shell`, `v121-espresso-theme` (trimmed, see its footer) |
| Cloud-specific suite | `themeManager_v1_78_0` |

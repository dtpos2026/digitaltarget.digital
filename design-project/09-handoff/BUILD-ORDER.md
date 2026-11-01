# Build order

The order the product owner asked for. Each step names the screens it implements and what must exist first.

| # | Step | Screens | Needs first | Risk |
|---|---|---|---|---|
| 1 | **Windows POS inner shell** — sidebar, top bar, dashboard | SW-02 (dashboard) and the shell around every SW screen | Nothing in the backend. Add a "Refined" theme and swap layout components; keep every route | Low. Theme + layout only; permission-filtered sidebar must keep working |
| 2 | **Owner portal pages** | OWN-04/05/06/07/11 first (all on existing data), then OWN-13/14/15 | Nothing in the backend (desktop version already exists as Owner Management) | Low–medium. Phone shell: Capacitor over the existing routes |
| 3 | **Customer order site** — header, drawer, hero, then pages | **First the data**: banners, opening hours, social links (a small additive table, nothing existing is changed), then WEB-01/02 | A **database backup confirmation** and your approval of the table | Medium: touches production schema (additive) |
| 4 | **Phone apps inner screens** | Customer APP-05…16, Rider RID-04…13/16/17, Owner rest | Steps 2–3 for shared components | Medium |
| 5 | **Customer app splash** | APP-01 (and onboarding APP-02) | Extend `scripts/brand/build-brand-assets.mjs` with the Customer icon/splash; the Android build must be run by you | Low |
| 6 | **Needs-backend items** | APP-03/04/18, RID-03/06/14/20, OWN-18 | Decisions 1–4 in HANDOFF.md | Each is its own small project |

Rules for every step: ship behind the existing tests, add tests for new pure logic, keep Lovable history intact (no force-push), and update `docs/CHANGELOG.md`.

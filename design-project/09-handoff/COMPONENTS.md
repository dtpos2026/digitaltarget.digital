# Component specifications

All sizes in px. States listed for every interactive component: default · hover (desktop) · pressed · focus (visible ring: `--shadow-focus`) · disabled (50 % opacity, no pointer) · loading (spinner replaces the label, width kept).

| Component | Variants | Sizes | Anatomy and rules | Tokens |
|---|---|---|---|---|
| Button | primary, secondary, ghost, danger | sm 32 · md 40 · lg 52 (phone main action) | Label 14/600; optional leading icon 16–18; one primary per screen region; full-width on phones | accent, surface, border, bad |
| Icon button | primary, secondary | 32 · 40 · 44 min target | Icon 18; always has an accessible name | accent |
| Chip | default, on, with icon | 32 high | Filter or choice; on = accent fill, white text | accent, border |
| Badge / status badge | ok, info, warn, bad, acc, neutral | 22 high | Word + colour, never colour alone; the 19 real statuses map in design-system §06 | semantic |
| Input | default, focus, error, disabled, with icon | 44 (phone) · 40 (desktop) | Label above (12/600), helper or error below; error = red border + message | border, bad |
| Toggle | on / off | 40 × 24 | Takes effect immediately unless inside a form; failure snaps back with a toast | accent |
| Checkbox / radio | on / off | 20 | Label is part of the tap target | accent |
| Segmented control | 2–4 options | 36 | Delivery / Pickup, period presets | surface-2, accent |
| Tabs | underline | 40 | Desktop and tablet sub-navigation | accent |
| Card | default, flat, tint, selected | radius 16, padding 16 | One idea per card; selected = accent border + tint | surface, border, shadow-card |
| KPI tile | with delta, with sparkline | — | Label 12 · value 20–26/800 · delta (▲ ok / ▼ bad) | semantic |
| Table | sortable, selectable row | row 44 | Right-align numbers; sticky header; empty row state | border |
| Avatar | initials, image | 36 · 56 | Initials on accent tint | accent-tint |
| Progress / share bar | — | 6 high | Branch share, stock level | accent |
| Skeleton | line, block | — | Same shape as content; shimmer off with reduced motion | surface-2 |
| Banner | ok, info, warn, bad | — | Icon + one sentence + optional action; sits at the top of the region it concerns | semantic |
| Empty state | with action | — | Disc 84 + title 18/700 + one sentence + one button | accent-tint |
| Bottom sheet | — | radius 24 top | Handle, title, content, one primary action; scrim 50 % | surface, shadow-pop |
| App bar | with back, with actions | 56 | Title 18/700 | surface |
| Tab bar (phone) | 4–5 tabs | 64 | Icon 22 + label 11; active = accent | accent |
| Sidebar (desktop) | expanded 248, collapsed 72 | — | Accordion groups; only permitted modules drawn; badge for pending counts | accent, surface |
| Top bar | — | 64 | Title, branch switcher, search, sync status, user | surface |
| Map placeholder | with route, with pins | — | Stands in for the device map SDK; label "map area" | — |
| Step list (tracking) | done / now / todo | — | Real delivery statuses; "now" shows time of last update | accent |
| Item row / card | row, card | image 76 / 100 | Image, name, sub-line, price in accent, add / stepper | accent |
| Cart line | — | — | Name, note, stepper, line total | — |

## Accessibility
- Contrast: measured in design-system §02. Body text ≥ 4.5 : 1 in both themes; "faint" is decoration only.
- Targets ≥ 44 px on phones (52 for the main button); ≥ 40 on desktop.
- Focus ring always visible; order follows reading order; all icon-only buttons need an accessible name.
- Motion respects `prefers-reduced-motion` (tokens collapse to 0 ms; the splash shows the mark without drawing it).
- Status is always word + colour.
- Text scales with the system font size; layouts reflow, nothing is clipped at 200 %.

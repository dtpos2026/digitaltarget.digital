# DT POS ecosystem — UI/UX design package

132 screens across five products, one design system, six flow diagrams, an integration architecture and a developer handoff. Everything is generated from source (`tools/`) with Node ≥ 22.18 and Playwright. The tools import `src/lib/brand.ts`, so rebuilding needs the repository (this folder sits at its root as `design-project/`). Viewing the package needs only a browser. To rebuild:

```
node design-project/tools/build.mjs        # all screens → HTML + PNG + gallery + SCREENS.md
node design-project/tools/build-docs.mjs   # design system, flows, architecture, handoff, README
```

Open **`index.html`** first.

| # | Folder | What |
|---|---|---|
| 00 | source-analysis | what the real system does (and does not) |
| 01 | design-system | tokens, measured contrast, components, light + dark |
| 02 | restaurant-software | 40 screens — Windows POS + web |
| 03 | customer-website | 21 screens + desktop variants |
| 04 | customer-app | 25 screens |
| 05 | rider-app | 22 screens |
| 06 | owner-app | 24 screens |
| 07 | flows | 6 diagrams |
| 08 | architecture | integration diagram + gaps |
| 09 | handoff | handoff, screen map, components, build order |

## Honesty notes
- **Sample content only.** Names, prices and figures are placeholders.
- **Support tags.** Each screen is tagged *exists* / *new UI on existing data* / *needs backend*; nothing that the backend cannot do is drawn as working.
- **Not Figma.** The Figma connector was not used: a Figma file would need to be rebuilt by hand from these screens. The HTML screens are the source of truth; `tokens.json` is ready to import as Figma variables.
- **Not built into the app yet.** This package is the design. Implementation follows `09-handoff/BUILD-ORDER.md`.
- **Maps** are drawn as a labelled placeholder where the device map SDK goes.
- **Order Taker app** is in the product but not in the brief's five; it takes the same system with the teal accent (tokens only).

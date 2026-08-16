# X Bookmarks — Design System & UX Architecture

A ground-up redesign of both product surfaces on **Material Design 3
Expressive**. Nothing from the previous UI was carried forward — not the
layout, not the components, not the visual language.

---

## 1. The product, stated honestly

Two surfaces, one job:

| Surface | Width | Job | Emotional register |
|---|---|---|---|
| **Extension popup** | 360 px, no scroll chrome | Start a capture, watch it run, export the result | *Reassurance.* A script is driving someone's logged-in social account. It must feel controlled and stoppable. |
| **Dashboard** | 360 → 1920 px | Read, search, tag, annotate and archive a personal library | *Ownership.* This is your stuff, on your machine, and it looks like somewhere you'd want to spend time. |

They share one design system (`shared/m3e/`) so they read as one product.

---

## 2. What "Expressive" is being used for

M3 Expressive is not decoration bolted onto M3. The 2025 update is a research
result: emphasised type, tonal containers, springy motion and varied shape
measurably speed up target acquisition and improve subgroup comprehension —
*if* the emphasis is rationed. Google's own guidance is roughly **80 % standard,
20 % expressive**.

This project spends its 20 % deliberately:

| Expressive move | Where | What it buys |
|---|---|---|
| Display-scale numeral | Hero count, one per screen | The library's size is the first thing you know |
| Tonal containers on stats | Hero stats, popup counters | Four numbers become four *kinds* of number |
| Shape as state | `.bmk` cards: default `large-increased` → selected `extra-large` | Selection is legible without relying on colour |
| Spring motion | Press, sheet, FAB menu | Interface feels physical, not teleported |
| Wavy progress | Popup capture | Long, indeterminate work reads as "alive" |
| Shape morph on press | Every button squares off then springs back | Confirms the press at the point of contact |

Everything else — list rhythm, forms, dialogs, navigation — is deliberately
plain. Expressiveness that is everywhere is just noise, and noise is the exact
failure mode of the UI this replaces.

---

## 3. Architecture

```
shared/m3e/            ← the design system. One source of truth.
  color.js               CIE-LCh tonal palettes, scheme variants, WCAG maths
  tokens.css             --md-ref-* / --md-sys-* ; product extras as --m3e-*
  fonts.css              self-hosted Roboto Flex (wght + opsz axes)
  components.css         29 component sections, tokens-only
  theme.js               settings → CSS custom properties, OS-preference aware
  interactions.js        overlays, snackbar, menus, ripple, breakpoints
shared/fonts/          ← woff2 variable font subsets

dashboard/
  index.html  layout.css  app.js   bookmarks.json

extension/
  popup.html  popup.css  popup.js  background.js
  manifest.json  content.js  page.js        ← capture logic, untouched
  shared/                                    ← mirrored, see below

tools/sync-shared.mjs  ← mirrors shared/ into extension/, --check in CI
tests/                 ← content-script tests + design-system regression tests
design/                ← this documentation
```

**No build step.** Plain HTML, CSS and vanilla JS, matching the repository as
found. Node is used only to run tests and the mirror tool.

### Why `extension/shared/` is a committed copy

A Chrome extension's root is the directory holding `manifest.json`, and an
extension page cannot reference anything above it — `../shared/…` from
`popup.html` resolves outside the package and silently fails to load. The
alternatives were to fork the design system (guaranteed drift) or move the
manifest to the repo root (which would ship the dashboard, tests and `.git`
inside the extension).

Instead there is one authored copy in `shared/`, mirrored into the package by
`tools/sync-shared.mjs`. The mirror is committed so "Load unpacked" works with
no build step, every mirrored text file carries an
`AUTO-GENERATED — do not edit` banner, and `tests/design-system.test.mjs` runs
`--check`, so the copy can never silently drift.

---

## 4. Documents

| File | Contents |
|---|---|
| `01-foundations.md` | Colour, type, shape, space, elevation, motion — every token and the reasoning, including deliberate deviations from M3's reference implementation |
| `02-components.md` | Component inventory, anatomy, states, and the M3E guideline each maps to |
| `03-layout-and-navigation.md` | Adaptive strategy across the five window classes, navigation model, information architecture |
| `04-accessibility.md` | Contrast maths, keyboard model, screen-reader semantics, reduced motion, forced colours |
| `05-critique.md` | Design critique: what was wrong before, what changed, what each decision traces to, and what remains open |

---

## 5. Verifying it

```bash
node --test tests/run-tests.mjs           # capture logic (10 tests, unchanged)
node --test tests/design-system.test.mjs  # design-system invariants (10 tests)
node --test tests/media.test.mjs          # media playback + grid data (12 tests)
node --test tests/integration.test.mjs    # lightbox layering + extension bridge (10 tests)
node tools/sync-shared.mjs         # re-mirror after editing shared/ or dashboard/

python3 -m http.server 8080        # then open /dashboard/index.html
# extension: chrome://extensions → Load unpacked → extension/
```

The design-system suite is not decorative. It fails the build if any text pair
in the entire personalisation space (6 seeds × 4 variants × 3 contrast levels ×
light/dark = 2 160 pairs) drops below 4.5:1, if a control border uses a
decorative colour role, if two curated seeds collapse to the same scheme, if
the extension mirror is stale, or if either surface references a file that
does not exist.

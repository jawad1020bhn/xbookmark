# X Bookmarks — Design System & UX Architecture

A ground-up redesign of both product surfaces on **Material Design 3
Expressive**. Nothing from the previous UI was carried forward — not the
layout, not the components, not the visual language, and above all not the
model of what the product *is*.

---

## 1. The product, stated honestly

The previous build was a **list of posts that happened to contain pictures**.
Everything followed from that mistake. A card was a text block with a
thumbnail strip stapled underneath. The loudest element on the page was a
count of how many bookmarks existed. Looking at a photograph took two clicks.
There was a tagging system and a note-taking system, neither of which anyone
uses, both of which asked the reader to do filing work at the exact moment
they wanted to be entertained.

Nobody opens a bookmark archive to read a count.

**This is a media browser.** The unit of the application is a single photo or
video, not a post. The centre of the screen contains nothing but media. Every
other decision in this document is downstream of that one sentence.

| Surface | Width | Job | Emotional register |
|---|---|---|---|
| **Extension popup** | 360 px, no scroll chrome | Start a capture, watch it run, export the result | *Reassurance.* A script is driving someone's logged-in social account. It must feel controlled and stoppable. |
| **Dashboard** | 360 → 1920 px | Browse, scroll and watch everything you saved | *Absorption.* The interface should disappear and leave the media. |

They share one design system (`shared/m3e/`) so they read as one product.

---

## 2. The three views

"Browse" means different things at different moments, so there are three
renderers over one index. The view switch is a permanent segmented button in
the app bar — not a menu item — because it is the most consequential control
on the page.

| View | Shape | The question it answers | Default for |
|---|---|---|---|
| **Rails** | Horizontal carousels, grouped | *"What have I got?"* — grazing | First open |
| **Grid** | Justified, aspect-respecting columns | *"Where is that one thing?"* — searching | After a filter or search |
| **Theater** | One item per screen, paged horizontally | *"Show me."* — watching | Reached by `v`, or from a rail |

All three scroll horizontally at the point of interaction, which is the
brief's central requirement and the interaction model of X itself. Rails
scroll x within a y-scrolling page; theater is pure x.

---

## 3. What "Expressive" is being used for

M3 Expressive is not decoration bolted onto M3. The 2025 update is a research
result: emphasised type, tonal containers, springy motion and varied shape
measurably speed up target acquisition and improve subgroup comprehension —
*if* the emphasis is rationed. Google's own guidance is roughly **80 % standard,
20 % expressive**.

A media browser changes where that 20 % should be spent. Expressive typography
and tonal colour are how you make a *document* feel alive; they are noise
around a *photograph*. So the budget moved: almost all of it now goes into
**shape and motion**, which frame media without competing with it, and almost
none into colour and type, which would.

| Expressive move | Where | What it buys |
|---|---|---|
| **Carousel** (hero / multi-browse / uncontained) | Every rail | The M3E component built for exactly this problem. Peeking items say "there is more this way" without a scrollbar |
| Shape as state | Tile: `large-increased` → `medium-increased` on press | Press is confirmed by physical compression, not a colour flash |
| Spring motion | Press, sheet, rail paging, carousel arrows | The interface feels handled rather than teleported |
| Shape morph on press | Carousel arrows, tiles, play buttons round → square | Confirms contact at the point of contact |
| Tonal containers | Popup counters, capture banner, rail counts | Four numbers become four *kinds* of number |
| Wavy progress | Popup capture | Long, indeterminate work reads as "alive" |
| Organic seed swatches | Settings dialog | The one place pure delight is the point |

**Deliberately not expressive:** the media itself is never tinted, never
shape-morphed, never animated on hover beyond a 1.2 % lift. Everything in the
centre of the screen is the user's content, and expressive treatment applied
to someone else's photograph is vandalism.

---

## 4. Architecture

```
shared/m3e/            ← the design system. One source of truth.
  color.js               CIE-LCh tonal palettes, scheme variants, WCAG maths
  tokens.css             --md-ref-* / --md-sys-* ; product extras as --m3e-*
  fonts.css              self-hosted Roboto Flex (wght + opsz axes)
  components.css         33 component sections, tokens-only
  theme.js               settings → CSS custom properties, OS-preference aware
  interactions.js        overlays, snackbar, menus, ripple, carousel, breakpoints
  media.js               playback: source selection, variant ladder, autoplay
shared/fonts/          ← woff2 variable font subsets

dashboard/
  index.html  layout.css  app.js  lightbox.js  bridge.js  bookmarks.json

extension/
  popup.html  popup.css  popup.js  background.js
  manifest.json  content.js  page.js        ← capture logic
  shared/  dashboard/                        ← mirrored, see below

tools/sync-shared.mjs  ← mirrors shared/ + dashboard/ into extension/, --check in CI
tests/                 ← capture, design-system, media, sort, browse, integration
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

## 5. Documents

| File | Contents |
|---|---|
| `01-foundations.md` | Colour, type, shape, space, elevation, motion — every token and the reasoning, including deliberate deviations from M3's reference implementation |
| `02-components.md` | Component inventory, anatomy, states, and the M3E guideline each maps to |
| `03-layout-and-navigation.md` | Adaptive strategy across the window classes, the three views, navigation model, information architecture |
| `04-accessibility.md` | Contrast maths, keyboard model, screen-reader semantics, reduced motion, forced colours |
| `05-critique.md` | Design critique: what was wrong before, what changed, what each decision traces to, and what remains open |
| `06-media-and-playback.md` | The media pipeline end to end: scrape → normalise → select a source → play. The video correctness argument |

---

## 6. Verifying it

```bash
node --test tests/run-tests.mjs           # capture logic + media extraction
node --test tests/design-system.test.mjs  # colour, contrast, packaging invariants
node --test tests/media.test.mjs          # playback source selection
node --test tests/browse.test.mjs         # the media-browsing model
node --test tests/integration.test.mjs    # lightbox layering + extension bridge
node --test tests/sort.test.mjs           # sort comparators + shuffle stability
node tools/sync-shared.mjs         # re-mirror after editing shared/ or dashboard/

python3 -m http.server 8080        # then open /dashboard/index.html
# extension: chrome://extensions → Load unpacked → extension/
```

The suites are not decorative. The build fails if any text pair in the entire
personalisation space (6 seeds × 4 variants × 3 contrast levels × light/dark =
2 160 pairs) drops below 4.5:1, if a control border uses a decorative colour
role, if two curated seeds collapse to the same scheme, if the extension mirror
is stale, if either surface references a file that does not exist, if a
browsing view stops scrolling horizontally or snapping, if a carousel loses its
keyboard controls, if the viewer stops traversing the whole library, or if the
tag/note systems reappear anywhere in the source.

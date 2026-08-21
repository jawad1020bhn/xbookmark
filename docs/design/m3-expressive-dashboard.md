# The library dashboard, rebuilt on Material 3 Expressive

Owner: design · Status: implemented · Scope: `extension/dashboard/*`

This document is the specification for the dashboard redesign: what was wrong,
what replaced it, and the M3 Expressive rule behind each decision. It is written
to be argued with — every choice below names the guideline it comes from and the
product problem it solves.

---

## 1 · Critique of what was there

The design system in `extension/shared/m3e/` is complete and expressive: it ships
button groups, split buttons, a FAB menu, floating toolbars, the M3 carousel,
navigation rail and bar, wavy progress, shape-morphing state layers, and the full
expressive spring set. **The dashboard used almost none of it.** It re-implemented
weaker versions of components that already existed one directory away.

| Symptom | Evidence in the old code | Consequence |
|---|---|---|
| No navigation model | One `.appbar` row holding search + 3 view buttons + 4 icon buttons | Eight controls of equal weight; nothing said *where you are* |
| Layout ≠ navigation | "Rails / Grid / Scroll" segmented control sat where destinations belong | The only "navigation" changed presentation, never scope |
| Hand-rolled components | `.tile`, `.search`, `.switch`, `.sheet`, `.capture-pill`, `.rail__scroller` | Divergent shape, motion and state layers; `.switch` was a `div` with no `role` |
| Flat hierarchy | Every rail identical: `title-medium` + a row of tiles | Nine equal sections; no entry point, no hero moment |
| Type carried no weight | `headline-medium` as the largest type on a 1440px canvas | Display styles and the emphasized scale went unused |
| Motion was decorative | `transition: left 160ms ease` on the switch knob | Bypassed the motion-physics tokens the system already defines |
| Filters as a form | Nine `<select>` and date `<input>` elements in a sheet | A dropdown per facet is a form, not a filter |
| Compact was an afterthought | `@media (max-width: 839px) { .views { position: fixed … } }` | The desktop layout with pieces moved, not an adaptive layout |
| Dead controls on small windows | Settings/Data lived only in a row that wrapped off-screen | Unreachable settings under 600px |

The rebuild deletes all of the above. Nothing from the previous visual design is
preserved; where behaviour was correct (capture state, viewer, playback, storage)
the logic is kept and re-presented.

---

## 2 · Foundations, and where each value comes from

All tokens already exist in `shared/m3e/tokens.css`; the product layer consumes
them and defines **no** primitives of its own.

**Colour.** Roles only — never a literal. Dynamic colour is generated at runtime
from a seed by `theme.js`, so accent, contrast and light/dark are one repaint.
Pairings are always role-correct (`primary-container` + `on-primary-container`).
Surface hierarchy is carried by the container ladder, not by shadow:

| Surface | Role |
|---|---|
| Page | `surface` |
| App bar, once scrolled | `surface-container` @ 86% + blur |
| Rail | `surface` (it is not a card; it is the wall) |
| Spotlight | `primary-container` — the one saturated surface on the page |
| Tiles, rail heads | `surface-container-high(est)` |
| Floating toolbar | `surface-container-high` + blur, elevation 3 |
| Selection | `secondary-container` |
| Destructive | `error` / `error-container` |

The only fixed colours in the product layer are five `#fff` values inside the
viewer, where content sits over the user's own photograph. A theme role cannot
guarantee contrast against an arbitrary image; the system's own tile scrim makes
the same call.

**Typography.** M3 Expressive's parallel *emphasized* scale is the hierarchy
mechanism, used at roughly 80/20:

| Element | Style |
|---|---|
| Destination headline (`h1`) | `display-small` → `title-large` on scroll |
| Spotlight title | `headline-large --emphasized` |
| Rail titles | `title-large --emphasized` |
| Tile author | `label-large --emphasized` |
| Body, supporting text | `body-large` / `body-medium`, `on-surface-variant` |
| Counts, durations, stats | `--tabular` numerals |

**Shape.** The expressive scale is used as an editorial device, not a constant:
`full` for pills and chips, `large-increased` for tiles, `extra-large` for
dialogs and sheets, and `extra-extra-large` (48dp) on a single corner of the
spotlight and on the drop-zone while a file is over it. Pressed states morph
*squarer* (the M3E pressed idiom) — tiles, chips, swatches, FAB and rail pills
all do it.

**Motion.** Physics only. Spatial springs move things (position, size, corner
radius) and are allowed to overshoot; effects springs handle colour and opacity
and never do. The two families are never mixed on one property. The cubic-bezier
values in `tokens.css` are the published expressive-scheme parameters
(`0.42, 1.67, 0.21, 0.9` fast-spatial; `0.38, 1.21, 0.22, 1` default-spatial;
`0.39, 1.29, 0.35, 0.98` slow-spatial), so the same token names map 1:1 onto
Compose. There is not a single raw `ms` value in the product CSS.

**Spacing.** 4dp grid via `--md-sys-spacing-*`; window-class margins via
`--md-sys-margin-*` (16 / 24 / 24 / 32 / 32).

---

## 3 · Information architecture

The central change. **Navigation answers "what am I looking at"; the toolbar
answers "how am I looking at it".** Previously both lived in one anonymous row.

**Destinations** (persistent, 5 — within M3's 3–5 for a navigation bar):

| Destination | Scope | Badge |
|---|---|---|
| Home | everything, curated | — |
| Photos | stills | count |
| Motion | video + GIF | count |
| Unseen | captured, never opened | count |
| Archive | put aside | count |

Scope and user filters are **separate layers**. `SCOPES` produces a filter
overlay at render time; `prefs.filters` is never rewritten by navigating. So
switching destination cannot silently destroy a filter someone set by hand, and
clearing filters cannot navigate. Home restores the last layout used there;
scoped destinations open as a grid, because a scope is a set and a set wants a
grid.

**View controls** live in a floating toolbar, over the content, always reachable:
a connected **button group** for layout (Rails / Grid / Immerse), sort (menu),
and filters (icon button carrying a count badge).

---

## 4 · Adaptive layout

One canonical layout; the navigation region changes presentation by window class.

| Window class | Navigation | App bar | Toolbar + FAB | Grid |
|---|---|---|---|---|
| compact `<600` | bottom navigation bar, 80dp | 2-line, search collapses to an icon | toolbar above the bar, FAB at bottom-end beside it | 2 cols |
| medium `600–839` | rail 96dp, icon + label | 2-line, search inline (max 34vw) | toolbar centred on the pane, FAB at the top of the rail | 3 cols |
| expanded `840–1199` | rail 96dp | rail actions move into the bar | same | 4 cols |
| large `1200–1599` | **expanded rail 232dp**, labels beside icons, inline badges | same | **extended FAB** with label | 4 cols |
| xlarge `≥1600` | expanded rail | same | same | 5 cols |

Notes that matter:

- The FAB is *one* element that relocates, never two duplicated in the DOM.
- Settings and Data are in the rail's foot at medium, and in the app bar at
  compact and expanded — always exactly one reachable copy.
- The refine sheet is a **bottom sheet** on compact and a **side sheet** from
  medium up: filtering is a sustained task, and a bottom sheet on a wide window
  covers the results it is meant to be narrowing.
- The grid is CSS multi-column masonry, so mixed aspect ratios are never cropped
  to a square — the library is the content.

---

## 5 · Component specifications

### 5.1 Flexible top app bar
Two lines at rest: destination headline (`display-small --emphasized`) and a
supporting count line. On scroll (`data-scrolled`, driven by `bindScrollChrome`)
the headline animates *font-size* down to `title-large` on a default-spatial
spring, the support line collapses, and the bar lifts to `surface-container` with
blur and elevation 2. The title physically shrinks into the bar; it is not
swapped for a different element.

### 5.2 Navigation rail / bar
Anatomy: indicator pill (56×32) + label + count badge. Selected state is
`secondary-container` on the pill with an emphasized label; pressed narrows the
pill to 44dp and morphs it to `corner-medium`. One tab stop with arrow-key roving
focus (WAI-ARIA), `aria-current="page"` on the active destination. At large the
rail expands: the row becomes horizontal, the pill dissolves into a full-width
`corner-full` container, and the badge moves inline.

### 5.3 Floating toolbar
`surface-container-high` @ blur, elevation 3, `corner-full`, retreats downward on
scroll-down and returns on scroll-up. Contains a connected button group whose
members squash (`scaleX(.94)`) on press, a sort trigger, and a filter icon button
with an `error`-coloured count badge. `role="toolbar"` with a single tab stop and
arrow-key navigation.

### 5.4 FAB menu
Primary action ("Add media") as `primary` FAB; the "+" rotates 45° to "×" when
open — state without words. Three items stagger in on a default-spatial spring at
40ms intervals, close on outside click, Escape and selection, and support
Up/Down. Extended with a label only where there is room (large+).

### 5.5 Spotlight
The hero moment: `primary-container`, asymmetric radius (three corners at
`extra-large-increased`, one at `extra-extra-large`), `headline-large
--emphasized`, and two real actions — Resume/Open, and Shuffle, which reseeds the
shuffle and drops into immersive scroll. It picks the item with saved progress,
else the newest unseen, else the newest: it always has a reason to exist.

### 5.6 Media tile
The system `.m3e-tile` (shape morph on press, gradient scrim, corner badge, play
affordance) plus four product states: unseen (primary dot, ringed so it survives
a light photo), archived (desaturated), resume progress (3dp primary bar on the
bottom edge), and unavailable (the corner badge switches to the `error` role —
one badge slot, never two). Curated rails add a "why" label *under* the tile so
it never covers the media. Every tile carries a composed `aria-label`
("video by @tidefilm, posted Aug 19 2026, unseen").

### 5.7 Rails
Real M3 carousels. The first rail uses the **hero** layout (one large item plus a
sliver of the next — "look at this one"); the rest use **multi-browse** ("what
have I got"). Both are full-bleed so the strip reads as continuing past the
screen edge. Each rail has a header with a count, pointer-only arrows, a scroll-
extent indicator, keyboard paging (arrows/Home/End) and wheel translation. Which
rails exist, in what order, holding what, is decided by the curator — §8.

### 5.8 Refine sheet
Filter **chips**, not dropdowns: each chip states its constraint, shows selection
with a leading checkmark and `secondary-container`, and toggles in one press.
Filtering is instant, so the sheet stays open and its confirm button reports the
live result count ("Show 128 results", disabled at zero). Author, dates and
duration remain text fields, because they are values rather than choices. Active
filters surface in the app bar as removable input chips.

### 5.9 Settings
Personalisation leads, as M3 Expressive intends: theme, contrast, accent swatches
(painted with `seedPreview`, so the swatch shows the colour it will actually
produce), and colour character. Toggles are real `role="switch"` M3 switches with
keyboard parity and a handle that squishes on press — not styled checkboxes.

---

## 6 · Accessibility

- **Landmarks**: one `nav` exposed per window class, one `main`, `role="toolbar"`,
  labelled dialogs with `aria-modal` and focus traps.
- **Headings**: exactly one `h1` (the destination), `h2` per section.
- **Keyboard**: `/` search · `v` cycles layout · `f` refine · arrows page rails
  and step the viewer · Escape unwinds one layer at a time · roving focus in rail
  and toolbar · visible 3dp `secondary` focus ring on everything.
- **Announcements**: a polite live region reports result counts, layout changes
  and sort changes; errors go out assertively through the snackbar.
- **Targets**: 48dp minimum, with a "larger controls" setting that raises every
  control to it.
- **Motion**: OS `prefers-reduced-motion` *and* an in-app setting collapse every
  spring to 1ms; nothing that carries meaning is removed, only its travel.
- **Forced colours**: selection states switch to `Highlight`/`HighlightText`,
  tiles and the spotlight gain `CanvasText` borders.

---

## 7 · Traceability

| Decision | M3 Expressive rule |
|---|---|
| Destinations vs. view controls | Navigation components carry destinations; toolbars carry actions |
| Rail at medium, bar at compact, expanded rail at large | Canonical adaptive layouts by window size class |
| Two-line app bar collapsing on scroll | Flexible/large app bar with on-scroll behaviour |
| Connected button group with press squash | Button groups (new in M3E) |
| Floating toolbar that retreats on scroll | Toolbars (new in M3E; bottom app bar deprecated) |
| FAB menu replacing stacked actions | FAB menu (new in M3E, replaces the speed dial) |
| Hero + multi-browse carousels | Carousel (updated in M3E) |
| Pressed states morph squarer | Shape morphing / expanded shape scale |
| Emphasized type for hero and section titles | 15 emphasized styles added in M3E |
| Springs, spatial vs effects, never mixed | Motion physics system, expressive scheme |
| Swatches, accents, colour character | Dynamic colour and personalisation |
| Filter chips over dropdowns | Chips as the selection component |
| Indeterminate wave during import parse | Updated progress indicators |
| Curated, ranked, de-duplicated shelves (§8) | Not an M3 rule — M3 specifies the carousel, not what goes in it. The content strategy is ours; the presentation is the M3 carousel. |

---

## 8 · Curation: what Home actually shows

The rails were ten hard-coded predicates rendered in a fixed order. Every item
matched several of them, so the seven-item demo library produced **eight rails
holding twenty-eight tiles** — the same media, over and over, in the same order,
for ever. Nothing was ranked, nothing was personal, nothing changed.

`js/curator.js` replaces it with a four-stage pipeline. `library.js` goes back to
being what it claims to be: the media model, filters and sorts.

### 8.1 Pipeline

**1 · Profile.** Read behaviour out of the library itself: which accounts you
open (recency-weighted, so an open last week counts more than one last year),
what you opened last, recurring keywords across *posts* (not per media item, so
a gallery does not vote five times), and **capture sessions** — captures less
than six hours apart are one sitting, which is what makes "what I saved last
night" a real category.

**2 · Candidates.** Eighteen generators propose themselves, each with a pool, an
intrinsic priority, a per-item relevance function and a per-item explanation. A
generator returns nothing when its idea does not apply: no anniversaries today,
no "On this day"; fewer than eight likes-bearing items, no "Crowd favourites";
a small library, no shape shelves, because "portrait" is not a distinction until
there is enough media for it to be one.

**3 · Rank items.** `relevance·0.62 + quality·0.18 + unseen·0.12 + freshness·0.08`,
where quality is log-scaled engagement (a raw like count lets one viral post
drown everything). Selection inside a shelf is greedy with an author-diversity
decay (0.55 large / 0.75 otherwise per repeat), so one prolific account can no
longer own a rail.

**4 · Select shelves.** Greedy, and the important term is **novelty**:

```
score = priority × sizeScore × (floor + (1−floor)·novelty) × (0.55 + 0.45·relevance) × jitter
novelty = share of this shelf's visible items not already shown further up
```

Each chosen shelf marks its first fourteen items as spent — only what reaches
the screen counts — and every remaining candidate is re-scored. A shelf leaning
on items the page already used collapses in value. Repeats are penalised, never
banned (a hard ban empties the bottom of the page). On top of that: at most two
shelves per family, one shelf per subject (so "More from @x" and "Because you
opened @x" cannot both appear), a penalty for two same-family shelves in a row,
and intent shelves exempt from the size score — three videos you are halfway
through beat forty you have never opened.

### 8.2 The shelves

| Shelf | Family | Pri | Appears when |
|---|---|---|---|
| Continue watching | intent | 100 | video progress ≥3s and <95% done |
| New to you / Waiting for you | intent | 92 | anything unseen |
| On this day | time | 88 | posted on today's date in an earlier year |
| Just captured / From your last capture | time | 78 | last capture session, if it isn't the whole library |
| More from @account (×2) | author | 72/66 | accounts you open more than most |
| Because you opened @account | personal | 68 | similar to your last view (author, type, duration band, keyword overlap) |
| About "keyword" (×3) | topic | 62 | a word recurring in ≥3 posts |
| Rediscover | time | 60 | captured >30d ago, untouched since |
| Crowd favourites | signal | 56 | top 15% by likes at capture |
| Quick hits | format | 52 | motion under 15s |
| Settle in | format | 50 | video over 30s (3min on large libraries) |
| Photo sets | format | 46 | posts that carried ≥3 images |
| Loops | format | 42 | animated GIFs |
| Your @account collection | author | 44 | most prolific account, if not already an affinity shelf |
| Tall / Wide frames | format | 32/30 | medium+ libraries only |
| Needs attention | maintenance | 34 | captured without a playable source |
| Described media | signal | 26 → **64** | promoted when "always expose alt text" is on |
| Surprise me | chance | 22 | the closer — a different handful every day |

### 8.3 Adaptive and stable

Shelf count, repeat tolerance and diversity scale with the library: 2 shelves
under 12 items, 4 under 60, 6 under 300, 8 above. Below the threshold where
curation would be dishonest, Home falls back to the plain grid rather than
inventing shelves out of the same six items.

Everything is seeded by the **day number**, so the page is identical all day and
rotates tomorrow — browsing is not supposed to feel like a slot machine, but a
library that looks the same every morning stops being looked at.

### 8.4 Measured

Synthetic libraries, node harness:

| Library | Shelves | Unique items on screen | Avg appearances per item | Worst single-author share (thematic rails) | Time |
|---|---|---|---|---|---|
| 7 (demo) | 2 | 7 | 1.71 | 43% | 2ms |
| 45 | 4 | 38 | 1.21 | 14% | 4ms |
| 180 | 6 | 83 | 1.01 | 21% | 11ms |
| 2400 | 8 | 100 | **1.00** | 14–21% | 56ms |

Before: the demo library rendered 8 rails / 29 tiles for 7 items (≈4 appearances
each). After: 2 rails / 14 tiles including the spotlight. Results are memoised on
scope, filters, search, library size, day and spotlight item, and invalidated
whenever viewed/progress/archive state is written — those are curator inputs.

Edge cases verified: empty library, one item, items with no author/text/dates,
an all-archived library, and a single-account library all degrade without
throwing.

## 9 · Deliberately not done

- **Shape-morphing loading indicator** for the import parse. The system has
  `.m3e-loading`; the parse is usually under 100ms and a morphing glyph that
  flashes for four frames is worse than the linear wave now shown.
- **Vertical floating toolbar** in the viewer. The viewer's own bar already holds
  three controls; a second toolbar over someone's photograph is chrome for its
  own sake.
- **Per-destination sort memory.** Cheap to add, but it makes the sort control
  lie about its own state when you navigate. Wants a usability test first.
- **Split button for sort.** The lead half needs an action distinct from the
  menu; sort has none that isn't contrived.

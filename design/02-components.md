# 02 · Components

`shared/m3e/components.css` — 29 sections, ~1 570 lines, tokens only. No
component hard-codes a colour, radius or duration; every value resolves through
`var(--md-sys-*)`, which is what lets the whole UI re-theme at runtime from a
single seed.

**Standing rules for every component in this file**

1. Tokens only — no literal colours, radii or durations.
2. State layers are `::before` pseudo-elements at M3's opacities
   (hover 0.08, focus 0.10, pressed 0.10, dragged 0.16), never opacity on the
   element itself.
3. Spatial and effects springs are never mixed on one property.
4. Focus rings are always visible — never `outline: none` without a
   replacement.
5. Minimum 48 × 48 px hit area, regardless of painted size.
6. Colour is never the only carrier of meaning.

---

## 1. Inventory

M3 Expressive's 2025 release shipped 15 new or updated components. This project
adopts the ones that fit, and — importantly — leaves out the ones that don't.

### Adopted from the M3E 2025 set

| Component | Section | Where used | Why |
|---|---|---|---|
| **Button group** | 6 | Density toggle, popup transport pair | Connected controls that morph shape and width on press |
| **Split button** | 7 | Dashboard `Import ▾` | One primary action + a menu of variants, without a second full button |
| **FAB menu** | 8 | Dashboard compact FAB | Replaces the deprecated speed dial; large, contrasting items |
| **Toolbars** | 9 | Filter bar, detail actions | Floating toolbar replaces the deprecated bottom app bar |
| **Loading indicator** | 16 | — (available) | For sub-5 s waits, in place of a circular spinner |
| **Wavy progress** | 16 | Popup capture | Determinate/indeterminate work that must read as "alive" |
| **Vertical menus** | 20 | Sort, import, author menus | Nov-2025 refresh: rounded shapes, inset dividers, optional gap grouping |
| **Navigation rail** | 18 | Dashboard ≥600 px | Updated Expressive rail with FAB slot |
| **Icon buttons** | 5 | Throughout | Five sizes, four styles |
| **Common buttons** | 4 | Throughout | XS–XL sizes, each with its own pressed radius |
| **Extended FAB / FAB** | 8 | Compact import | — |
| **App bars** | 10 | Both surfaces | `data-scrolled` elevation change |

### Deliberately not used

- **Carousel** — the library is a list of text, not a gallery. A carousel would
  hide items behind a gesture for visual novelty.
- **Docked toolbar** — the dashboard already has a rail and a nav bar; a third
  persistent bar would be clutter.
- **Sliders** — nothing here is a continuous quantity.
- **Wavy *determinate* progress** — the capture genuinely doesn't know its total
  ahead of time. Showing a determinate bar would be a lie.

Restraint is part of applying a design system. Using all 15 because they exist
is how you get the incoherence this redesign is fixing.

---

## 2. Anatomy of the load-bearing components

### 2.1 Bookmark card `.bmk`

The single most repeated element in the product; everything about it is
deliberate.

```
┌─────────────────────────────────────────────┐
│ ▌ (avatar) Author Name  [TYPE]      Jul 15  │  ← identity row
│ ▌ @handle                                   │
│ ▌                                           │
│ ▌ Post text, clamped to 6 lines             │  ← content
│ ▌ (3 at compact density)                    │
│ ▌                                           │
│ ▌ ♥ 1.3K ⇄ 412 💬 86 👁 142K [MEDIA] [LINK] │  ← metrics + affordances
│ ▌ Captured Jul 16, 2026      [tag][arch][↗] │  ← provenance + row actions
└─────────────────────────────────────────────┘
  ↑ 4px spine, selected only
```

| Property | Default | Selected | Archived |
|---|---|---|---|
| radius | `large-increased` | `extra-large` | `medium` |
| outline | none | 1 px `primary` | none |
| spine | none | 4 px `primary` | none |
| opacity | 1 | 1 | 0.72 |

Row actions appear on hover and focus-within, and are always in the DOM so
keyboard and screen-reader users reach them identically — they are not
`display: none` until hover, which is a common way to make a UI
keyboard-inaccessible by accident.

Text is clamped rather than truncated mid-word, and the full text is one click
away in the detail view, so the clamp never loses information.

### 2.2 Hero band

The only element allowed display type and the only one allowed
`extra-extra-large` radius. It answers "how big is my library, and what am I
looking at right now" before anything else.

At compact it sheds the prose caption, drops the numeral to display-small, and
turns the stat grid into a single horizontally-scrolling row — because on a
390 × 844 phone the original layout consumed the entire fold and pushed every
bookmark below it. A summary that hides the thing it summarises is an inverted
hierarchy. After the fix, a full card is visible without scrolling.

### 2.3 Filter bar

A floating toolbar of chips. Below 600 px it scrolls horizontally with a
scroll-driven edge fade (`animation-timeline: scroll(self inline)`), so the
mask only appears when the row actually overflows. From 600 px up **it wraps
instead** — horizontal scrolling on a wide window hides controls behind a
gesture for no reason, and the sort chip was being clipped by the fade.

### 2.4 Detail surface

One HTML builder, two presentations:

- **≥1200 px** — a persistent third pane. No scrim, no focus trap: it is part
  of the page, and trapping focus in an always-visible region is hostile.
- **<1200 px** — a modal bottom sheet with scrim, focus trap and Escape.

`detailHtml(item, { ownHeader })` takes a flag because the sheet already
provides a title bar and close button. Without it the sheet rendered the author
name twice and showed two close buttons — caught in screenshot review, fixed by
making the header conditional rather than by duplicating the builder.

### 2.5 Popup status card

Status is carried by **three redundant channels**: container colour, dot shape,
and a word.

| Status | Container | Dot | Word |
|---|---|---|---|
| idle | `surfaceContainer` | circle | Idle |
| capturing | `primaryContainer` | circle, breathing | Capturing |
| paused | `tertiaryContainer` | **square** | Paused |
| completed | `secondaryContainer` | circle | Completed |
| stopped (error) | `errorContainer` | **rotated square** | Stopped |

The detail line prefers a concrete stop reason over a generic one — "Rate
limited by X. Wait a few minutes before retrying." rather than "Stopped
(error)". An error message that doesn't say what to do next is decoration.

### 2.6 Wavy progress — an implementation note worth keeping

The wavy indicator is drawn with an SVG `<pattern>` tiled at its true 32 × 10
size. Two earlier approaches both failed, and both failed *silently*:

1. **One wide `viewBox` with `preserveAspectRatio="none"`** — scales x and y
   unevenly, distorting a round-capped stroke into ellipses.
2. **A repeating CSS `mask-image`** — rasterises at the wrong scale inside a
   composited layer (any ancestor with a transition is enough), collapsing the
   wave into blobs. Computed styles still read back correct, so it is invisible
   in devtools; it was only caught by screenshotting the element.

A `<pattern>` is resolved by the SVG renderer at paint time and survives both.
The stroke uses `currentColor`, so the wave inherits whatever container role it
sits on.

---

## 3. States

Every interactive component implements the full M3 state list: enabled, hover,
focus, pressed, dragged, disabled, plus selected where applicable.

State layers are `::before` overlays using pre-computed blends from
`M3EColor.blend()`, so a state layer over a tonal container produces a real
opaque colour rather than a semi-transparent stack that breaks over gradients.

Two corrections made during review:

- **Disabled text buttons** were growing a solid container when disabled — the
  lowest-emphasis control in a view becoming the most visually solid the moment
  it turns off. Per M3, only the label dims.
- **`[hidden]`** now beats component `display` rules. Without
  `[hidden] { display: none !important }`, any component whose base class sets
  `display` silently ignored the attribute — and the attribute is how the app
  tells both the renderer and assistive tech "not applicable right now".

---

## 4. Theming API

```js
const theme = M3ETheme.createController({
  seed: "#5B4CF5", variant: "vibrant", contrast: "standard",
  scheme: "system", density: "comfortable", reducedMotion: false,
});

theme.set({ variant: "expressive" });   // repaints every token
theme.settings                          // current settings object
theme.current                           // the built scheme
theme.subscribe(fn)                     // observe changes

M3ETheme.seedPreview(hex, settings)     // { primary, onPrimary } a seed WILL produce
M3ETheme.resolveDark(settings)          // 'system' → actual boolean
```

The controller subscribes to `prefers-color-scheme`, `prefers-reduced-motion`
and `prefers-contrast`, so a user changing an OS setting sees the app follow
without a reload.

`M3EColor.DEFAULT_SEED` / `DEFAULT_VARIANT` live in `color.js`, not `theme.js`,
because the extension's service worker needs the brand colour to tint the
toolbar badge and cannot import anything that touches the DOM.

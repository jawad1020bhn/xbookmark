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

---

## 5. Media

Most bookmarks in a real X library are photo or video posts, so media is not a
detail of the card — for many rows it *is* the card. It gets its own section
because the decisions here are the ones most likely to be undone by someone who
doesn't know why they were made.

### 5.1 The grid

The card reproduces X's own arrangement, because that is the shape users already
associate with a post and any other layout makes a saved post look unfamiliar:

| Items | Layout |
| --- | --- |
| 1 | Full width, **at the media's own aspect ratio**, capped at 62vh |
| 2 | Two equal columns, 16:9 overall |
| 3 | One full-height leading cell, two stacked beside it, 16:9 overall |
| 4 | 2×2, 16:9 overall |
| 5+ | First four, with `+N` on the last cell |

Cells are separated by 3px and clipped by a single `large` radius on the
container, so the group reads as one object rather than four.

**Every cell is sized by ratio, never by pixel height.** A single photo carries
its intrinsic ratio through a `--_ar` custom property set from the captured
`width`/`height`, and images additionally carry real `width`/`height`
attributes. The space is therefore correct before any bytes arrive, and the list
does not reflow as it loads — a media-heavy feed that jumps while scrolling is
unusable, and cumulative layout shift is the usual cause.

Multi-item cells crop with `object-fit: cover` to keep the grid regular; a lone
item uses `contain` so nothing is cut off when there is no grid to keep regular.

### 5.2 Playback

**Cards never mount a `<video>`.** Two hundred bookmarks that are mostly video
would mean two hundred media elements, each with a decode pipeline and network
activity. Cells render as poster images and a real player is swapped in only on
activation. This is the single most important performance decision on the
surface, and it is the one to check first if the library ever feels slow.

Playing a thumbnail does **not** open the detail view. The two actions would
otherwise fight and the player would be destroyed as it mounted.

**One video at a time.** `M3EMedia` keeps a single stop function; starting any
video stops the previous one, and opening or closing the detail pane stops
everything. Concurrent audio is never what anyone wants and is easy to trigger
in a list.

Controls are the browser's own. Native `<video controls>` is already
keyboard-complete, screen-reader labelled, and brings picture-in-picture and
fullscreen for free; a bespoke control bar is a large amount of code whose best
possible outcome is parity with it. The design system supplies the frame —
shape, surface, focus ring — and nothing else.

### 5.3 HLS, and why there is no player library

X publishes video two ways: an adaptive HLS playlist, and fixed-bitrate MP4
variants. Only Safari plays HLS natively; Chrome and Firefox need hls.js, which
is larger than this entire application and would be the first runtime dependency
in a deliberately zero-dependency, build-free repo. The MV3 content security
policy also forbids loading it from a CDN, so it would have to be vendored.

**The resolution: prefer the MP4, which X publishes for essentially every video
and which plays natively everywhere.** Where several variants exist the
highest-bitrate one wins. HLS is used only where the browser can play it
unaided. That covers the real corpus with zero bytes of dependency.

For the residual case — a video published *only* as a stream — the UI says so
and offers "Watch on X" over the poster frame. An honest dead end beats a play
button that leads to a black rectangle.

> **Detection note.** `canPlayType` cannot be trusted for this and the code says
> so at the point of use. Chromium answers `"maybe"` to both HLS mime types and
> then fails to play a playlist; this was found by probing a real build, not
> assumed. Blink is therefore excluded explicitly. `tests/media.test.mjs` pins
> that behaviour for Chrome, Edge and Opera user agents.

### 5.4 Bandwidth

Card posters are requested from X's CDN as `?format=webp&name=small` and the
detail view asks for `name=medium`; only `pbs.twimg.com` URLs are rewritten and
everything else passes through untouched. On a library that is mostly images
this is the difference between a few hundred kilobytes and several megabytes per
screen.

### 5.5 Sensitive media

Media captured as sensitive renders blurred behind a "tap to view" scrim, and
the first activation only reveals it — watching is a second, deliberate action.
Sensitive media is never autoplayed.

### 5.6 Accessibility

- Playable cells are real `<button>`s, focusable and activated by Enter or
  Space, labelled `Play video (0:15)` / `Play GIF` rather than the filename.
  Non-interactive cells are plain `<div>`s and stay out of the tab order.
- Captured alt text becomes the image's `alt` and the video's `aria-label`; it
  is also shown in the detail view's figcaption, where it is useful to everyone.
- Duration badges use tabular numerals so they don't jitter.
- GIFs are muted and looped, as their source medium implies; nothing else
  autoplays, which keeps `prefers-reduced-motion` users from being ambushed.

---

## 6. Lightbox

A large share of saved X media is screenshots of text — threads, code, charts,
receipts. At card size these are unreadable, so full-screen viewing with zoom
is not a flourish; it is the only way the content is legible at all.

**Anatomy.** Top bar (counter, copy link, open on X, close) · stage · previous
and next · bottom bar (caption, dots). Chrome is white-on-scrim rather than
themed surfaces: the media is the subject and the frame should recede.

**Backdrop at 97%.** The dialog scrim is 40%; this is not a dialog. At the 92%
I first tried, the app chrome was still legible behind the photo and competed
with it. The residual 3% plus a 4px blur keeps it from reading as a flat void.

**Zoom** is native overflow scrolling, not a JS drag-pan: the image is allowed
to exceed the stage and the stage scrolls. That inherits momentum, trackpad
gestures, keyboard scrolling and touch panning, all of which a hand-rolled pan
handler gets subtly wrong. Clicking zooms toward the clicked point, so the
pixel under the cursor stays under the cursor. Zoom targets `max(natural size,
2.5× displayed)` — zooming only to natural size does nothing for an image
smaller than the stage, which is most screenshots on a desktop monitor, i.e.
precisely the case zoom exists for.

**Keyboard.** `←` `→` navigate, `Home`/`End` jump, `z` zooms (centred, since
there is no pointer to zoom toward), `Escape` closes. Keys are bound on the
document rather than the viewer root: clicking a non-focusable `<img>` moves
focus to `<body>`, and a root listener would then never fire — Escape appeared
dead after any click on the media itself.

**Layering.** `--md-sys-z-immersive: 1200`, above the snackbar. A toast
floating over a full-bleed photo is both illegible and unreachable. The first
attempt used a hand-picked `z-index: 60` and lost to the sticky chrome at 100 —
which is the argument for the z-scale existing at all.

**Below 600px** the arrows are hidden and swipe takes over, matching the
gesture X's own viewer uses. Vertical drag is left alone so a zoomed image can
still be panned.

**Playback** goes through the same `M3EMedia` single-player manager as the
grid, so an inline video stops when the viewer opens and cannot play behind it.

---

## 7. Capture banner

The dashboard and the extension used to be strangers: the extension captured
posts, and the only way to see them was to export a file from the popup and
import it by hand. Nothing ever told you there was anything to fetch.

The banner appears **only** when the dashboard runs inside the extension *and*
there is something to report — a run in progress, posts waiting, or failures.
A permanent "connected" badge would be noise directly above the library.

| State | Tone | Says |
| --- | --- | --- |
| Capturing | primary container, pulsing dot | "Capturing from X…" + live count |
| Posts waiting | tertiary container | "N new posts ready to import" + import button |
| Stopped / paused | secondary container, square dot | why it stopped |
| Failed | error container, square dot | plus "What failed?" |

Tone is carried by container colour **and** dot shape (circle = running,
square = stopped), so state survives greyscale and colour-blind viewing — the
same rule the popup's status card follows. The pulse respects
`prefers-reduced-motion`.

**Dead letters.** The scraper has always recorded posts it couldn't parse to
`xDeadLetters`, and until now the only code that touched that key was the reset
button that deleted it — silent partial data loss, where the user believes the
capture was complete. "What failed?" lists them with the reason and a link to
each post.

### 7.1 Why the dashboard is mirrored into the extension

The dashboard has no `chrome.*` access when served from `file://` or
`localhost`. Three ways to bridge that:

1. **A content script relaying `postMessage`** — needs host permissions for
   whatever origin the dashboard is served from, which is unknowable in
   advance. A permission covering "every site you visit" is not a reasonable
   ask for a personal archiving tool.
2. **`externally_connectable`** — same problem: it needs a fixed origin list.
3. **Run the page inside the extension**, where `chrome.storage` simply
   exists. **No new permission at all.**

Hence `tools/sync-shared.mjs` also mirrors `dashboard/` into
`extension/dashboard/`, skipping the sample library — 1.3 MB of demo media has
no business shipping to users. Because every shared asset is referenced as
`../shared/…`, the same paths resolve from both locations and the mirror is a
straight copy. Served standalone, `XBridge.available` is false, every method is
a safe no-op, and the surface behaves exactly as before.

> **Permission note.** Reusing an already-open library tab uses
> `runtime.getContexts()`, **not** `tabs.query({url})`. Filtering a tab query
> by URL requires the `tabs` permission, which Chrome surfaces at install as
> *"read your browsing history"* — an absurd prompt for a tool whose entire
> pitch is that your data never leaves your machine. `getContexts` only ever
> reports the extension's own pages. `tests/integration.test.mjs` pins both
> the permission set and the absence of a URL-filtered query.

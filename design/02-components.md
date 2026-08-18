# 02 · Components

`shared/m3e/components.css` — 33 sections, ~1 900 lines, tokens only. No
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
| **Carousel** | 31 | Every rail, all three layouts | *The* M3E component for browsing media. See §2.1 |
| **Button group** | 6 | View switch, popup transport pair | Connected controls that morph shape and width on press |
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

- **Docked toolbar** — the compact surface already floats one toolbar; a second
  persistent bar would eat the room this redesign exists to reclaim.
- **Wavy *determinate* progress** — the capture genuinely doesn't know its total
  ahead of time. Showing a determinate bar would be a lie.
- **Split button** — the previous build's `Import ▾` split button is gone.
  The rail FAB and compact toolbar now open a dedicated Data Vault. Import,
  export, restore, backup and destructive actions stay together there instead
  of leaking into visual settings. A split button whose menu holds *four*
  actions is a menu wearing a costume.

> **Reversal worth flagging.** The previous revision of this document listed
> *Carousel* under "deliberately not used", on the grounds that "the library is
> a list of text, not a gallery". That premise was wrong, and it was the
> premise the entire old UI rested on. A bookmark archive from X is
> overwhelmingly photos and video. The carousel is now the backbone of the
> product.

Restraint is part of applying a design system. Using all 15 because they exist
is how you get the incoherence this redesign is fixing.

---

## 2. Anatomy of the load-bearing components

### 2.1 Carousel `.m3e-carousel`

The backbone of the product. Three of M3's four carousel layouts are
implemented, because they answer three different questions.

| Layout | Sizing | Says | Used by |
|---|---|---|---|
| `--hero` | Fixed width (one item + a peek), fixed band height | *"Look at this one."* | Video & GIFs; small libraries |
| `--multi` | Fixed height, **width derived from the item's ratio** | *"What have I got?"* | Every grouped rail |
| `--uncontained` | Natural size, runs past the edge | *"Keep going."* | Everything rail |

**The peek is the component.** M3's defining carousel behaviour is that the
item entering the viewport is partially visible, so the rail reads as a
physical strip continuing past the screen edge rather than a row that has been
abruptly clipped. That is produced entirely by layout — `scroll-snap` plus the
sizing above — with no scroll listener and no per-frame JS.

**`--bleed`** pulls the strip out to the window edge with a negative margin and
restores the first item's alignment with `padding-inline`. A rail that stops at
the content gutter looks like it has ended; one that runs off the edge looks
like it continues.

**The scrollbar is suppressed** and replaced by explicit affordances: arrow
buttons on pointer devices, an extent indicator under the rail, and the
gesture itself on touch. A visible bar under each of eight rails is noise, and
it is never the control anyone reaches for.

**Behaviour** lives in `M3E.bindCarousel(scroller, { prev, next, progress })`:

- arrows page by 85 % of a viewport — not 100 %, so the item that was at the
  edge stays visible and gives the eye an anchor. Paging by the full width
  feels like a jump cut;
- arrows disable at each end, with 1 px of slack because sub-pixel layout means
  `scrollLeft` rarely reaches `max` exactly;
- `←` `→` `Home` `End` when the rail has focus — a horizontally scrolling
  region drivable only by wheel or swipe fails WCAG 2.1.1;
- a vertical wheel is translated to horizontal scroll, **but only while the
  rail still has room in that direction**. At either end the gesture is handed
  back to the page. Trapping it is the classic carousel scroll-jail;
- everything is rAF-coalesced and `ResizeObserver`-driven; a page can hold a
  dozen rails.

### 2.2 Media tile `.m3e-tile`

The atom of the product. One photo or one video, sized by its own aspect ratio,
with every piece of metadata layered **on top of** it rather than beside it.

```
┌───────────────────────────────┐
│                        [0:15] │  ← badge: duration / GIF / n-of-m
│                               │
│              ▶                │  ← play affordance, motion only
│                               │
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │  ← gradient scrim
│ Engineer Daily                │
│ Jul 9 · 2.1K likes            │
└───────────────────────────────┘
```

**Why overlay, not caption.** In a browsing surface the media is the content
and the metadata is the label. Giving the label its own row halves the number
of items on screen and doubles the scroll distance to see the same library.

**Why a gradient, not a bar.** A flat bar is a rectangle of chrome over the
bottom of a photograph. The gradient is weighted to the bottom third with two
stops rather than a linear ramp — a straight `linear-gradient` reads as a grey
haze across the middle of the picture.

| Property | Default | Hover | Pressed | Selected |
|---|---|---|---|---|
| radius | `large-increased` | — | `medium-increased` | — |
| scale | 1 | 1.012 | 0.985 | 1 |
| elevation | 0 | level 2 | — | 0 |
| outline | none | none | none | 3 px `primary` |

Hover lifts by 1.2 %, not 5 %. This is a wall of images; anything more and the
grid ripples as the pointer crosses it.

**Colour is never applied to the media.** No tint, no saturation shift, no
duotone on hover. Everything in the centre of the screen is the user's content,
and expressive treatment applied to someone else's photograph is vandalism.

Every tile is a real `<button>` with a label of the form
`Play video by Engineer Daily: <alt text>` — action first, because a
screen-reader user decides whether to keep listening during the first few
words.

### 2.3 Filter bar

Three chips fit without horizontal scrolling at every window class: **Media
type**, **Sort**, and **More**. Selected chips change **shape** as well as colour
— fully rounded when on, partly rounded when off — so state survives greyscale
and colour-blind viewing.

Media type progressively discloses All / Photos / Videos / GIFs as a
single-choice menu. More holds author, dates and engagement thresholds, plus a
contextual clear action. Shuffle stays in Sort rather than becoming a fourth
standalone control.

**Refine uses visual distributions, not number fields.** Likes and reposts are
shown as 28-bin logarithmic histograms with an overlaid range input. Dragging a
threshold dims excluded bars and updates a formatted value, so users explore
their actual library instead of guessing a number.

### 2.4 Inspector

The post *behind* the selected media. Deliberately not called a detail view:
the media is the main event and this is context.

One HTML builder, two presentations:

- **≥ 1024 px** — a persistent third column that pushes and reflows the feed.
  No scrim or focus trap: it is part of the page.
- **< 1024 px** — a bottom sheet (compact) or side sheet (medium) with scrim,
  focus trap and Escape.

It holds the author, text, metrics, sibling media and recovery actions. A media
stream that cannot play stays visually quiet in the grid; the inspector explains
why and offers **Open on X**, **Find on Wayback**, and reversible **Remove from
library**. It holds **no** tag editor, **no** note field and **no** media grid —
the media is already on screen, and the filing tools are gone.

The sheet presentation hides the inspector's own close button with CSS rather
than branching the builder, because the sheet header already provides one. The
previous build passed an `ownHeader` flag through the builder for this, which
meant two code paths and, for a while, two visible close buttons.

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

Media is not a detail of this product; it *is* the product. The full pipeline —
capture, normalisation, source selection, playback and failure — has its own
document, **`06-media-and-playback.md`**, because it crosses every layer of the
project. What follows is only the presentation side.

### 5.1 There is no in-post collage any more

The previous build reproduced X's 1/2/3/4 in-post arrangement inside each card.
That made sense when the unit was a post. It does not now: a post with four
photos is **four things to browse**, not one row with a 2×2 squeezed into it.
The four appear as four independent tiles, each addressable, each openable at
full size, each with its own place in the sort order.

What is retained from that arrangement is the `n/m` badge, so an item that came
from a multi-photo post still says so, and the inspector lists its siblings.

### 5.2 Sizing and virtualisation

**Every tile is sized from its captured ratio.** The virtual grid groups items
into justified left-to-right rows, computes all rectangles in memory, then
mounts only the rows near the viewport. The result keeps sort order, never
crops media, and caps mounted cells below 200 even for very large libraries.
Images still carry intrinsic `width`/`height`, so mounted rows do not shift as
bytes arrive.

Where cropping is and is not permitted is tabulated in
`03-layout-and-navigation.md` §3. The short version: only the hero rail crops,
and only because a non-cropping view of the same item is always one tap away.

### 5.3 Bandwidth

Tiles request `?format=webp&name=small` from X's CDN; the viewer asks for
`large`. Only `pbs.twimg.com` URLs are rewritten and everything else passes
through untouched. On a library that is mostly images this is the difference
between a few hundred kilobytes and several megabytes per screen.

Video applies the same idea to the mp4 ladder: `playableSource(media, {width})`
picks the smallest rung that covers the rendered size. See
`06-media-and-playback.md` §3.1.

### 5.4 Accessibility

- Tiles are real `<button>`s, activated by Enter or Space, labelled with the
  action, the medium, the author and the caption — in that order.
- Captured alt text becomes the image's `alt`. Where there is none, the post's
  own text is used, truncated: it usually describes the picture better than any
  generic string, and "image" describes nothing.
- Duration badges use tabular numerals so they don't jitter.
- GIFs loop silently; everything else autoplays only when both the setting and
  `prefers-reduced-motion` allow it.

---

## 6. Lightbox

A large share of saved X media is screenshots of text — threads, code, charts,
receipts. At card size these are unreadable, so full-screen viewing with zoom
is not a flourish; it is the only way the content is legible at all.

**It traverses the whole library.** This is the change that turns the viewer
from a per-post gallery into a browser: it is handed the entire current index,
not the handful of attachments inside one post. Open anything, then use the
visible navigation, filmstrip or a swipe to move across posts, authors and
years in the current sort order. `contextAt(i)`
relabels the top bar as you cross a post boundary.

**Anatomy.** Top bar (author, date, counter, copy link, open on X, close) ·
stage · previous and next · bottom bar (caption, filmstrip). Chrome is
white-on-scrim rather than themed surfaces: the media is the subject and the
frame should recede.

**Filmstrip, not dots.** The old dot row did not survive the change above:
forty dots is a texture, not a control, and a library-wide viewer can hold
thousands. A strip of thumbnails scales, and it doubles as a preview of what is
coming — which dots never were. Only a window of ±12 items around the current
index is materialised; building an `<img>` for every item to decorate a bottom
bar would cost more than the photograph being looked at.

**Backdrop at 97%.** The dialog scrim is 40%; this is not a dialog. At the 92%
I first tried, the app chrome was still legible behind the photo and competed
with it. The residual 3% plus a 4px blur keeps it from reading as a flat void.

**Gestures.** A horizontal one-finger swipe navigates. Pinching with two
fingers zooms around the gesture midpoint, and one finger pans while zoomed.
Desktop click-to-zoom still targets `max(natural size, 2.5× displayed)` and
uses the stage's native overflow.

**Directional prefetch.** After each navigation the next three items in that
direction are warmed: high-resolution images decode through `Image`, HLS
playlists are fetched, and the first 64 KiB range of MP4 sources enters the
browser cache. No hidden video elements or extra decoders are created.

**Layering.** `--md-sys-z-immersive: 1200`, above the snackbar. A toast
floating over a full-bleed photo is both illegible and unreachable. The first
attempt used a hand-picked `z-index: 60` and lost to the sticky chrome at 100 —
which is the argument for the z-scale existing at all.

**Below 600px** the arrows are hidden and swipe takes over, matching the
gesture X's own viewer uses. The same pointer gesture layer owns pinch and pan.

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

---

## 8. Sorting

Seventeen sorts in five groups. The count is deliberate: a bookmark library is
a pile, and the only way to get value out of a pile is to be able to re-cut it
along whatever dimension you happen to care about today.

| Group | Sorts |
| --- | --- |
| **Time** | Newest · Oldest · Recently captured · Capture order |
| **Reach** | Most liked · Most reposted · Most replied · Most viewed · Best engagement |
| **Content** | Author A–Z · Most text · Least text |
| **Media** | Motion first · Longest video · Widest first |
| **Chance** | Shuffle · Forgotten first |

The **Media** group replaces the old **Yours** group, and the swap is the
clearest single illustration of what changed in this redesign. *Yours* held
"Recently tagged" and "Least touched" — sorts over filing metadata that the
user had to generate by hand. *Media* holds sorts that only become expressible
once the unit is a media item: motion before stills, by running time, by
aspect ratio. The first set asked the user to do work so the product could sort
them; the second sorts what is already there.

**Grouped, not flat.** Past roughly eight items an ungrouped menu stops being
scannable. M3E's November 2025 menu guidance permits gaps and grouping to
categorise related actions, which is exactly this case. Items are compacted via
`.m3e-menu--sort` rather than in the shared component — no other menu in either
surface is anywhere near this long.

**Best engagement**, not raw likes. A post with 400 likes on 5k views did
something a post with 2k likes on 900k views did not; raw counts mostly re-rank
by how famous the author is. Replies are weighted double, since replying costs
more than liking. Posts captured without view data fall back to their like
count so they still rank somewhere sensible.

**Most viewed** finally uses `view_count_at_capture`, which the scraper has
always captured and nothing ever read.

### 8.1 Shuffle

A bookmark library sorted by recency forever means the oldest 90% is never seen
again. Shuffle is the cheapest possible fix for that, and **Forgotten first**
is the pointed version: a weighted draw favouring media you have never opened, biased towards older
posts. It is still random — two runs differ — but it
digs where the value is buried. The weighting is applied *before* the jitter so
randomness still dominates; otherwise it stops being a shuffle and becomes just
another deterministic sort.

**The hard requirement is that a shuffle be random between sessions and
perfectly stable within one.** If the order were redrawn on every render,
opening an item or changing a filter would reshuffle the list under the reader's
cursor and the tile they were aiming at would move as they clicked.

So the order is a pure function of a seed:

- `hashSeed` (xmur3) + `rng` (mulberry32) — about fifteen lines, no dependency.
- Each entry's score is `rng(hash(entryId + ":" + seed))`, where `entryId` is
  `<tweet_id>:<position>`. Scores derive from the **entry**, not from the
  array, so filtering keeps survivors in the same relative order instead of
  re-dealing them — and the two photos of one post shuffle independently,
  which is correct now that they are two things.
- Scores are precomputed into a `Map` before sorting. A comparator runs
  O(n log n) times; hashing inside it would make a large library crawl.
- The seed travels in the URL, so a copied link reproduces the exact order the
  sender saw — the same promise every other filter in this app makes.

Re-dealing stays inside the sorting model: re-pick Shuffle in the Sort menu.
There is no standalone Shuffle chip or global shortcut competing with filters.
The list changes only after an explicit menu choice.

> **Two menu bugs this exposed.** Both predate the feature and were invisible
> with seven options. (1) The capture-phase scroll listener that closes a menu
> when the page moves also fired for scrolling *inside* the menu, so reaching a
> lower item closed it. (2) Overflow clamping adjusted the top edge but let a
> tall menu run off the bottom of the window, rendering items outside the
> viewport where no scroll could reach them. Also fixed: clicking the sort chip
> while its menu was open stacked a second copy instead of toggling.

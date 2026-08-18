# 05 · Design Critique

A senior review of what was wrong, what changed, what each change traces to in
the M3 Expressive guidelines, and what is still open. Written to be argued
with.

---

## Part 1 — Diagnosis of the previous UI

The brief said the existing UI was built by a junior developer and lacked
cohesion, hierarchy and modern design language. That is accurate, but not
specific enough to design against. The concrete failures:

### 1.1 Two colour systems that disagreed

`dashboard/app.js` and `extension/popup.js` each contained a **separate,
incompatible OKLCH engine** — about 130 lines apiece, with different matrices,
different tone stops, and different role mappings. `popup.js` seeded from
`#69b8ff` in dark and `#0f62fe` in light; the dashboard used something else
again.

The consequence was not just drift. It was that **the same product had two
different brand colours depending on which window you were in**, and neither
was verified for contrast. One engine even contained a transposed matrix
coefficient (`0.6299713497` vs `0.6299813497`) — a typo that had no visible
symptom, which is exactly how colour bugs survive.

*Cost:* the two surfaces did not read as one product.

### 1.2 Emphasis inflation

Cards used six competing weights, several accent colours, and drop shadows on
resting elements. Everything was emphasised, so nothing was. Scanning a list
required reading every card, because no visual property reliably distinguished
"author" from "metric" from "timestamp".

*Cost:* the primary task — scanning a list — was the slowest thing in the app.

### 1.3 No adaptive strategy

One layout, stretched. No window classes, no rail, no list-detail. A 1920 px
monitor got the same single column as a phone, with a max-width and a lot of
empty space. The detail view was a drawer at every size, so desktop users
opened and dismissed a modal for every post they wanted to read.

*Cost:* on the surface where users spend the most time, the layout did the
least work.

### 1.4 Motion without a model

Transitions were ad-hoc durations with ad-hoc easings, including a genuine
oddity: the popup progress bar animated with
`width ${Math.random() * 3000 + 500}ms` — a **random duration on every state
render**. Progress that moves at a random speed is worse than no progress
indicator, because it actively misinforms.

*Cost:* the interface felt unpredictable, which for a tool driving your
logged-in account is the wrong feeling.

### 1.5 Accessibility left to chance

No verified contrast, no reduced-motion handling, no forced-colours support,
focus styling removed in places, colour as the sole state signal.

---

## Part 2 — What changed, and what it traces to

Every entry cites the M3 Expressive guideline it derives from.

### 2.1 One colour system → `shared/m3e/color.js`

*Traces to:* M3 **dynamic colour** — seed → tonal palettes → semantic roles;
light/dark from the same palettes.

Both surfaces now build from one engine: CIE-LCh tonal palettes with
binary-search gamut clipping, four scheme variants, three contrast levels, and
role→tone tables per level. 2 160 text-pair checks pass at ≥4.5:1.

**Deviation, stated plainly:** M3 specifies HCT; there is no browser HCT and no
dependency-free port worth vendoring, so this uses CIE-LCh, which shares the
L\* axis. Tone means the same thing, so the role→tone tables and their contrast
relationships transfer — verified exhaustively. Chroma does *not* transfer: LAB
over-states colourfulness near white and black, so M3's published neutral
chroma figures produced visibly pink-grey surfaces. Neutral chroma is tuned
down per variant (documented in `01-foundations.md` §1.2 and in the source).
This is a deviation in *implementation*, not in model.

### 2.2 Emphasis rationed to 80/20

*Traces to:* M3 Expressive's **emphasized type scale** and Google's explicit
80 % standard / 20 % expressive guidance.

Emphasised styles are a modifier, used only on hero units, section headers,
card author names, dialog titles, popup status and primary CTAs. Display size
is capped at **one instance per screen**. Body copy, metadata and captions are
never emphasised.

### 2.3 Shape promoted to a state channel

*Traces to:* M3 Expressive **shape scale** and shape-morphing guidance.

Card radius encodes selection (20 → 28) and archived state (20 → 12); the popup
status dot changes shape per capture state; every button squares off on press
and springs back. Because shape is redundant with colour, all of it survives
greyscale and forced-colours mode.

### 2.4 Real adaptive layout

*Traces to:* M3 **adaptive layout** window classes and the list-detail
canonical layout.

Five window classes with genuinely different navigation and detail models — the
1200 px boundary switches the detail view from modal to persistent, which is a
change of interaction model, not of width.

### 2.5 Motion given a physics model

*Traces to:* M3 Expressive **motion physics**, spatial vs effects springs.

Six spring tokens; spatial springs (with overshoot) only for position, size and
radius, effects springs (no overshoot) only for colour and opacity, never
mixed. Speed selected by component scale. The random-duration progress bar is
gone, replaced by a wavy indicator that honestly represents indeterminate work.

### 2.6 Accessibility as a build constraint

*Traces to:* M3 **accessibility** guidance; WCAG 2.2 AA.

Ten automated design-system tests, covering contrast across the whole
personalisation space, control-boundary contrast, seed distinctness, contrast
monotonicity, mirror freshness, asset existence and token validity.

---

## Part 3 — Decisions I'd expect to be challenged

Four places where I deviated from the obvious reading of the brief. Each is a
judgement call, and each is reversible.

### 3.1 The default variant is `vibrant`, not `expressive`

The brief said "use M3 Expressive". The M3 `expressive` *scheme variant*
rotates the primary hue **+240°** — pick violet, get teal.

On a phone home screen that is delightful: the system surprised you. In a tool
where the user picks a swatch from a grid, it is a bug — you tapped violet and
the app turned teal. I judged this to fall under the brief's own constraint,
*do not sacrifice usability for expressiveness*.

The variant is one tap away, labelled **Expressive**. Every other Expressive
mechanism is on by default. If the intent was specifically the hue-rotated
variant as default, this is a one-line change in `theme.js`.

### 3.2 The extension ships a committed copy of `shared/`

Duplicated files in a repo are a smell. But a Chrome extension cannot reference
anything above its root, and the alternatives were worse: forking the design
system (guaranteed drift) or moving the manifest to the repo root (shipping the
dashboard, tests and `.git` inside the extension).

The mitigation is that the copy is generated, banner-marked
`AUTO-GENERATED — do not edit`, and **tested** — `tools/sync-shared.mjs --check`
runs in the suite, so it cannot silently drift. The test caught a stale mirror
during this very session.

### 3.3 A 143 kB font is bundled

Self-hosting Roboto Flex costs 143 kB across two subsets. The alternative — the
Google Fonts CDN — is free on the dashboard and **impossible** in the popup,
because MV3's CSP forbids remote resources. That would mean the two surfaces of
one product render in different typefaces, which defeats the point of a shared
design system. The bundle also makes the dashboard work offline, which suits a
tool whose premise is local data.

The subset is minimal on purpose: only the `wght` and `opsz` axes, not all 15.

### 3.4 The seed list changed

"Graphite" was removed and "Fern" added. Not an aesthetic preference: because
every variant re-chromas the seed to a fixed target, only hue survives, and
Graphite (hue 268) produced a **byte-identical scheme** to Signal blue (hue
268). Two identical swatches in a picker look like a bug. A desaturated UI is
still available — it is the **Neutral** colour style, which is the correct home
for that choice because it applies to any hue.

---

## Part 4 — Defects found by looking, not by reasoning

Everything below was invisible in the code and obvious in a screenshot. Worth
recording because it is the argument for rendering your work.

| # | Defect | Cause | Fix |
|---|---|---|---|
| 1 | Whole UI had a rosé cast | LAB over-states chroma near white | Neutral chroma tuned per variant |
| 2 | `Refine` chip showed a `0` badge | `[hidden]` lost to a component `display` rule | `[hidden] { display: none !important }` |
| 3 | Sort chip clipped | Edge-fade mask applied even when not overflowing | Scroll-driven mask; wrap ≥600 px |
| 4 | Teal UI from a violet seed | `expressive` variant's +240° rotation as default | Default `vibrant`; swatches preview the real result |
| 5 | Two identical theme swatches | Two seeds sharing hue 268 | Seed list re-spaced; regression test added |
| 6 | Wavy progress rendered as blobs | CSS mask mis-rasterised in a composited layer | SVG `<pattern>` |
| 7 | Hero consumed the entire fold on mobile | No compact treatment | Caption dropped, numeral reduced, stats scroll |
| 8 | FAB covered the last card | Bottom padding accounted for the nav bar only | 168 px reserve |
| 9 | Detail sheet showed the author twice, with two close buttons | One HTML builder for two hosts | `detailHtml(item, { ownHeader })` |
| 10 | Theme toggle appeared to do nothing on first press | Cycled system → light → dark | Flips against *rendered* state; snackbar offers "Follow system" |
| 11 | Disabled text buttons grew a solid container | Blanket disabled rule | Text variant stays transparent |
| 12 | Skip link's shadow smeared the page's top edge | Parked at exactly `-100%` | Parked clear of its own offset |
| 13 | Control borders at 1.6:1 | `outlineVariant` used for control boundaries | Moved to `outline`; test added |
| 14 | HLS-only videos could never play; every image shifted the layout | The normalizer silently dropped `hls`, `width` and `height` while copying media | Fields preserved; ratios drive the grid; `tests/media.test.mjs` pins it |
| 15 | A play button that led to a dead player | Chromium answers `"maybe"` for HLS and then cannot play it | `canPlayType` distrusted, Blink excluded, honest "Watch on X" fallback |
| 16 | Lightbox opened *underneath* the app chrome | Hand-picked `z-index: 60`, below `--md-sys-z-sticky: 100` | New `--md-sys-z-immersive` token above the snackbar; test pins the ordering |
| 17 | Escape did nothing after clicking the image | Keydown bound to the viewer root; clicking a non-focusable `<img>` moves focus to `<body>` | Bound on the document, guarded by `isOpen` |
| 18 | Zoom was a no-op on most screenshots | Zoomed to natural size, which is smaller than the stage on a desktop monitor | `max(natural, 2.5× displayed)` |
| 19 | Focus landed on "copy link", not "close" | The focus trap focuses the first tabbable child; the call raced it | Focus moved into a `requestAnimationFrame` after the trap installs |
| 20 | A scrollable menu closed the moment you scrolled it | Capture-phase scroll listener also saw scrolling *inside* the menu | Ignore scroll events originating within the menu |
| 21 | A tall menu ran off the bottom of the window | Overflow handling clamped the top edge only | Menu is capped to the space available on the chosen side |
| 22 | Clicking the sort chip stacked a second menu | `openMenu` treats the trigger as "inside" for outside-clicks | Caller owns the toggle |

Defects 20–22 all predate the work that revealed them and were invisible with
seven sort options. At seventeen the menu scrolls and overflows, and all three
became unmissable. Adding content to a component is a legitimate way to test
it.

Defects 14 and 15 are worth separating from the rest. Every other entry was
found by *looking* at the UI; these two were found by **exercising** it — one by
checking what the normalizer actually emitted against what the scraper captured,
the other by probing a real browser instead of believing its own feature
report. Neither would have appeared in a screenshot, because in both cases the
UI looked completely correct. A missing capability shows up as nothing at all,
which is why the media path now carries tests rather than only a review.

---

## Part 4b — The second diagnosis: the model was wrong

Everything in Parts 1–4 fixed the *execution* of the previous UI. Colour,
type, shape, motion and accessibility were all genuinely broken and are all
genuinely better. But that work left the underlying model untouched, and the
model was the real defect.

**The product was a list of posts that happened to contain pictures.**

That single premise generated every remaining problem, and none of them were
solvable inside it:

### 4b.1 The unit of the interface was wrong

A card was one post. A post with four photos was **one row** containing a 2×2
grid squeezed into 16:9. So four saved images occupied the same space, and the
same rank in every sort, as one. You could not open the third one directly,
could not address it in a URL, could not filter to it, and could not shuffle it
independently. The data model said "four things"; the interface said "one".

Flattening to one entry per media item — `<tweet_id>:<position>` — is the
change from which everything else in this round follows. It is a nine-line
function (`mediaIndex`) and it is the whole redesign.

### 4b.2 The loudest element was a number nobody came for

The hero band spent `display-large` — 57 px, the largest type in the system —
on a count of how many bookmarks existed, above a second row of four tonal
stat cards. At 1440 px it consumed the top 300 px of the page. On a 390 px
phone it consumed the entire first screen.

A summary that pushes the thing it summarises below the fold is an inverted
hierarchy. The earlier round of this redesign *noticed* that and patched it
(shed the caption at compact, drop to display-small, scroll the stats) — which
is the tell. When a component needs three compensations to fit, the component
is wrong, not its breakpoints.

It is gone entirely. The display scale is now unused in the whole product, and
that is the correct outcome for a media browser: the largest thing on screen
should be a photograph.

### 4b.3 Filing tools nobody uses, in a browsing product

Tags and notes cost: a tag button on every card, a note textarea in every
detail view, two collections (Unread, Tagged), two sorts (Recently tagged,
Least touched), two filter chips, a stat tile, a storage key, a prompt dialog,
and a `taggedAt` timestamp. All of that is chrome asking the reader to do
filing work at the exact moment they wanted to be entertained.

The honest version of what those features were for is *rediscovery* — finding
something good you saved and forgot. Tags solve that only if you tag
everything, which nobody does. What actually solves it is **Rediscover**,
**Forgotten first** and **shuffle**: zero user effort, immediate payoff. Those
survive; the filing cabinet does not.

### 4b.4 X's interaction model was ignored

The brief asked for X's horizontal scrolling experience. The previous build had
exactly one horizontal scroller, and it was the filter chip bar. Media — the
one thing X itself pages horizontally, both in a post's carousel and in its
full-screen viewer — was in a static grid.

Now: rails page horizontally, theater pages horizontally, the viewer's
filmstrip scrolls horizontally, and the viewer itself traverses the entire
library with `←` `→` or a swipe rather than the four attachments of one post.

### 4b.5 The video pipeline was quietly lossy

Three fields were being discarded between the scraper and the screen — the
mp4 variant ladder, the explicit poster, and the sensitivity flag — and each
loss was silent. The most expensive was the ladder: with one URL surviving
normalisation, a 168 px thumbnail and a full-screen player necessarily got the
same file. `06-media-and-playback.md` is the full account.

---

## Part 4c — Decisions in this round I'd expect to be challenged

### 4c.1 "You deleted features users might be using"

Tags and notes were removed on instruction, but I'd have argued for it anyway,
and the argument is not "nobody uses them". It is that they were a *second
product* sharing a surface with the first, and the two were making each other
worse. A tool for looking at pictures and a tool for annotating a research
corpus want opposite interfaces: one wants the chrome gone, the other wants
metadata always visible.

The mitigation is that **archive survives**. It was the only one of the three
that is a browsing action rather than a filing action — "I am done with this,
stop showing it to me" — and removing it would have lost real user intent.

### 4c.2 "Three views is two too many"

The honest counter-argument. Every view is code, and a view switch is a
decision pushed onto the user.

I kept all three because they are genuinely different *tasks*, not three skins:
grazing with no target, hunting for one known item, and watching one thing at a
time. A single view has to compromise all three. The cost is bounded because
they share one index and one tile component — the three renderers are 40, 25
and 60 lines respectively.

What I would drop first if forced: theater on desktop, where the viewer already
does the same job with more room.

### 4c.3 "The hero rail crops media, and you said cropping was wrong"

It does, and I did. The rule is stated by surface in
`03-layout-and-navigation.md` §3 rather than absolutely, because "never crop"
produces a hero rail with a ragged column of dead space beside every landscape
item — which is what my first implementation did, and the screenshot is why it
changed.

Cropping is permitted in exactly one place, and only because a non-cropping
view of the same item is always one tap away. If that ever stops being true,
the crop has to go.

### 4c.4 "Dark by default is a taste call"

It is not. A bright surround measurably shifts how an image is perceived, which
is why every application built for looking at pictures — Lightroom, Photos,
Preview, X's own image viewer — darkens the room. Defaulting to system means
roughly half of first runs frame photographs in white.

"System" is one tap away in Settings, and the rail toggle is always visible.
Only a genuinely first-time user gets the opinionated default; anyone who has
ever set a preference keeps it.

### 4c.5 "CSS columns are the wrong masonry"

Reading order runs down each column rather than across, which is a real cost.

It is the right trade *here* because the grid is sorted by recency or shuffled,
so there is no sequence for the reader to lose — and the alternative is a
measurement pass, a reflow storm on every resize, and a JS dependency on the
critical path of a build-free repository. In a ranked list I would have paid
for the JS.

---

## Part 5 — Known limitations

Honest list of what is not finished, after this round.

**Resolved by this round** (kept here so the record is legible): the
`window.__commitTag` global went with the tag system; the dead saved-views
persistence went with `KEYS.views`; the generic empty states are now specific
per collection; selection loss when shrinking past 1200 px is fixed —
`bindWindowClass` now re-hosts the open inspector into a sheet instead of
discarding it.

Still open:

1. **`localStorage` caps the library at roughly 3,300 posts.** At the sample's
   ~1.5 kB/post, a 5 MB quota is exhausted well below the 10k–50k a heavy X
   user actually has. `saveItems()` reports the failure honestly, but the write
   is still lost. IndexedDB is the fix and it remains the single most
   consequential thing undone.
2. **Storage keys changed** `bm-*` → `xbm.*` with no migration, and this round
   changed the `meta` shape again (tags/note dropped, `openedAt` added). Old
   metadata is read leniently, but a returning user from the `bm-*` era still
   sees an empty library until re-import.
3. **The grid is not virtualised.** Chunks of 120 with a "show more" control
   are fine into the thousands; nobody has tried 50 000. The media index is
   rebuilt in full on every render, which is O(posts × media) — cheap now,
   linear later. An index cache keyed on the filter state is the obvious fix
   and it is not written.
4. **No pinch-zoom in the viewer.** Tap-to-zoom, `z`, swipe and native pan
   all work; a two-finger pinch is not wired up. The sandbox has no
   touchscreen, and emulated touch is not evidence.
5. **The rails composition is heuristic, not evaluated.** Thresholds (≥3 opened
   items, ≥2 motion items, ≥4 per author, 10-item floor for grouping) are
   considered guesses that look right against a 7-post sample and a synthetic
   larger one. They want real libraries and, ideally, a preference.
6. **Theater mounts from a 120-item slice.** Paging to the end of that slice
   simply stops; there is no "load more" in that view because the gesture has
   no natural place to put one. Rare with a filter applied, wrong in principle.
7. **No visual-regression baseline.** Every view at three breakpoints was
   screenshotted and reviewed by eye this session, and three defects were found
   that way — the wasted vertical space in mobile theater, the ragged hero
   rail, and rails that repeated the same twelve items. The harness exists;
   committing reference images and diffing them would make those impossible to
   reintroduce silently. This is now the highest-value missing test.
8. **The sample library ships ~2 MB of generated media.** It exists so playback
   can be seen working without importing a real export. If bundle size ever
   matters, this is the first thing to drop.
9. **Only Chromium was tested.** The sandbox has no Firefox or WebKit. This
   matters more than usual here: Safari is the one browser that takes the
   native-HLS branch, and it is the one browser I cannot run. It is also the
   one most likely to differ on `scroll-snap-stop` and `backdrop-filter`, both
   of which this design leans on.
10. **`aspect-ratio` on the theater stage assumes the media reports honest
    dimensions.** A capture with `width`/`height` of 0 falls back to 16:9,
    which is right on average and visibly wrong for a portrait screenshot.

---

## Part 6 — What I'd do next

In priority order:

1. **Move storage to IndexedDB**, with a `bm-*` migration in the same pass.
   Everything else is polish on a system that silently stops accepting writes
   at ~3,300 posts.
2. **Commit visual-regression baselines.** Given that three of this round's
   defects were visual-only and none of them could have been caught by
   reasoning about the code, this is the highest-leverage addition available.
3. **Cache the media index** between renders, keyed on the filter/sort state.
   Cheap, and it removes the only super-linear path in the app.
4. **Paginate theater**, or make it stream from the same chunking the grid
   uses.
5. **Test on Firefox and WebKit** — specifically the HLS branch on Safari, the
   only path no test here can execute, and `scroll-snap-stop`, which the whole
   theater view depends on.
6. **Instrument the rails.** Which rails get scrolled, how far, and which
   produce an open. Every threshold in `buildRails` is currently a guess, and
   they are exactly the kind of guess that data settles in a week.
7. **Pinch-zoom**, on a real device.

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

---

## Part 5 — Known limitations

Honest list of what is not finished.

1. **`promptTag` stashes a callback on `window.__commitTag`.** It works, but
   global mutable state as a callback channel is fragile. Should be a closure
   passed through the dialog controller.
2. **Saved views are persisted but have no UI.** `KEYS.views` is written and
   read; nothing surfaces it. Either build the picker or remove the storage.
3. **Shrinking below 1200 px drops the visible selection.** `bindWindowClass`
   calls `clearDetailPaneOnly()` rather than re-opening the selection as a
   sheet. Rare in practice (people don't often resize across that boundary
   mid-read), but it is a real state loss.
4. **Storage keys changed** `bm-*` → `xbm.*` with no migration. A returning
   user's library appears empty until re-import. Given the redesign changes the
   metadata shape anyway, a one-time migration reading the old keys would be
   kind.
5. **No visual-regression baseline.** Screenshots were reviewed by eye this
   session. The harness exists (`/tmp/shot.mjs` + headless Chromium); committing
   reference images and diffing them would make defects 1–13 impossible to
   reintroduce silently.
6. **The virtualisation ceiling is untested.** Rendering chunks at 60 items
   with a "load more" control is fine for thousands; nobody has tried 50 000.
7. **Only Chromium was tested.** The sandbox has no Firefox or WebKit. The CSS
   avoids Chromium-only features except `animation-timeline` (behind
   `@supports`) and `::-webkit-scrollbar` (progressive), but this is untested,
   not proven.

---

## Part 6 — What I'd do next

In priority order:

1. **Commit visual-regression baselines.** The single highest-leverage
   addition, given how many defects here were visual-only.
2. **Migrate `bm-*` storage keys**, so existing users don't lose their library.
3. **Build the saved-views UI** or delete the dead persistence.
4. **Fix the selection loss** when crossing 1200 px downward.
5. **Test on Firefox and WebKit.**
6. **Empty and error states for every collection** — currently generic. "No
   tagged posts yet" should suggest tagging something, not just report absence.

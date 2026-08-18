# 01 · Foundations

Colour, type, shape, space, elevation and motion. Every value is a token in
`shared/m3e/tokens.css`; nothing in the product hard-codes a colour, a radius
or a duration.

Naming follows the M3 specification exactly — `--md-ref-*` for reference
primitives, `--md-sys-*` for system tokens. Product-specific additions that
have no M3 equivalent are namespaced `--m3e-*`, so it is always obvious which
tokens are spec and which are ours.

---

## 1. Colour

### 1.1 The model

M3 dynamic colour works by generating a **tonal palette** — one hue held
constant across a range of tones — and then assigning *roles* (`primary`,
`onPrimary`, `surfaceContainer`, …) to specific tones. Light and dark schemes
pick different tones from the same palettes, which is why a well-built M3
theme flips modes without a second colour list.

`shared/m3e/color.js` implements this from scratch in ~375 lines:

1. **Colour-space primitives** — sRGB ⇄ linear ⇄ XYZ (D65) ⇄ CIELAB ⇄ LCh.
2. **`maxChroma(l, h)`** — a 24-iteration binary search for the most chroma
   that stays inside the sRGB gamut at a given lightness and hue. Every
   generated colour is gamut-clipped this way rather than naively clamped,
   which is what stops saturated seeds from flattening into mud at the ends of
   the scale.
3. **`TonalPalette`** — tone → hex, where *tone ≡ CIE L\**.
4. **Scheme variants** — `tonalSpot`, `vibrant`, `expressive`, `neutral`,
   using the hue-rotation constants from Material Color Utilities
   (`HUES = [0, 21, 51, 121, 151, 191, 271, 321, 360]`).
5. **Role → tone tables**, one per contrast level.
6. **WCAG contrast** plus `blend()` for pre-computed state layers.

### 1.2 Deliberate deviation: CIE-LCh instead of HCT

M3's reference implementation uses **HCT**, a colour space Google built by
grafting CAM16 chroma and hue onto L\* lightness. There is no HCT in any
browser and no dependency-free JS port small enough to justify vendoring here,
so this implementation uses **CIE-LCh**, which shares the L\* axis.

Tone therefore means the same thing in both spaces — `tone 40` is `L* 40` — so
the role→tone tables transfer directly, and the contrast relationships M3's
tables are designed to produce still hold. That is the property that actually
matters, and it is verified exhaustively (§1.5).

**Chroma does not transfer.** LAB-derived chroma over-states colourfulness near
white and black relative to CAM16. Using M3's published neutral chroma figures
verbatim produced visibly pink-grey "neutral" surfaces — the entire dashboard
had a rosé cast. The neutral and neutral-variant chroma values are therefore
tuned down substantially:

| Variant | M3 neutral / neutralVariant | Here |
|---|---|---|
| tonalSpot | 6 / 8 | **1.5 / 4** |
| vibrant | 10 / 12 | **2.5 / 6** |
| expressive | 8 / 12 | **3.5 / 7** |
| neutral | 2 / 2 | **0 / 1** |

The accent palettes (primary, secondary, tertiary, error) keep M3's figures;
only the near-neutral ranges, where the LAB/CAM16 disagreement is largest,
are corrected. The result: `surface` at `#faf9fd` has an R–B spread of 6/255 —
a perceptible but calm tint, which is what a "neutral with a hint of the seed"
surface is supposed to be.

This is documented in a comment block at the top of the `VARIANTS` table in
`color.js` so nobody "fixes" it back.

### 1.3 Scheme variants

| Variant | Primary chroma | Hue shift | Character |
|---|---|---|---|
| `tonalSpot` | 36 | none | M3's default. Calm, muted. Shown as **Calm**. |
| `vibrant` | max in gamut | none | Saturated, seed-faithful. Shown as **Vibrant**. **Product default.** |
| `expressive` | 40 | **+240°** | Primary deliberately unrelated to the seed. Shown as **Expressive**. |
| `neutral` | 12 | none | Nearly monochrome. Shown as **Neutral**. |

**The default is `vibrant`, not `expressive`** — a considered decision worth
stating plainly, because "use Expressive" was the brief.

The M3 `expressive` *scheme variant* rotates the primary hue by 240°. Pick
violet, get teal. On a phone home screen that is a delightful surprise: the
system chose something for you. In a tool where the user picks a swatch from a
grid, it is a bug — you tapped violet and the app turned teal. The variant is
still there, one tap away, labelled **Expressive** for people who want it.

This is a choice about *which M3 knob to default*, not a retreat from
Expressive. Every other Expressive mechanism — emphasised type, shape as state,
spring motion, tonal containers, the shape-morph press — is on by default. And
it is exactly the constraint the brief set: *do not sacrifice usability for
expressiveness.*

A related trap, caught by screenshot review: because every variant re-chromas
the seed to a fixed target, **only the hue survives**. The original seed list
had a near-grey "Graphite" at hue 268 and "Signal" blue at hue 268 — they
produced byte-identical schemes and rendered as two identical swatches. Seeds
are now chosen for hue separation (303 / 268 / 180 / 148 / 45 / 334), and
`tests/design-system.test.mjs` fails if any two collapse. A desaturated UI is
still reachable: it is the **Neutral** colour style, which is where that choice
belongs since it applies to *any* hue.

Swatches in the picker are painted with the resulting `primary`, computed
through `M3ETheme.seedPreview()` — never the raw seed hex — and they repaint
when the variant, contrast or appearance changes. The picker can therefore
never advertise a colour it will not produce.

### 1.4 Contrast levels

`standard`, `medium`, `high` shift the role→tone tables, matching M3's
contrast-level support and Android's system-wide contrast setting. A test
asserts the levels are **monotonic** — raising contrast may never *reduce* a
measured ratio, which is easy to break by hand-editing one tone.

### 1.5 Verification

The whole personalisation space is checked on every test run:

```
6 seeds × 4 variants × 3 contrast levels × light/dark
  = 72 schemes
  × 15 text pairs   → 2 160 checks, 0 below 4.5:1  (worst 6.42:1)
  ×  6 boundaries   →   720 checks, 0 below 3:1
```

Text uses WCAG AA (4.5:1). Non-text uses 1.4.11 (3:1) — see
`04-accessibility.md` for why `outlineVariant` is excluded and what had to
change as a result.

---

## 2. Type

### 2.1 Typeface

**Roboto Flex**, self-hosted, as a genuine variable font.

Self-hosting is not a preference. The extension popup runs under the MV3
content security policy, which forbids remote resources; if the dashboard
loaded Roboto Flex from the Google Fonts CDN and the popup could not, the two
surfaces of one product would render in two different typefaces. Self-hosting
also means the dashboard works offline, which matters for a tool whose whole
premise is keeping your data local.

Roboto Flex ships 15 axes. Shipping them all costs ~240 kB per subset for
variation we never use. The bundle keeps the two axes M3 Expressive actually
depends on:

- **`wght` 100–1000** — the emphasised scale is expressed as weight;
- **`opsz` 8–144** — optical sizing, driven automatically by
  `font-optical-sizing: auto`, so 57 px display text gets tighter apertures
  while 11 px labels stay open. This is the reason to use a variable font at
  all rather than two static weights.

84 kB (latin) + 59 kB (latin-ext), `font-display: swap`, and
`font-synthesis-weight: none` so the browser never fakes a weight the file
already contains.

### 2.2 The scale

All 15 M3 roles, as `.m3e-{role}-{size}` classes:

| Role | Size / line-height / tracking | Weight |
|---|---|---|
| Display L / M / S | 57/64/−0.25 · 45/52/0 · 36/44/0 | 400 |
| Headline L / M / S | 32/40 · 28/36 · 24/32 | 400 |
| Title L / M / S | 22/28 · 16/24/0.15 · 14/20/0.1 | 400 · 500 · 500 |
| Body L / M / S | 16/24/0.5 · 14/20/0.25 · 12/16/0.4 | 400 |
| Label L / M / S | 14/20/0.1 · 12/16/0.5 · 11/16/0.5 | 500 |

### 2.3 Emphasised styles — the 80/20 rule

M3 Expressive adds a parallel set of 15 **emphasised** styles: higher weight
plus a slight tracking adjustment. They exist to create hierarchy *within* a
size, so a section header can outrank body text without becoming physically
larger.

They are available as a modifier — `.m3e-title-large--emphasized` — and are
rationed to roughly **one in five** type instances, per Google's guidance.
Concretely, emphasised type appears only on:

- rail titles ("Video & GIFs", "Recently posted");
- dialog and sheet titles;
- the inspector's author name;
- the popup status word and its stat numerals;
- primary button labels.

Body copy, metadata, timestamps, captions, form labels and helper text are
never emphasised. If everything is emphasised, nothing is — that is precisely
what went wrong in the UI this replaces, where six weights competed on one
card.

**The display scale is now unused entirely.** The previous build spent it on a
count of how many bookmarks existed — 57 px of type announcing a number nobody
came for, occupying the top of every screen. There is no longer any text in
this product important enough to earn display size, and that is the correct
answer for a media browser: the largest thing on screen should be a
photograph, not a word.

That is worth stating plainly because it inverts the usual reading of
"expressive". Restraint in type is what *lets* the media be expressive. A
57 px numeral competing with a 16:9 hero image does not produce two loud
things; it produces one confused screen.

---

## 3. Shape

The full M3 Expressive corner scale:

| Token | Value | Used by |
|---|---|---|
| `none` | 0 | full-bleed media |
| `extra-small` | 4 px | snackbar, key hints |
| `small` | 8 px | text fields, menus |
| `medium` | 12 px | small containers |
| `medium-increased` | 16 px | stat cards, log rows |
| `large` | 16 px | FAB, nav drawer |
| `large-increased` | 20 px | **media tiles, default** |
| `extra-large` | 28 px | dialogs, sheets, theater stage |
| `extra-large-increased` | 32 px | — |
| `extra-extra-large` | 48 px | — |
| `full` | 9999 px | buttons, chips, badges, search |

### 3.1 Shape carries meaning

This is the Expressive idea worth the most here, and it does more work than
before because colour is no longer available: nothing may tint a photograph,
so shape has to carry state on its own.

On `.m3e-tile`, radius is a **state channel**, not styling:

| State | Radius | Plus |
|---|---|---|
| default | `large-increased` (20) | — |
| hover | `large-increased` | scale 1.012, elevation 2 |
| **pressed** | `medium-increased` (16) | scale 0.985 |
| **selected** | `large-increased` | 3 px `primary` outline, offset 2 px |

Pressing squares the tile off — physical compression rather than a colour
flash. The same morph runs through the carousel arrows (`full` → `medium`) and
the theater play button (`full` → `extra-large`), so "pressed" has one
consistent meaning across every round control in the product.

Selected chips likewise go fully round while unselected ones stay partly
rounded, so filter state is legible in greyscale, under colour blindness and
in forced-colours mode. Colour is redundant reinforcement, never the sole
signal.

The same principle runs through the popup: the status dot is a **circle** while
capturing, **squares off** when paused, and becomes a **rotated square** on
error — three states distinguishable with the monitor turned to greyscale.

### 3.2 Shape morph on press

Every `.m3e-button` squares off to `--_pressed-radius` and scales to 0.97 on
`:active`, then springs back. This is M3 Expressive's signature press
feedback, and it confirms the touch at the point of contact instead of 200 ms
later somewhere else on screen.

### 3.3 Shape scales with container

Larger containers take larger radii. The theater stage and the sheets take
`extra-large` (28); tiles take `large-increased` (20); the filmstrip frames in
the viewer take `small` (8). A 52 px thumbnail with a 28 px radius is a
lozenge, not a thumbnail.

`extra-large-increased` and `extra-extra-large` are currently unused. They were
the hero's radii, and the hero is gone. They stay in the token set rather than
being deleted: the ladder is the M3 shape scale, not a list of what this
product happens to use today, and a gap in a scale is how the scale stops
being one.

---

## 4. Space

A 4 px base grid: `--md-sys-spacing-1` = 4 px through `--md-sys-spacing-16` =
64 px.

Window-class margins follow M3's adaptive guidance:

| Class | Margin token | Value |
|---|---|---|
| compact | `--md-sys-margin-compact` | 16 px |
| medium | `--md-sys-margin-medium` | 24 px |
| expanded | `--md-sys-margin-expanded` | 24 px |
| large / extra-large | `--md-sys-margin-large` | 32 px |

**Density** (`comfortable` / `compact`) is a user setting that scales row gaps
and card padding, not font size — text stays readable while the list tightens.

---

## 5. Elevation

M3's six levels, as two-part shadows. Elevation is used sparingly and always
means "this floats above the content plane": FAB (level 3), menus and dialogs
(level 3), the app bar once scrolled (level 2), snackbar (level 3).

Resting cards are **not** elevated. They are separated by *tonal* surface
containers (`surface` → `surfaceContainerLow` → `surfaceContainer` → …), which
is the M3 way and keeps large lists calm. A page of drop shadows is the
strongest signal of a pre-M3 mental model.

---

## 6. Motion

### 6.1 Two families, never mixed

M3 Expressive defines two spring families, and the distinction is the single
most important motion rule in the system:

- **Spatial** — springs with overshoot. Only for position, size, rotation,
  corner radius.
- **Effects** — no overshoot, ever. Only for colour and opacity.

Bouncing a colour transition overshoots *past the target colour*, which looks
like a rendering fault.

| Token | Duration | Curve |
|---|---|---|
| `spring-fast-spatial` | 350 ms | `cubic-bezier(0.42, 1.67, 0.21, 0.90)` |
| `spring-default-spatial` | 500 ms | `cubic-bezier(0.38, 1.21, 0.22, 1.00)` |
| `spring-slow-spatial` | 650 ms | `cubic-bezier(0.39, 1.29, 0.35, 0.98)` |
| `spring-fast-effects` | 150 ms | `cubic-bezier(0.31, 0.94, 0.34, 1.00)` |
| `spring-default-effects` | 200 ms | `cubic-bezier(0.34, 0.80, 0.34, 1.00)` |
| `spring-slow-effects` | 300 ms | `cubic-bezier(0.34, 0.88, 0.34, 1.00)` |

These are CSS approximations of the Android spring constants (fastSpatial
damping 0.9 / stiffness 1400; defaultSpatial 0.9 / 700; slowSpatial 0.9 / 300;
fastEffects 1 / 3800; defaultEffects 1 / 1600; slowEffects 1 / 800).

### 6.2 Speed by scale

Per M3: **fast** for small components (chips, switches, buttons), **default**
for partial-screen surfaces (sheets, menus, expanding rail), **slow** for
full-screen transitions.

### 6.3 Reduced motion

`prefers-reduced-motion` and the in-app **Reduce motion** switch both set
`html[data-motion="reduced"]`, which collapses every spring to a near-instant
snap and stops looping animations (the breathing status dot, the wavy progress
scroll) while keeping their static shape. Motion is never the only carrier of
meaning, so nothing is lost — the wave still reads as a wave, the status word
still says "Capturing".

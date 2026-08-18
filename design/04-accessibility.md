# 04 · Accessibility

Accessibility here is a build-time constraint, not a review checklist.
`tests/design-system.test.mjs` fails if any of the colour guarantees below
regress.

---

## 1. Contrast

### 1.1 Text — WCAG AA (4.5:1)

All 15 text role pairs are verified across the entire personalisation space:

```
6 seeds × 4 variants × 3 contrast levels × light/dark = 72 schemes
72 × 15 pairs = 2 160 checks · 0 failures · worst ratio 6.42:1
```

The margin is comfortable because the role→tone tables target it structurally
(a tone-40 `primary` under a tone-100 `onPrimary` is not an accident), not
because individual colours were nudged until they passed.

### 1.2 Non-text — WCAG 1.4.11 (3:1)

This is the check most design systems skip, and it forced a real change.

M3 has two outline roles: `outline` and `outlineVariant`. `outlineVariant`
measures around **1.6:1** against `surface`. That is fine — 1.4.11 explicitly
exempts purely decorative boundaries, which is what `outlineVariant` is scoped
to (dividers, scrollbars, hairlines between regions).

But the components had been using `outlineVariant` for **control borders**: the
outlined button, chips, outlined icon buttons, text fields, outlined cards and
outline badges. For those, the border *is* the thing that says "this is a
control" — a meaningful non-text boundary that owes 3:1. All six were moved to
`outline`, and a test now asserts none of them regresses:

```
6 boundary pairs × 72 schemes = 720 checks · 0 failures
```

The sheet drag handle moved too: it is an affordance ("you can drag this"), not
decoration.

Remaining `outlineVariant` uses are genuinely decorative — dividers, scrollbar
thumbs, region hairlines, the `/` key hint.

### 1.3 User-adjustable contrast

Three levels (`standard`, `medium`, `high`) shift the role→tone tables, and
`prefers-contrast: more` selects `medium` automatically. A test asserts the
levels are **monotonic** — raising contrast can never lower a measured ratio.

---

## 2. Colour is never the only signal

Every state that matters is encoded at least twice:

| Meaning | Colour | Second channel | Third |
|---|---|---|---|
| Tile selected | primary outline | **3 px ring + 2 px offset** | `aria-selected` |
| Tile pressed | — | **radius 20 → 16** | scale 0.985 |
| Filter chip on | secondary container | **radius partial → full** | `aria-pressed` |
| Motion vs still | — | **play glyph** | duration or `GIF` badge |
| Unplayable video | — | **glyph is "open", not "play"** | explanatory card on open |
| Sensitive media | — | **blur** | veil label "Sensitive · tap to show" |
| Capture paused | tertiary container | **dot becomes a square** | word "Paused" |
| Capture error | error container | **dot becomes a rotated square** | word + reason |
| Zero-value stat | dimmed to `outline` | the numeral is `0` | — |

Turn the display to greyscale and every one of these still reads.

This constraint bites harder in a media browser than it did in a list, and it
is the reason shape does so much work in §3 of the foundations. Over a text
card you can always tint the background to signal state. Over a photograph you
cannot: any tint is a change to the user's content. Shape, outline and glyph
are the only channels left, so all three are used deliberately rather than
decoratively.

---

## 3. Keyboard

- **Skip link** first in the DOM, visible on focus. It is parked
  `-100% - 24px` off-screen because `-100%` alone left its elevation shadow
  smeared across the top edge of the page.
- **Focus ring** on every focusable element: 3 px `secondary` at 2 px offset.
  Drawn on `secondary` specifically so it never disappears against the
  `primary` fills it most often sits on. Never removed without replacement.
- **Every carousel is keyboard-operable.** A horizontally scrolling region
  drivable only by a wheel or a swipe fails **WCAG 2.1.1 (Keyboard)**
  outright, and it is the single most common accessibility failure in
  carousel-based UIs. Each rail is focusable and responds to `←` `→` `Home`
  `End`; `bindCarousel` owns that, so no rail can be added without it.
- **Scroll is handed back at the ends.** The wheel-to-horizontal translation
  stops applying once a rail has no room left in that direction, so the page
  keeps scrolling instead of the pointer being trapped in a rail — a
  **2.1.2 (No Keyboard Trap)** problem in spirit even when it is a pointer
  doing the scrolling.
- **`i` inspects the focused tile**, so the post behind a picture is reachable
  without the pointer-only context-menu gesture that also exposes it.
- **Focus trap** in modal overlays only (dialog, bottom sheet, side sheet), via
  `M3E.createOverlay`. The persistent detail pane at ≥1200 px is deliberately
  *not* trapped — it is part of the page.
- **Focus restoration** — closing an overlay returns focus to whatever opened
  it.
- **48 × 48 px minimum hit area** everywhere, achieved with padding or
  pseudo-element expansion rather than by inflating the painted control.

---

## 4. Screen readers

- Semantic landmarks: `<header>`, `<nav>`, `<main>`, `<aside>`.
- One `<h1>` per surface, naming the current collection — kept visible at every
  breakpoint.
- Live regions: the snackbar is `polite`, and switches to `assertive` for
  errors so a screen reader interrupts rather than queueing behind a long read.
- Result counts announced on filter change, so a keyboard user knows the list
  changed underneath them.
- **Every tile is a real `<button>`** with a composed label:
  `Play video by Engineer Daily: <caption>`. Action first, then medium, then
  source, then the caption — a screen-reader user decides whether to keep
  listening during the first few words, so the action cannot be last.
- **Alt text falls back to the post's own words.** Where a capture carries no
  caption, the post text is used, truncated. It usually describes the picture
  better than any generic string, and "image" describes nothing at all.
- **`aria-describedby` points at the shell, not at a view.** The hint that says
  what activating a tile does lives outside the three renderers, because a
  reference to an id that exists in only one of them is silently dropped by
  the other two — which is worse than having no hint.
- Icon-only buttons all carry `aria-label`, and **relabel themselves when their
  meaning flips**. The theme toggle is the example: it shows a sun and says
  "Switch to light theme" while dark, a moon and "Switch to dark theme" while
  light. A static label on a toggling control tells half its users the wrong
  thing.
- Toggle state via `aria-pressed`; selection via `aria-selected`; expansion via
  `aria-expanded`.
- Decorative SVG is `aria-hidden="true"` — the icon never doubles the label.

### A related fix

The theme toggle used to cycle `system → light → dark`. For a user whose system
is light, the first press changed **nothing on screen** — it moved from
"system (light)" to "light". A toggle that visibly does nothing reads as
broken. It now flips to the opposite of what is currently *rendered*, and the
confirming snackbar offers "Follow system" as an action, so the three-way
choice is still reachable without making the common case confusing.

---

## 5. Motion

`prefers-reduced-motion: reduce` and the in-app **Reduce motion** switch both
set `html[data-motion="reduced"]`:

- springs collapse to a near-instant snap;
- looping animations stop (breathing status dot, wavy progress scroll) while
  keeping their static shape;
- no transform-based entrance animations;
- tiles stop scaling on hover and press, and respond by shape alone;
- carousels and the theater switch from `scroll-behavior: smooth` to `auto`,
  so paging jumps rather than glides;
- **autoplay is off.** This is the one that matters most in a media browser.
  Someone who has asked the operating system to stop things moving has asked,
  specifically and unambiguously, for video not to start playing at them.

Because motion is never the sole carrier of meaning, nothing is lost: the wave
still reads as a wave, the status word still says "Capturing", and every video
still plays the moment it is asked to.

Autoplay additionally has its own switch in Personalise, independent of the
motion setting, because bandwidth is a legitimate reason to want it off and
those two preferences should not be welded together.

---

## 6. Forced colours (Windows High Contrast)

A dedicated `@media (forced-colors: active)` block:

- borders become `CanvasText` so containers keep their edges when backgrounds
  are stripped;
- `forced-color-adjust: none` on the few elements whose colour *is* the
  information (the theme preview swatches);
- focus rings switch to `Highlight`;
- state layers are disabled, since they cannot be seen anyway.

---

## 7. Media-specific concerns

- **Sensitive media** is blurred, and the first activation only reveals it.
  Opening is a second, deliberate action. Nothing marked sensitive autoplays.
- **No seizure risk from autoplay**: only one item plays at a time, it is
  always muted, and it stops the moment it leaves the viewport.
- **Layout never shifts as media loads.** Intrinsic `width`/`height` plus the
  `--_ar` ratio mean the box is correct before any bytes arrive. Cumulative
  layout shift is a genuine accessibility problem, not just a metric — a
  target that moves as you reach for it is a **2.5.x** failure for anyone with
  a motor impairment.
- **Video controls are the browser's own**, which are already keyboard
  complete, screen-reader labelled and localised. A bespoke control bar is a
  large amount of code whose best possible outcome is parity with them.
- **`Space` plays and pauses in the viewer**, because native controls auto-hide
  and would otherwise have to be summoned back before they could be used.
- **Unplayable video says so.** An HLS-only item renders an explanation and a
  "Watch on X" link rather than a play button that leads nowhere. A control
  that does nothing is worse for a screen-reader user than an absent one,
  because nothing announces the failure.

---

## 8. Other

- **Zoom** — layout holds to 200 % without horizontal scrolling; the type scale
  is in `rem`-relative units and containers are fluid.
- **Language** — `<html lang="en">` on both surfaces.
- **Reduced transparency** — no meaning depends on translucency; scrim blur is
  progressive enhancement behind `@supports`.
- **Offline** — no remote resources on either surface, so nothing degrades
  when the network is gone. (The extension has no choice: MV3's CSP forbids
  remote loads. A test enforces it.)

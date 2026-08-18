# 03 · Layout & Navigation

The governing rule, from which everything below follows:

> **Media occupies the centre. Chrome lives at the edges, or floats.**

A media browser is judged on how much of the screen is showing media and how
little of it is showing the application. Every layout decision here is scored
against that.

---

## 1. Window classes

Driven by `<html data-window-class>`, set by `M3E.bindWindowClass()`. One DOM,
never a second design.

| Class | Width | Navigation | Feed | Inspector |
|---|---|---|---|---|
| compact | < 600 | Floating toolbar (bottom) | Full-bleed justified grid | Bottom sheet |
| medium | 600–839 | Navigation rail | Wider rails | Side sheet |
| expanded | 840–1023 | Navigation rail | Wider rails, taller cells | Side sheet |
| wide | 1024–1199 | Navigation rail | Feed resizes around drawer | **Persistent, 360 px** |
| large | 1200–1599 | Navigation rail | Feed resizes around drawer | **Persistent, 400 px** |
| extra-large | ≥ 1600 | Navigation rail | Feed resizes around drawer | **Persistent, 460 px** |

### 1.1 Why compact gets a floating toolbar, not a navigation bar

A docked M3 navigation bar is 80 px tall and permanently present. On a
390 × 844 phone that is **9.5 % of the screen**, forever, on a surface whose
entire value proposition is vertical room for pictures.

M3 Expressive's **floating toolbar** is the component for this: a pill that
hides on scroll-down and returns on scroll-up, driven by
`M3E.bindScrollChrome`. It costs 104 px of bottom padding at rest and nothing
at all while the user is actually browsing.

This is the pattern every media app converged on independently, for the same
reason. The Data Vault rides in the same pill as a small FAB, so compact does
not need a separate floating action button competing for the same corner.

### 1.2 Why the app bar is glass

The app bar is `position: sticky` with a 20 px backdrop blur and a
78 %-opacity surface, so media scrolls *under* it rather than starting below
it. A solid band would cost another 64 px permanently.

Two details that matter:

* Once content has passed underneath (`data-scrolled="true"`), it commits to a
  94 %-opacity `surface-container` and takes elevation 1. Glass over a scrolled
  page is exactly where legibility fails; the blur is an entrance effect, not
  a permanent state.
* `@supports not (backdrop-filter: …)` falls back to an opaque surface. A
  translucent bar without a blur over an arbitrary photograph is unreadable.

### 1.3 The inspector, not a detail pane

At ≥ 1024 px a third column appears. It is deliberately **not** called a detail
view: it holds the post *behind* whichever media is selected, which is context,
not the main event. The drawer is a real grid track, so opening it pushes and
reflows the feed instead of covering media. A `ResizeObserver` immediately
recomputes virtual masonry rows at the new width.

Below 1024 px the same markup is rendered into a sheet: a bottom sheet on
compact, a side sheet from medium up. A dedicated breakpoint listener re-hosts
an open inspector across 1024 px, so resizing never loses the selection.

---

## 2. The three views

One index, three renderers. This is the core of the navigation model, and it
is a *view* switch rather than a *destination* switch — the same items, shown
three ways.

### 2.1 Rails — grazing

Horizontal M3 carousels, stacked vertically. Each rail is a computed lens:

| Rail | Contents | Layout | Condition |
|---|---|---|---|
| Pick up where you left off | Recently opened | multi-browse | ≥ 3 opened items |
| Video & GIFs | All motion | **hero** | ≥ 2 motion items |
| Recently posted | Newest 20, always by date | multi-browse | always |
| *per author* × 4 | Your most-saved authors | multi-browse | ≥ 4 items each |
| Rediscover | Seeded sample of what nothing above surfaced | multi-browse | ≥ 4 remaining |
| Everything | The full index | uncontained | always |

Two design rules govern the set:

**Rails are computed, never stored.** There is no "create a collection" step,
because an archive that asks you to file things is an archive nobody uses.
That is precisely the failure the deleted tag system represented.

**Later rails consume from a pool.** The anchor rails (motion, newest)
deliberately overlap — they are different questions about the same items — but
*Rediscover* draws only from what nothing above surfaced. Without that, a
small library renders the same twelve items six times, which is worse than no
rails at all.

Below **10 items** the whole grouping collapses to a single hero carousel. The
horizontal gesture is preserved because it is the product; the redundant
grouping is not.

### 2.2 Grid — searching

A Flickr-style justified masonry computes rows in left-to-right sort order,
using each item's captured aspect ratio without cropping. The full geometry is
cheap in-memory data; only rows within 1.5 viewports of the screen are mounted.
The window is hard-capped at 180 media cells, so a 50,000-item result does not
create a 50,000-node wall.

Tile size controls the target row height (Dense / Medium / Large). A
`ResizeObserver` recalculates geometry when the viewport changes or when the
persistent inspector takes a column. Scroll position remains in the document,
so native browser scrolling, restoration and find behaviour still work.

### 2.3 Theater — watching

One item per screen, paged horizontally. This is the X gesture applied to a
whole library rather than to the four photos inside a single post.

`scroll-snap-stop: always` is the load-bearing declaration. Without it a fast
flick skids through six items and lands somewhere arbitrary, which reads as
broken rather than fast.

At every window class the theater takes exactly the room left inside the dynamic
viewport after the app bar, filters and optional capture banner are laid out.
The page itself stops scrolling vertically while this view is active, so the
whole media frame and author bar remain visible without a guessed `vh` offset.
Two scroll axes on one screen is the fastest way to make a swipe feel unreliable.

---

## 3. Aspect ratio, and where cropping is allowed

Media keeps its own shape. Cropping everything to a square turns a media
browser into a contact sheet, and a contact sheet of text screenshots — a
large fraction of what people actually save from X — is unreadable.

The rule is applied by surface, according to what that surface is *for*:

| Surface | Sizing | Crops? | Why |
|---|---|---|---|
| Grid tile | Justified row height × captured ratio | No | Row geometry preserves ratio and left-to-right order |
| Multi-browse cell | Fixed height, **width** derived from ratio | No | Uniform height is what makes a strip read as a strip; varying width preserves the ratio |
| Hero cell | Fixed height *and* width | **Yes** | Letting each hero self-size leaves a ragged column of dead space beside every landscape item. The hero's job is to invite a tap |
| Theater stage | Flexes into the remaining dynamic viewport, `object-fit: contain` | No | The whole frame stays visible while preserving the media's ratio |
| Viewer | `object-fit: contain`, zoomable | No | Ditto, more so |

Cropping is permitted in exactly one place, and only because a second,
non-cropping presentation of the same item is always one tap away.

---

## 4. Navigation model

**Five destinations**, in the rail and (first four) in the floating toolbar:

`All · Video · Photos · Recent · Archive`

Each is a lens over the same media index, and each filters at the **media**
level — "Video" means video items, not posts that happen to contain one
alongside three photos. That distinction did not exist in the previous build
and is the reason its Media collection showed stills.

*Archive* lives in the rail but not in the compact toolbar: it is a recovery
surface, not a primary destination. The toolbar's filled action opens the Data
Vault instead.

### 4.1 Filters are orthogonal to destinations

The filter bar narrows whatever destination is active, but keeps only three
stable controls visible: **Media type**, **Sort**, and **More**. Media type is a
single-choice menu (All / Photos / Videos / GIFs); author, date and engagement
thresholds are progressively disclosed under More. Shuffle is a sort option,
not a separate chip. This keeps compact screens free of a horizontally
scrolling row of controls.

### 4.2 Everything is addressable

The full view state round-trips through the URL: collection, view, sort,
shuffle seed, search, author, media type, thresholds and dates. A copied link
reproduces exactly what the sender was looking at, shuffle order included.

---

## 5. Density

Three scalars over the 4 dp grid — comfortable (1), compact (0.75), spacious
(1.25) — plus the independent grid tile-size control. They are separate on
purpose: density is about how much *chrome* breathes; tile size is about how
large the *media* is. Wanting dense chrome and large pictures is a coherent
preference and the previous build could not express it.

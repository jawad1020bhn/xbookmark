/**
 * The media-browsing model.
 *
 * The redesign changed the unit of the application: the thing being listed,
 * sorted, filtered and addressed is a MEDIA ITEM, not a post. Almost every
 * defect that could be reintroduced here is a quiet regression back to the
 * post-list model — a filter that matches a post when it should match a
 * photo, a viewer that only sees one post's attachments, a selection key that
 * cannot distinguish photo 2 from photo 3 of the same tweet.
 *
 * These tests pin the model, the removals the brief required, and the
 * playback path that the whole product depends on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const app = read("extension/dashboard/app.js");
const html = read("extension/dashboard/index.html");
const layout = read("extension/dashboard/layout.css");
const components = read("extension/shared/m3e/components.css");

/* ---------------------------------------------------------------------------
   The unit is a media item
   --------------------------------------------------------------------------- */

test("the index is flattened to one entry per media item", () => {
  const fn = app.slice(app.indexOf("function mediaIndex()"), app.indexOf("const entryById"));
  // A post contributes as many entries as it has media.
  assert.match(fn, /for \(const media of item\.media\)/);
  // Each entry carries its post back-reference, or the inspector has nothing
  // to show and the author rails cannot be built.
  assert.match(fn, /item,/);
  assert.match(fn, /media,/);
  // Posts with no media contribute nothing at all — a text-only bookmark is
  // not something a media browser can render.
  assert.doesNotMatch(fn, /has_media/);
});

test("an entry id addresses a single item inside a post", () => {
  // `<tweet_id>:<position>` — stable across renders, sorts and filters, which
  // is what lets a selection survive a reshuffle and lets one photo of four
  // be addressed on its own.
  assert.match(app, /id: item\.tweet_id \+ ":" \+ media\.position/);
});

test("legacy multi-type URLs remain a union, not an intersection", () => {
  // The new menu is single-choice, but older shared URLs may carry several
  // type flags. They must still mean "either" rather than rendering nothing.
  const fn = app.slice(app.indexOf("function matchesMedia"), app.indexOf("function mediaIndex"));
  assert.match(fn, /filters\.video && isVideo\(media\)/);
  assert.match(fn, /\|\|\s*\n?\s*\(filters\.photos && isPhoto\(media\)\)/);
});

test("collection filtering happens at the media level", () => {
  // "Video" must mean video items, not posts that happen to contain one
  // alongside three photos — otherwise the Video collection shows stills.
  const fn = app.slice(app.indexOf("function matchesMedia"), app.indexOf("function mediaIndex"));
  assert.match(fn, /state\.collection === "video" && isPhoto\(media\)/);
  assert.match(fn, /state\.collection === "photos" && !isPhoto\(media\)/);
});

/* ---------------------------------------------------------------------------
   Removals the brief required
   --------------------------------------------------------------------------- */

test("the tag and note systems are gone entirely", () => {
  for (const src of [app, html, layout]) {
    assert.doesNotMatch(src, /promptTag|data-untag|chipTagged|chipNoted|statTagged/);
  }
  // No leftover storage key, no leftover meta field.
  assert.doesNotMatch(app, /KEYS\.views/);
  assert.doesNotMatch(app, /tags:\s*\[\]/);
  // No sort or collection may reference them.
  const sorts = app.slice(app.indexOf("const SORTS = ["), app.indexOf("const SORT_GROUPS"));
  assert.doesNotMatch(sorts, /key: "tagged"|key: "untouched"/);
  const collections = app.slice(app.indexOf("const COLLECTIONS = ["), app.indexOf("const SORTS"));
  assert.doesNotMatch(collections, /"tagged"|"unread"/);
});

test('the "Your library" box is gone', () => {
  for (const src of [html, layout, app]) {
    assert.doesNotMatch(src, /Your library\b/);
  }
  // And the hero that contained it, with all of its wiring.
  assert.doesNotMatch(html, /class="hero"|heroCount|heroStats|statShown/);
  assert.doesNotMatch(app, /renderHero/);
  assert.doesNotMatch(layout, /^\.hero/m);
});

test("archive state survives the removal of tags and notes", () => {
  // Explicitly required to be kept: it is the only destructive-ish action in
  // the product and losing it would silently discard user intent.
  assert.match(app, /active: true, removedAt: null/);
  assert.match(app, /function toggleArchive/);
  const collections = app.slice(app.indexOf("const COLLECTIONS = ["), app.indexOf("const SORTS"));
  assert.match(collections, /"archived"/);
});

test("the filter bar uses progressive disclosure", () => {
  const bar = html.slice(html.indexOf('class="filterbar"'), html.indexOf("Result summary"));
  for (const id of ["chipMediaType", "chipSort", "chipMoreFilters"]) {
    assert.match(bar, new RegExp('id="' + id + '"'));
  }
  assert.equal((bar.match(/<button/g) || []).length, 3, "only three filter controls should stay visible");
  assert.doesNotMatch(bar, /chipVideo|chipPhotos|chipGif|chipAuthor|chipRefine|chipShuffle|chipReset/);

  assert.match(app, /function openMediaTypeMenu/);
  assert.match(app, /function openMoreFiltersMenu/);
  const sort = app.slice(app.indexOf("function openSortMenu"), app.indexOf("function openRefine"));
  assert.match(sort, /SORTS\.filter/); // Shuffle remains reachable as a sort option.
});

test("data management is isolated from visual settings", () => {
  const settings = app.slice(app.indexOf("function openSettings"), app.indexOf("function openVault"));
  const vault = app.slice(app.indexOf("function openVault"), app.indexOf("function confirmClear"));

  assert.doesNotMatch(settings, /data-vault|Import JSON|Clear library|Back up everything/);
  assert.match(settings, /segDensity/);
  for (const action of ["import", "restore", "export", "backup", "clear"]) {
    assert.match(vault, new RegExp('data-vault=\\"' + action + '\\"'));
  }
  assert.match(html, /aria-label="Open data vault"/);
});

/* ---------------------------------------------------------------------------
   Horizontal browsing
   --------------------------------------------------------------------------- */

test("horizontal browsing surfaces remain scrollable", () => {
  // The brief's central requirement. Rails and theater are both x-scrollers,
  // and both must snap, or a flick lands between items.
  for (const sel of [".m3e-carousel", ".theater"]) {
    const rule = (sel === ".theater" ? layout : components);
    const block = rule.slice(rule.indexOf(sel + " {"));
    const body = block.slice(0, block.indexOf("}"));
    assert.match(body, /overflow-x:\s*auto/, sel + " must scroll horizontally");
    assert.match(body, /scroll-snap-type:\s*x/, sel + " must snap on x");
    // A horizontal flick must not become a browser back-navigation.
    assert.match(body, /overscroll-behavior-x:\s*contain/, sel + " must contain overscroll");
  }
});

test("theater pages exactly one item per flick", () => {
  // Without `scroll-snap-stop: always` a fast swipe skids through six items
  // and lands arbitrarily, which reads as broken rather than fast.
  const at = layout.indexOf(".slide {");
  assert.ok(at > -1, "missing .slide rule");
  const slide = layout.slice(at, layout.indexOf("}", at));
  assert.match(slide, /scroll-snap-stop:\s*always/);
  assert.match(slide, /scroll-snap-align:\s*center/);
});

test("the theater always has an explicit exit path", () => {
  // Immersive views must never trap the reader. The floating close button,
  // the Escape key and a touch swipe-down all funnel into one exit function.
  assert.match(app, /function exitTheater/);
  assert.match(app, /data-theater-close/);
  assert.match(app, /function bindTheaterDismiss/);
  assert.match(layout, /\.theater__close\s*\{/);
  // Escape is owned by the shared interaction runtime (bindEscape), not a
  // bespoke global shortcut system in the app itself.
  assert.match(read("extension/shared/m3e/interactions.js"), /function bindEscape/);
});

test("the theater says when the item cap truncates the list", () => {
  // The theater is capped at THEATER_LIMIT slides; a silent truncation would
  // read as a broken library. The hint line must own the cap when it bites.
  assert.match(app, /const truncated = list\.length > THEATER_LIMIT;/);
  assert.match(app, /first " \+ slice\.length \+ " of "/);
  assert.match(app, /list\.length\.toLocaleString\(\) \+ " items"/);
  assert.match(app, /"<span>" \+ hintText \+ "<\/span>"/);
});

test("a carousel is operable from the keyboard", () => {
  // A horizontally scrolling region drivable only by wheel or swipe fails
  // WCAG 2.1.1. The controller owns arrows, Home and End.
  const src = read("extension/shared/m3e/interactions.js");
  const fn = src.slice(src.indexOf("function bindCarousel"), src.indexOf("function pulse"));
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.match(fn, new RegExp('case "' + key + '"'), "carousel must handle " + key);
  }
  // And the rail itself must be focusable, or those keys can never fire.
  assert.match(app, /class="m3e-carousel[^"]*rail__scroll"\s*' \+\n?\s*' tabindex="0"/);
});

test("a rail hands the scroll back at its ends", () => {
  // Translating vertical wheel into horizontal scroll is right up until the
  // rail runs out, at which point trapping the gesture stops the page
  // scrolling at all — the classic carousel scroll-jail.
  const src = read("extension/shared/m3e/interactions.js");
  const fn = src.slice(src.indexOf("function bindCarousel"), src.indexOf("function pulse"));
  assert.match(fn, /const at = going > 0 \? scroller\.scrollLeft >= max - 1 : scroller\.scrollLeft <= 1;/);
  assert.match(fn, /if \(at\) return;/);
});

test("pointer-only carousel arrows are hidden on touch", () => {
  // Arrow buttons over media on a phone are worse than nothing: the gesture
  // is the control there.
  const block = components.slice(components.indexOf("@media (hover: none)"));
  assert.match(block.slice(0, 120), /m3e-rail-head__nav\s*\{\s*display:\s*none/);
});

/* ---------------------------------------------------------------------------
   Playback
   --------------------------------------------------------------------------- */

function loadMedia() {
  const sandbox = {
    module: { exports: {} },
    navigator: { userAgent: "Chrome/140" },
    window: { devicePixelRatio: 2 },
    document: { createElement: () => ({ canPlayType: () => "" }) },
    URL,
  };
  sandbox.self = sandbox;
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(read("extension/shared/m3e/media.js"), sandbox);
  return sandbox.module.exports;
}

test("playback picks a variant sized for where it is rendered", () => {
  const m = loadMedia();
  const media = {
    type: "video",
    mp4_variants: [
      { url: "1080.mp4", bitrate: 5000000 },
      { url: "720.mp4", bitrate: 2176000 },
      { url: "480.mp4", bitrate: 832000 },
      { url: "320.mp4", bitrate: 250000 },
    ],
  };
  // A 168px carousel tile at DPR 2 needs ~336px: the 480 rung covers it.
  assert.equal(m.playableSource(media, { width: 168 }).src, "480.mp4");
  // A 900px stage needs 1800px: only the top rung covers it.
  assert.equal(m.playableSource(media, { width: 900 }).src, "1080.mp4");
  // No hint at all means "give me the best", which is the old behaviour and
  // the right default for an unknown context.
  assert.equal(m.playableSource(media).src, "1080.mp4");
});

test("a video that fails steps down the ladder before giving up", () => {
  // A dead source produces a black rectangle and a play button that does
  // nothing, which is the exact failure this module exists to prevent.
  const src = read("extension/shared/m3e/media.js");
  const fn = src.slice(src.indexOf("function createVideo"), src.indexOf("function stopAll"));
  assert.match(fn, /video\.addEventListener\("error"/);
  assert.match(fn, /const next = ladder\[\+\+rung\]/);
  assert.match(fn, /options\.onFail/);
});

test("autoplaying video is muted, or the browser refuses to start it", () => {
  const src = read("extension/shared/m3e/media.js");
  const fn = src.slice(src.indexOf("function createVideo"), src.indexOf("function stopAll"));
  assert.match(fn, /gif \|\| !!options\.autoplay/);
});

test("the scraper keeps the whole variant ladder and the poster", () => {
  // Keeping only the best mp4 made resolution selection impossible; losing
  // the poster made every video tile a grey box until it was played.
  const content = read("extension/content.js");
  const fn = content.slice(content.indexOf("function buildMediaItems"), content.indexOf("function normalizeTweet"));
  assert.match(fn, /mp4_variants: mp4Variants/);
  assert.match(fn, /poster: still/);

  // And the dashboard normalizer must not drop them again on the way in.
  const norm = app.slice(app.indexOf("function normalizeMedia"), app.indexOf("function normalize("));
  assert.match(norm, /m\.mp4_variants/);
  assert.match(norm, /mp4Variants: variants/);
});

test("only one video plays at a time, in every surface", () => {
  const src = read("extension/shared/m3e/media.js");
  assert.match(src, /function claimPlayback/);
  // Every renderer must stop playback when it tears its DOM down, or a video
  // keeps playing from a detached node with no way to reach it.
  assert.match(app, /M3EMedia\.stopAll\(\)/);
  assert.match(read("extension/dashboard/lightbox.js"), /M3EMedia\.stopAll\(\)/);
});

test("theater tears videos down rather than merely pausing them", () => {
  // A paused <video> still holds a decoder and a buffer; a hundred of them is
  // a memory leak with extra steps.
  const fn = app.slice(app.indexOf("function mountTheaterPlayers"), app.indexOf("function mountSlideVideo"));
  assert.match(fn, /video\.pause\(\)/);
  assert.match(fn, /video\.remove\(\)/);
});

test("tiles render a poster, never a video element", () => {
  // A rail of forty videos would otherwise open forty media pipelines before
  // anyone has expressed any interest at all.
  const fn = app.slice(app.indexOf("function tileHtml"), app.indexOf("function buildRails"));
  assert.doesNotMatch(fn, /<video/);
  assert.match(fn, /loading="lazy"/);
});

test("motion tiles preview on hover, muted, with native controls for unmute", () => {
  // Hover-to-play on pointer devices: the preview mounts lazily, starts muted
  // (the browser refuses unmuted autoplay anyway), and a real video keeps its
  // native controls so unmute, fullscreen and PiP come free. GIFs loop
  // silently with no chrome. Clicking the tile itself still opens the viewer.
  const fn = app.slice(app.indexOf("function mountTilePreview"), app.indexOf("function unmountTilePreview"));
  assert.match(fn, /autoplay: true/);
  assert.match(fn, /muted: true/);
  assert.match(fn, /controls: !gif/);
  assert.match(fn, /loop: gif/);
  assert.match(app, /pointerenter/);
  assert.match(app, /canHover/);
  assert.match(app, /data-playing/);
  // The tile click must not fire when the click is on a video's own controls;
  // a GIF preview (no controls) still opens the viewer when clicked.
  assert.match(app, /closest\("\.tile__video\[controls\]"\)/);
});

test("touch playback plays the centred tile and pauses while scrolling", () => {
  // No hover on a phone, so the fallback is settled-in-view: play the most
  // centred motion tile, pause while the page scrolls, resume ~140ms after it
  // settles. Only one preview is ever mounted.
  const fn = app.slice(app.indexOf("function createTileAutoplayer"), app.indexOf("Rails view"));
  assert.match(fn, /IntersectionObserver/);
  assert.match(fn, /window\.addEventListener\("scroll"/);
  assert.match(fn, /setTimeout/);
  assert.match(fn, /pausedByScroll/);
});

test("theater holds playback while the rail is mid-swipe", () => {
  // The theatre's pager is a scroll container too: videos must not start
  // mid-swipe, and the centred slide resumes once the rail settles.
  const fn = app.slice(app.indexOf("function bindTheaterScrollPause"), app.indexOf("function bindTheaterDismiss"));
  assert.match(fn, /theaterScrolling = true/);
  assert.match(fn, /addEventListener\("scroll"/);
  assert.match(fn, /setTimeout/);
  assert.match(app, /&& !theaterScrolling/);
});

test("theater video uses a custom M3E control layer, not native controls", () => {
  // Native controls are turned off in the theater and replaced by a thin
  // controller (M3EVideoControls.bind) with play/pause, seek, time, mute,
  // rate, loop, PiP and resume — all built on real buttons and a real range
  // input, never a fake div slider.
  const fn = app.slice(app.indexOf("function mountSlideVideo"), app.indexOf("function bindTheaterScrollPause"));
  assert.match(fn, /controls: false/);
  assert.match(fn, /M3EVideoControls\.bind/);
  assert.match(fn, /progress: progressStore/);
  assert.match(fn, /entryId: entry\.id/);
  // The slide disposes the controller before the video element is removed.
  assert.match(app, /slide\._vcCleanup/);

  const controls = read("extension/shared/m3e/video-controls.js");
  assert.match(controls, /input/); // real range slider for seek
  assert.match(controls, /type = "range"/);
  for (const action of ["play", "mute", "loop", "rate", "pip"]) {
    assert.match(controls, new RegExp('makeButton\\("' + action + '"'), "missing control: " + action);
  }
  // Keyboard seeking is native to the range input; play/pause etc. are real
  // buttons, so Space/Enter work without a custom keymap.
  assert.match(controls, /aria-label/);
  assert.match(controls, /aria-pressed/);
});

test("theater playback position is resumed and persisted per media item", () => {
  // Resume is the flagship of the custom layer: save per entry id, throttled,
  // dropped when under ~3s watched or over ~95% complete, restored on mount
  // with a "Resumed from" hint and a "Start over" action.
  const app2 = read("extension/dashboard/app.js");
  assert.match(app2, /progress: "xbm\.progress"/);
  assert.match(app2, /const progressStore/);
  assert.match(app2, /PROGRESS_LIMIT/);

  const controls = read("extension/shared/m3e/video-controls.js");
  assert.match(controls, /SAVE_INTERVAL/);
  assert.match(controls, /RESUME_MIN/);
  assert.match(controls, /RESUME_MAX/);
  assert.match(controls, /function saveProgress/);
  assert.match(controls, /function tryResume/);
  assert.match(controls, /Resumed from/);
  assert.match(controls, /Start over/);
  assert.match(controls, /pagehide/);
});

test("theater preloads adjacent posters, never adjacent videos", () => {
  // Perceived speed without bandwidth waste: the next/previous POSTER is
  // prefetched when a slide centres; no video bytes are fetched for items
  // nobody has watched.
  const fn = app.slice(app.indexOf("const preloadAdjacentPosters"), app.indexOf("function bindTheaterScrollPause"));
  assert.match(fn, /new Image\(\)/);
  assert.match(fn, /sizedImage\(/);
  assert.match(app, /preloadAdjacentPosters\(entries, entry\.id\)/);
});

test("unplayable media stays quiet until hover or inspection", () => {
  const tile = app.slice(app.indexOf("function tileHtml"), app.indexOf("function buildRails"));
  const detail = app.slice(app.indexOf("function detailHtml"), app.indexOf("function linkify"));

  assert.doesNotMatch(tile + layout, /tile__play--dead|Not playable here/);
  assert.match(tile, /tile__status/);
  assert.match(layout, /\.tile__status[\s\S]{0,500}opacity:\s*0/);
  assert.match(layout, /\.tile:hover \.tile__status/);
  assert.match(detail, /Find on Wayback/);
  assert.match(detail, /Remove from library/);
  const feed = app.slice(app.indexOf("function bindFeed"), app.indexOf("function init()"));
  assert.match(feed, /M3EMedia\.hlsOnly\(entry\.media\)\) openDetail/);
});

/* ---------------------------------------------------------------------------
   The viewer
   --------------------------------------------------------------------------- */

test("the viewer traverses the whole library, not one post", () => {
  // This is the change that makes the product a browser rather than a list:
  // open anything, keep going, and you cross posts and authors.
  const fn = app.slice(app.indexOf("function openViewer"), app.indexOf("8 · Overlays"));
  assert.match(fn, /list\.map\(\(e\) => e\.media\)/);
  assert.match(fn, /contextAt/);
});

test("the viewer relabels itself as it crosses posts", () => {
  const lb = read("extension/dashboard/lightbox.js");
  assert.match(lb, /function ctxFor/);
  // Captured content is attacker-influenced and must never be interpolated.
  assert.match(lb, /els\.title\.textContent = /);
  assert.match(lb, /els\.subtitle\.textContent = /);
  assert.doesNotMatch(lb, /(title|subtitle)\.innerHTML\s*=/);
});

test("the filmstrip is windowed, not materialised in full", () => {
  // With a whole library loaded this can be thousands of items; building an
  // <img> for each to decorate a bottom bar costs more than the photo itself.
  // The window radius varies with thumbnail size (larger thumbs, fewer shown),
  // but the window itself stays bounded around the current index either way.
  const lb = read("extension/dashboard/lightbox.js");
  assert.match(lb, /const STRIP_RADIUS/);
  assert.match(lb, /const stripRadius = \(\) =>/);
  assert.match(lb, /Math\.max\(0, index - radius\)/);
  assert.match(lb, /Math\.min\(items\.length, index \+ radius \+ 1\)/);
});

/* ---------------------------------------------------------------------------
   Adaptive layout
   --------------------------------------------------------------------------- */

test("all three window classes are served", () => {
  for (const bp of ["600px", "1024px", "1200px"]) {
    assert.ok(layout.includes("(min-width: " + bp + ")"), "missing breakpoint " + bp);
  }
  // Compact gets a floating toolbar, not a docked bar that permanently costs
  // 80px of a surface whose value is vertical room for media.
  assert.match(html, /class="m3e-toolbar m3e-toolbar--floating nav-bar"/);
  const bar = layout.slice(layout.indexOf(".nav-bar {"), layout.indexOf(".nav-bar__fab"));
  assert.match(bar, /position:\s*fixed/);
  assert.match(bar, /data-hidden="true"/);
});

test("media keeps its own aspect ratio", () => {
  // Cropping everything square turns a media browser into a contact sheet,
  // and a contact sheet of text screenshots is unreadable.
  const tile = layout.slice(layout.indexOf(".tile {"), layout.indexOf(".tile__missing"));
  assert.match(tile, /aspect-ratio: var\(--_ar/);
  assert.match(app, /style="--_ar:' \+ ar/);
});

test("theater media fits inside the dynamic viewport", () => {
  // The available height must come from flex layout, not a guessed vh band;
  // otherwise the slide's lower edge falls below shorter desktop windows.
  assert.match(app, /document\.documentElement\.dataset\.view = state\.view/);
  assert.match(layout, /html\[data-view="theater"\] \.shell[\s\S]{0,120}block-size: 100dvh/);
  assert.match(layout, /html\[data-view="theater"\] \.feed\[data-view="theater"\][\s\S]{0,180}flex: 1 1 0/);
  assert.match(layout, /html\[data-view="theater"\] \.slide__stage[\s\S]{0,120}flex: 1 1 0/);

  const media = layout.slice(layout.indexOf(".slide__media {"), layout.indexOf(".slide__video"));
  assert.match(media, /max-block-size: 100%/);
  assert.match(media, /object-fit: contain/);
});

test("the private dashboard has no sensitive-content gate", () => {
  const tile = app.slice(app.indexOf("function tileHtml"), app.indexOf("function buildRails"));
  const theater = app.slice(app.indexOf("function theaterSlideHtml"), app.indexOf("function mountTheaterPlayers"));
  const feed = app.slice(app.indexOf("function bindFeed"), app.indexOf("function init()"));

  // Every media item renders normally and the first activation opens it.
  for (const src of [tile, theater, feed, components, layout]) {
    assert.doesNotMatch(src, /data-sensitive|data-revealed|data-reveal|tile__veil|slide__veil/);
  }
  assert.doesNotMatch(tile + theater, /m\.sensitive|possibly_sensitive/);
  assert.match(feed, /else openViewer\(entry\)/);
});

test("reduced motion is honoured by the new surfaces", () => {
  for (const [name, src] of [["components", components], ["layout", layout]]) {
    assert.ok(src.includes("prefers-reduced-motion"), name + " must respect reduced motion");
  }
  // Autoplay is motion: someone who asked the OS to stop things moving has
  // asked for exactly this.
  assert.match(app, /state\.settings\.autoplay && !M3E\.reducedMotion\(\)/);
});

test("every tile is a real button with a meaningful label", () => {
  const fn = app.slice(app.indexOf("function tileHtml"), app.indexOf("function buildRails"));
  // A tile is a role="button" container rather than a literal button so it can
  // host an inline video preview (native controls are interactive content,
  // which a button element may not contain); bindFeed supplies the Enter/Space
  // activation the role promises.
  assert.match(fn, /role="button"/);
  assert.match(fn, /tabindex="0"/);
  // Not "image": the label leads with the ACTION, then the subject, then the
  // source, because a screen-reader user decides whether to keep listening
  // during the first few words.
  assert.match(fn, /const label = \(unplayable \? "Inspect " : motion \? "Play " : "Open "\) \+ what \+ " by " \+ who/);
  // Alt text falls back to the post's own words, which usually describe the
  // picture better than any generic string.
  assert.match(fn, /m\.alt \|\| \(item\.text/);
});

/* ---------------------------------------------------------------------------
   Performance guards
   --------------------------------------------------------------------------- */

test("the feed uses one delegated listener, not one per tile", () => {
  // Several hundred tiles are recreated on every keystroke of the search box;
  // per-tile handlers would mean a thousand closures per render.
  const fn = app.slice(app.indexOf("function bindFeed"), app.indexOf("function init()"));
  const listeners = fn.match(/feed\.addEventListener/g) || [];
  assert.ok(listeners.length >= 3, "expected delegated listeners on the feed");
  assert.doesNotMatch(fn, /querySelectorAll\("\.tile"\)[\s\S]{0,80}addEventListener/);
});

test("a render disposes of what the previous render owned", () => {
  // Observers and carousel controllers hold references to detached nodes and
  // keep firing for the life of the page otherwise.
  const fn = app.slice(app.indexOf("function render()"), app.indexOf("function showSkeletons"));
  assert.match(fn, /carousels\.pop\(\)/);
  assert.match(fn, /virtualGrid\.destroy\(\)/);
  assert.match(fn, /autoplayer\.disconnect\(\)/);
  assert.match(fn, /M3EMedia\.stopAll\(\)/);
});

/* ---------------------------------------------------------------------------
   State that must survive
   --------------------------------------------------------------------------- */

test("selection survives crossing the inspector breakpoint, both ways", () => {
  // The previous build closed the pane on the way down and did not reopen the
  // sheet, so resizing a window mid-read silently lost your place. The content
  // is identical in both containers; only the container changes.
  const fn = app.slice(app.indexOf("const rehostInspector"), app.indexOf("M3E.bindScrollChrome"));
  assert.match(fn, /if \(!state\.selectedId\) return;/);
  assert.match(fn, /min-width: 1024px/);
  assert.match(fn, /if \(!paneShowing\) openDetail\(state\.selectedId\);/);
  assert.match(fn, /clearDetailPaneOnly\(\);\s*\n\s*openDetail\(state\.selectedId\)/);
});

test("every empty state names its collection and offers a way out", () => {
  // An empty state that only reports absence is a dead end, and the useful
  // next action differs per destination — so a generic string cannot do it.
  const fn = app.slice(app.indexOf("function emptyStateHtml"), app.indexOf("The render entry point"));
  for (const collection of ["recent", "archived", "video", "photos"]) {
    assert.match(fn, new RegExp("\\b" + collection + ":\\s*\\{"), "no empty state for " + collection);
  }
  // Each carries a glyph, a title, a body and an optional action.
  for (const key of ["icon", "title", "body", "action"]) {
    assert.match(fn, new RegExp("\\b" + key + ":"), "empty states must define " + key);
  }
  // And the actions those states offer must actually be handled.
  const handler = app.slice(app.indexOf('const what = empty.dataset.empty'), app.indexOf("Theater controls"));
  for (const action of ["import", "clear", "all"]) {
    assert.match(handler, new RegExp('"' + action + '"'), "unhandled empty-state action: " + action);
  }
});

test("archived media is reachable only from the archive collection", () => {
  // Archiving must actually hide something, or the action is decorative.
  const fn = app.slice(app.indexOf("function matchesCollection"), app.indexOf("function matchesPost"));
  assert.match(fn, /state\.collection === "archived"\) return m\.active === false;/);
  assert.match(fn, /return m\.active !== false;/);
});

test("the view choice and the shuffle seed round-trip through the URL", () => {
  // A copied link must reproduce exactly what the sender was looking at.
  assert.match(app, /if \(state\.view !== "rails"\) p\.set\("v", state\.view\)/);
  assert.match(app, /if \(isShuffle\(\)\) p\.set\("seed", state\.shuffleSeed\)/);
  assert.match(app, /if \(v && VIEWS\.includes\(v\)\) state\.view = v/);
  assert.match(app, /if \(seed && \/\^\[0-9\]\{1,10\}\$\/\.test\(seed\)\) state\.shuffleSeed = seed/);
});

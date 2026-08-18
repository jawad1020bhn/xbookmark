/**
 * Lightbox + extension-bridge invariants.
 *
 * These two features are mostly DOM behaviour, which is verified by driving a
 * real browser. What is pinned here is the part that silently rots: the
 * layering contract, the permission boundary, and the mirror that lets the
 * dashboard run as an extension page at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/* ---------------------------------------------------------------------------
   Lightbox
   --------------------------------------------------------------------------- */

test("the viewer respects the autoplay and reduced-motion settings", () => {
  // Opening the viewer must not bypass the user's playback preferences:
  // autoplay-off or reduced motion must mean a paused video with controls.
  const app = read("extension/dashboard/app.js");
  assert.match(app, /autoplay: state\.settings\.autoplay && !M3E\.reducedMotion\(\)/);
  const lb = read("extension/dashboard/lightbox.js");
  assert.match(lb, /autoplay = context\.autoplay !== false;/);
  assert.match(lb, /autoplay,/);
});

test("resume progress is backed up, restored and cleared", () => {
  const app = read("extension/dashboard/app.js");
  // Backups carry the resume positions...
  assert.match(app, /progress: state\.progress,/);
  // ...restores apply them (bounded by the same limit as live writes)...
  assert.match(app, /const fileProgress = parsed && !Array\.isArray\(parsed\) \? parsed\.progress : null;/);
  assert.match(app, /Object\.entries\(fileProgress\)\.slice\(0, PROGRESS_LIMIT\)/);
  // ...and clearing the library clears them too, or "resume" would point at
  // videos that no longer exist.
  assert.match(app, /state\.items = \[\]; state\.meta = \{\}; state\.progress = \{\};/);
});

test("the lightbox sits above every other layer", () => {
  const tokens = read("extension/shared/m3e/tokens.css");
  const layout = read("extension/dashboard/layout.css");

  // The viewer replaces the screen, so it must outrank the snackbar too — a
  // toast floating over a full-bleed photo is illegible and unreachable.
  const z = (name) => {
    const m = tokens.match(new RegExp("--md-sys-z-" + name + ":\\s*(\\d+)"));
    assert.ok(m, "missing z token: " + name);
    return Number(m[1]);
  };
  assert.ok(z("immersive") > z("snackbar"));
  assert.ok(z("snackbar") > z("modal"));
  assert.ok(z("modal") > z("scrim"));
  assert.ok(z("scrim") > z("sticky"));

  // And it must use the token rather than a hand-picked number — the original
  // bug was a hardcoded `z-index: 60`, which lost to the sticky chrome at 100.
  const lb = layout.slice(layout.indexOf(".lb {"), layout.indexOf(".lb__bar"));
  assert.match(lb, /z-index:\s*var\(--md-sys-z-immersive\)/);
});

test("the custom keyboard shortcut system is absent", () => {
  const lightbox = read("extension/dashboard/lightbox.js");
  const app = read("extension/dashboard/app.js");
  const html = read("extension/dashboard/index.html");
  // No bespoke global shortcut layer anywhere: nothing maps keys like "/" or
  // "i" to actions, and the lightbox owns no key handling of its own (it uses
  // the shared carousel/escape primitives).
  assert.doesNotMatch(lightbox, /addEventListener\("keydown"|event\.key/);
  assert.doesNotMatch(app, /bindGlobalKeys/);
  assert.doesNotMatch(app, /(key|code)\s*===\s*["'][a-z][^"']*["']/i);
  assert.doesNotMatch(html, /<kbd|Press slash|Press i/);
  // The one keydown app.js does own is button-role activation for tiles
  // (Enter/Space), which is semantics a role=button element is owed, not a
  // shortcut system.
  assert.match(app, /event\.key !== "Enter" && event\.key !== " "/);
});

test("the UI copy promises no keyboard shortcuts", () => {
  // Hints must never tell the user to press a key, because the keys would not
  // do anything. "Esc exits" in the theater is a true statement about a real
  // affordance; "press / to search" would be a lie.
  const html = read("extension/dashboard/index.html");
  assert.doesNotMatch(html, /[Pp]ress\s+[isvz/](?![a-z])/);
  assert.doesNotMatch(html, /\bslash\b/);
  assert.doesNotMatch(html, /<kbd/);
  assert.doesNotMatch(html, /shortcut/i);
});

test("modal Escape remains owned by the shared overlay primitive", () => {
  const interactions = read("extension/shared/m3e/interactions.js");
  const overlay = interactions.slice(interactions.indexOf("function createOverlay"), interactions.indexOf("Snackbar queue"));
  assert.match(overlay, /event\.key === "Escape"/);
  assert.match(overlay, /event\.stopPropagation\(\); close\(\)/);
});

test("the lightbox escapes user content rather than interpolating it", () => {
  const src = read("extension/dashboard/lightbox.js");
  // Captions and alt text come from captured posts and are attacker-influenced.
  assert.match(src, /els\.caption\.textContent = /);
  assert.doesNotMatch(src, /caption\.innerHTML\s*=\s*[^"']*(alt|caption)/i);
});

test("the lightbox has a jump surface that scales to large sets", () => {
  // Traversing hundreds or thousands of items needs more than a filmstrip:
  // a windowed grid overview, a numeric jump, faster filmstrip scrubbing, and
  // an optional larger thumbnail size.
  const src = read("extension/dashboard/lightbox.js");
  const layout = read("extension/dashboard/layout.css");

  // Grid overview drawer — windowed, like the filmstrip, so it never
  // materialises a thousand <img> elements.
  assert.match(src, /function openOverview/);
  assert.match(src, /function paintOverview/);
  assert.match(src, /lb__overview-cell/);
  assert.match(layout, /\.lb__overview\s*\{/);

  // Jump to a position by number, with Enter handled by the form's submit
  // (not a bespoke key handler).
  assert.match(src, /function jumpFromInput/);
  assert.match(src, /lbJumpInput/);

  // Filmstrip traversal: drag scrubbing plus the shared carousel controller
  // (wheel translation and arrow keys live in shared/m3e, not here).
  assert.match(src, /function bindStripScrub/);
  assert.match(src, /M3E\.bindCarousel\(els\.strip/);

  // Optional larger filmstrip thumbnails.
  assert.match(src, /function toggleStripSize/);
  assert.match(layout, /\.lb\[data-strip="large"\] \.lb__frame/);
});

/* ---------------------------------------------------------------------------
   Extension bridge
   --------------------------------------------------------------------------- */

test("the bridge degrades to a no-op outside the extension", () => {
  const src = read("extension/dashboard/bridge.js");
  // `chrome` exists in plain Chromium pages; `chrome.runtime.id` does not.
  assert.match(src, /chrome\.runtime\.id/);
  for (const fn of ["read", "pull", "deadLetters"]) {
    assert.ok(new RegExp("(async function|function) " + fn + "\\b").test(src), fn + " missing");
  }
  assert.match(src, /if \(!hasChrome\) return/);
});

test("no new permissions were added for the capture bridge", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  assert.deepEqual(manifest.permissions.sort(), ["downloads", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://x.com/*"]);

  // Filtering tabs.query by URL would require the "tabs" permission, which
  // Chrome shows as "read your browsing history" — unacceptable here, and
  // unnecessary: getContexts only reports the extension's own pages.
  // Comments are stripped first: this file *explains* why tabs.query({url}) is
  // avoided, and a blunt search would match the explanation.
  const popup = read("extension/popup.js")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(popup, /tabs\.query\(\s*\{[^}]*url/);
  assert.match(popup, /runtime\.getContexts/);
});

test("the dashboard is mirrored into the extension, without the sample data", () => {
  for (const f of ["index.html", "app.js", "layout.css", "bridge.js", "lightbox.js", "lenses.js"]) {
    assert.ok(existsSync(join(root, "extension/dashboard", f)), "missing mirror: " + f);
  }
  // 1.3 MB of demo media must not ship inside the extension package.
  assert.ok(!existsSync(join(root, "extension/dashboard/sample-media")));
  assert.ok(!existsSync(join(root, "extension/dashboard/bookmarks.json")));

  // The mirror is generated; editing it directly would be silently overwritten.
  assert.match(read("extension/dashboard/app.js").slice(0, 200), /AUTO-GENERATED/);
  // HTML cannot carry a /* */ banner before its doctype.
  assert.match(read("extension/dashboard/index.html").slice(0, 200), /<!--\s*AUTO-GENERATED/);
});

test("relative asset paths resolve from the dashboard page", () => {
  // Every ../shared/... reference from extension/dashboard/ must resolve to a
  // file inside the package, or the surface breaks in Chrome.
  const html = read("extension/dashboard/index.html");
  for (const m of html.matchAll(/(?:src|href)="(\.\.\/[^"]+)"/g)) {
    const fromExt = join(root, "extension/dashboard", m[1]);
    assert.ok(existsSync(fromExt), "missing in extension: " + m[1]);
  }
});

test("the theater player module is loaded before the app", () => {
  // The theater mounts videos with `controls: false` and relies on
  // window.M3EVideoControls for operation. If the script were ever dropped
  // from index.html (or reordered after app.js), every theater video would
  // mount with no controls at all — a silent, total loss of playback.
  const html = read("extension/dashboard/index.html");
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const vc = scripts.findIndex((s) => s.includes("video-controls.js"));
  const app = scripts.findIndex((s) => s.endsWith("app.js"));
  assert.ok(vc > -1, "video-controls.js must be included in index.html");
  assert.ok(app > -1, "app.js must be included in index.html");
  assert.ok(vc < app, "video-controls.js must load before app.js");

  // And the module itself must expose the API the app calls.
  const controls = read("extension/shared/m3e/video-controls.js");
  assert.match(controls, /M3EVideoControls\s*=\s*factory\(\)/);
  assert.match(controls, /function bind\(video, options\)/);
  assert.match(controls, /function cleanup\(\)/);
});

test("the sample library is not fetched inside the extension", () => {
  // It isn't mirrored, so the fetch would 404 on every extension start.
  const app = read("extension/dashboard/app.js");
  const seed = app.slice(app.indexOf("seed with the sample file"), app.indexOf('fetch("bookmarks.json")'));
  assert.match(seed, /XBridge && XBridge\.available/);
});

test("captured posts reach the dashboard through the normal import path", () => {
  // The bridge must not invent a second normalisation path; scraper output has
  // to go through `normalize` + `merge` exactly as an imported file does.
  const app = read("extension/dashboard/app.js");
  const fn = app.slice(app.indexOf("async function importFromExtension"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /XBridge\.pull\(\)/);
  assert.match(body, /normalize\(rows\)/);
  assert.match(body, /merge\(items\)/);
  assert.match(body, /saveItems\(\)/);
});

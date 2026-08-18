/**
 * Smart lenses — computed collections, never filed into.
 *
 * The brief is organisation without tagging. These tests pin three things:
 *   1. the predicates themselves (so "portrait" cannot quietly start
 *      matching landscape video);
 *   2. that the dashboard treats them as destinations over the media
 *      index, not as a new tag store;
 *   3. that every lens is reachable, empty-stated, and URL-addressable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const require = createRequire(import.meta.url);
const Lenses = require(join(root, "extension/dashboard/lenses.js"));

const app = read("extension/dashboard/app.js");
const html = read("extension/dashboard/index.html");

const now = Date.UTC(2026, 7, 18);
const day = 864e5;

const photo = (over) => Object.assign({ type: "photo", aspect: 1, alt: null, duration: 0, position: 1 }, over);
const video = (over) => Object.assign({ type: "video", aspect: 16 / 9, alt: null, duration: 0, position: 1 }, over);
const item = (over) => Object.assign({ likes: 0, replies: 0, views: 0, _ts: now - 90 * day, _seen: now - 90 * day }, over);

const ctx = (over) => Object.assign({ now, openedAt: null, cutoff: 10, progress: null }, over);

/* ---------------------------------------------------------------------------
   Predicates
   --------------------------------------------------------------------------- */

test("unseen is the complement of opened, not a stored flag", () => {
  assert.equal(Lenses.matches("unseen", photo(), item(), ctx({ openedAt: null })), true);
  assert.equal(Lenses.matches("unseen", photo(), item(), ctx({ openedAt: "2026-08-01T00:00:00Z" })), false);
  assert.equal(Lenses.matches("recent", photo(), item(), ctx({ openedAt: null })), false);
  assert.equal(Lenses.matches("recent", photo(), item(), ctx({ openedAt: "2026-08-01T00:00:00Z" })), true);
});

test("recently captured is a two-week window on first_seen, not posted date", () => {
  const fresh = item({ _seen: now - 3 * day, _ts: now - 400 * day });
  const stale = item({ _seen: now - 20 * day, _ts: now - 1 * day });
  const missing = item({ _seen: 0 });
  assert.equal(Lenses.matches("captured", photo(), fresh, ctx()), true);
  assert.equal(Lenses.matches("captured", photo(), stale, ctx()), false);
  assert.equal(Lenses.matches("captured", photo(), missing, ctx()), false);
  assert.equal(Lenses.CAPTURED_WINDOW_MS, 14 * day);
});

test("high engagement uses the same rate as the sort, at the 75th percentile", () => {
  assert.equal(Lenses.engagementScore({ likes: 400, replies: 50, views: 5000 }), ((400 + 100) / 5000) * 1000);
  assert.equal(Lenses.engagementScore({ likes: 12, replies: 0, views: 0 }), 12);

  const cutoff = Lenses.engagementCutoff([1, 2, 3, 100]);
  assert.equal(cutoff, 100);
  assert.equal(Lenses.engagementCutoff([0, 0, 0, 0]), 1);
  assert.equal(Lenses.engagementCutoff([]), Number.POSITIVE_INFINITY);

  const hit = item({ likes: 400, replies: 50, views: 5000 });
  const miss = item({ likes: 1, replies: 0, views: 10000 });
  assert.equal(Lenses.matches("engagement", photo(), hit, ctx({ cutoff: 10 })), true);
  assert.equal(Lenses.matches("engagement", photo(), miss, ctx({ cutoff: 10 })), false);
});

test("long videos are videos of 30s or more, never stills or short clips", () => {
  assert.equal(Lenses.matches("long", video({ duration: 30000 }), item(), ctx()), true);
  assert.equal(Lenses.matches("long", video({ duration: 29999 }), item(), ctx()), false);
  assert.equal(Lenses.matches("long", photo({ duration: 60000 }), item(), ctx()), false);
  assert.equal(Lenses.matches("long", { type: "animated_gif", duration: 60000 }, item(), ctx()), false);
});

test("portrait and wide are still-only and use unclamped aspect", () => {
  assert.equal(Lenses.matches("portrait", photo({ aspect: 0.56 }), item(), ctx()), true);
  assert.equal(Lenses.matches("portrait", photo({ aspect: 1 }), item(), ctx()), false);
  assert.equal(Lenses.matches("portrait", video({ aspect: 0.56 }), item(), ctx()), false);
  assert.equal(Lenses.matches("wide", photo({ aspect: 2.4 }), item(), ctx()), true);
  assert.equal(Lenses.matches("wide", photo({ aspect: 1.2 }), item(), ctx()), false);
  assert.equal(Lenses.matches("wide", video({ aspect: 2.4 }), item(), ctx()), false);
  // Dimensions stand in when aspect is missing.
  assert.equal(Lenses.mediaAspect({ width: 1080, height: 1920 }), 1080 / 1920);
});

test("alt text requires a captured caption, not the tweet body fallback", () => {
  assert.equal(Lenses.matches("alt", photo({ alt: "a cat" }), item(), ctx()), true);
  assert.equal(Lenses.matches("alt", photo({ alt: "   " }), item(), ctx()), false);
  assert.equal(Lenses.matches("alt", photo({ alt: null }), item(), ctx()), false);
});

test("forgotten gems are old and idle, regardless of whether they were ever opened", () => {
  const old = item({ _ts: now - 40 * day });
  const young = item({ _ts: now - 10 * day });
  assert.equal(Lenses.matches("forgotten", photo(), old, ctx({ openedAt: null })), true);
  assert.equal(Lenses.matches("forgotten", photo(), old, ctx({ openedAt: new Date(now - 70 * day).toISOString() })), true);
  assert.equal(Lenses.matches("forgotten", photo(), old, ctx({ openedAt: new Date(now - 5 * day).toISOString() })), false);
  assert.equal(Lenses.matches("forgotten", photo(), young, ctx({ openedAt: null })), false);
});

test("gifs and resume are media-level, not post-level", () => {
  assert.equal(Lenses.matches("gifs", { type: "animated_gif" }, item(), ctx()), true);
  assert.equal(Lenses.matches("gifs", video(), item(), ctx()), false);
  assert.equal(Lenses.matches("gifs", photo(), item(), ctx()), false);

  assert.equal(Lenses.matches("resume", video(), item(), ctx({ progress: { t: 12 } })), true);
  assert.equal(Lenses.matches("resume", video(), item(), ctx({ progress: { t: 0 } })), false);
  assert.equal(Lenses.matches("resume", video(), item(), ctx({ progress: null })), false);
});

test("unknown and browse destinations do not invent a filter", () => {
  assert.equal(Lenses.matches("all", photo(), item(), ctx()), true);
  assert.equal(Lenses.matches("archived", video(), item(), ctx()), true);
  assert.equal(Lenses.matches("not-a-lens", photo(), item(), ctx()), true);
});

/* ---------------------------------------------------------------------------
   Wiring — destinations, not a filing cabinet
   --------------------------------------------------------------------------- */

test("every smart lens is a destination with a matcher, an icon and an empty state", () => {
  const block = app.slice(app.indexOf("const COLLECTIONS = ["), app.indexOf("const BROWSE_COLLECTIONS"));
  const ids = [...block.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
  const lenses = [...block.matchAll(/id:\s*"([a-z]+)"[^\}]*kind:\s*"lens"/g)].map((m) => m[1]);

  assert.ok(lenses.length >= 8, "expected the smart-lens set, got " + lenses.join(", "));
  for (const required of ["unseen", "captured", "engagement", "long", "portrait", "alt", "forgotten"]) {
    assert.ok(lenses.includes(required), "missing lens: " + required);
  }
  assert.equal(new Set(ids).size, ids.length, "duplicate collection id");

  const empty = app.slice(app.indexOf("function emptyStateHtml"), app.indexOf("The render entry point"));
  for (const id of lenses) {
    assert.match(empty, new RegExp("\\b" + id + ":\\s*\\{"), "no empty state for " + id);
    assert.match(block, new RegExp('id: "' + id + '"[^\\n]*icon: "[a-z]+"'), "lens needs an icon: " + id);
  }
});

test("smart lenses are computed, never stored as tags", () => {
  for (const src of [app, html, read("extension/dashboard/lenses.js")]) {
    assert.doesNotMatch(src, /promptTag|data-untag|chipTagged|tags:\s*\[\]/);
  }
  assert.doesNotMatch(app, /"unread"/);
  // No new persistence key — openedAt and progress already existed.
  assert.doesNotMatch(app, /xbm\.lenses|xbm\.tags|KEYS\.lenses/);
});

test("archive membership is still decided at the post, not by a lens", () => {
  const fn = app.slice(app.indexOf("function matchesCollection"), app.indexOf("function matchesPost"));
  assert.match(fn, /state\.collection === "archived"\) return m\.active === false;/);
  assert.match(fn, /return m\.active !== false;/);
});

test("lens matching is applied per media item", () => {
  const fn = app.slice(app.indexOf("function matchesMedia"), app.indexOf("function mediaIndex"));
  assert.match(fn, /matchesSmartLens\(media, item\)/);
  assert.match(fn, /state\.collection === "video" && isPhoto\(media\)/);
  assert.match(fn, /state\.collection === "photos" && !isPhoto\(media\)/);
});

test("the compact bar still has four browse destinations, not fourteen lenses", () => {
  const fn = app.slice(app.indexOf("function renderNav"), app.indexOf("function scrollFeedTop"));
  assert.match(fn, /BROWSE_COLLECTIONS\.slice\(0, 4\)/);
  assert.match(fn, /SMART_LENSES\.map/);
  assert.match(fn, /rail__group--lenses/);
});

test("the title opens a destination picker so compact can reach every lens", () => {
  assert.match(html, /id="paneDestination"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(app, /function openDestinationPicker/);
  assert.match(app, /data-pick-collection/);
  assert.match(app, /Smart lenses are computed from what you saved/);
  const bind = app.slice(app.indexOf("function bindEvents"), app.lastIndexOf("bindFeed();"));
  assert.match(bind, /paneDestination/);
  assert.match(bind, /openDestinationPicker/);
});

test("a copied URL can address a smart lens", () => {
  assert.match(app, /if \(state\.collection !== "all"\) p\.set\("c", state\.collection\)/);
  assert.match(app, /if \(c && COLLECTIONS\.some\(\(x\) => x\.id === c\)\) state\.collection = c/);
});

test("lenses.js is a real module and loads before the app", () => {
  assert.ok(existsSync(join(root, "extension/dashboard/lenses.js")));
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const lenses = scripts.findIndex((s) => s.endsWith("lenses.js"));
  const appSrc = scripts.findIndex((s) => s.endsWith("app.js"));
  assert.ok(lenses > -1, "lenses.js must be included");
  assert.ok(lenses < appSrc, "lenses.js must load before app.js");
});

test("All-view rails can surface Unseen without turning it into a folder", () => {
  const fn = app.slice(app.indexOf("function buildRails"), app.indexOf("function railHtml"));
  assert.match(fn, /state\.collection === "all"/);
  assert.match(fn, /lens: "unseen"/);
  assert.match(app, /data-rail-lens/);
  assert.match(app, /selectCollection\(btn\.dataset\.railLens\)/);
});

/**
 * Media behaviour.
 *
 * The bug this suite exists to prevent: the dashboard's normalizer used to
 * drop `hls`, `width` and `height` while copying media objects, so HLS-only
 * videos could never play and every image caused layout shift. That failure
 * was invisible — no error, no warning, just missing capability. These tests
 * assert the fields survive and that the source-selection logic is honest
 * about what a browser can actually play.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load shared/m3e/media.js in isolation, with a stubbed DOM. */
function loadMedia({ canPlayHls = "", userAgent = "" } = {}) {
  const sandbox = {
    module: { exports: {} },
    navigator: { userAgent },
    document: {
      createElement: () => ({
        canPlayType: (t) => (/mpegurl/i.test(t) ? canPlayHls : "maybe"),
      }),
    },
    URL,
  };
  sandbox.self = sandbox;
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(root, "extension/shared/m3e/media.js"), "utf8"), sandbox);
  return sandbox.module.exports;
}

/* ---------------------------------------------------------------------------
   Source selection
   --------------------------------------------------------------------------- */

test("mp4 is preferred over hls, everywhere", () => {
  const m = loadMedia({ canPlayHls: "maybe", userAgent: "Safari/605" });
  // Compared field-by-field: the module runs in its own vm realm, so its
  // objects never satisfy a prototype-sensitive deep equality check.
  const got = m.playableSource({ type: "video", mp4: "a.mp4", hls: "a.m3u8" });
  assert.equal(got.src, "a.mp4");
  assert.equal(got.kind, "mp4");
});

test("hls is used only where the browser truly supports it", () => {
  const safari = loadMedia({
    canPlayHls: "maybe",
    userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
  });
  const got = safari.playableSource({ type: "video", hls: "a.m3u8" });
  assert.equal(got.src, "a.m3u8");
  assert.equal(got.kind, "hls");

  // Firefox never claims HLS support.
  const firefox = loadMedia({ canPlayHls: "", userAgent: "Mozilla/5.0 Gecko/20100101 Firefox/130.0" });
  assert.equal(firefox.playableSource({ type: "video", hls: "a.m3u8" }), null);
});

test("Chromium's false 'maybe' for HLS is not believed", () => {
  // Verified against a real Chromium build: it answers "maybe" to both HLS
  // mime types and then fails to play the playlist. Trusting canPlayType here
  // would render a play button that leads to a dead player.
  for (const ua of [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 OPR/120.0",
  ]) {
    const m = loadMedia({ canPlayHls: "maybe", userAgent: ua });
    assert.equal(m.supportsNativeHls(), false, ua);
    assert.equal(m.playableSource({ type: "video", hls: "a.m3u8" }), null);
    assert.equal(m.hlsOnly({ type: "video", hls: "a.m3u8" }), true);
  }
});

test("hlsOnly flags exactly the unplayable case", () => {
  const m = loadMedia({ canPlayHls: "", userAgent: "Chrome/140" });
  assert.equal(m.hlsOnly({ type: "video", hls: "a.m3u8" }), true);
  assert.equal(m.hlsOnly({ type: "video", mp4: "a.mp4", hls: "a.m3u8" }), false);
  assert.equal(m.hlsOnly({ type: "photo", url: "a.jpg" }), false);
});

/* ---------------------------------------------------------------------------
   Presentation
   --------------------------------------------------------------------------- */

test("aspect ratio falls back through stored, intrinsic, then 16:9", () => {
  const m = loadMedia();
  assert.equal(Number(m.aspectRatio({ aspect: 1.5 })), 1.5);
  assert.equal(Number(m.aspectRatio({ width: 1200, height: 600 })), 2);
  assert.equal(Number(m.aspectRatio({})), 16 / 9);
  // Freak dimensions are clamped so one item cannot wreck a row.
  assert.equal(Number(m.aspectRatio({ aspect: 40 })), 3);
  assert.equal(Number(m.aspectRatio({ aspect: 0.01 })), 0.5);
  assert.equal(Number(m.aspectRatio({ aspect: -5 })), 16 / 9);
});

test("durations format as X's own do", () => {
  const m = loadMedia();
  assert.equal(m.formatDuration(15000), "0:15");
  assert.equal(m.formatDuration(730000), "12:10");
  assert.equal(m.formatDuration(3753000), "1:02:33");
  assert.equal(m.formatDuration(0), "");
  assert.equal(m.formatDuration(null), "");
});

test("CDN resizing applies to X images only, and never rewrites others", () => {
  const m = loadMedia();
  assert.equal(
    m.sizedImage("https://pbs.twimg.com/media/abc.jpg", "small"),
    "https://pbs.twimg.com/media/abc.jpg?format=webp&name=small"
  );
  // Local sample media and third-party hosts pass through untouched.
  assert.equal(m.sizedImage("sample-media/a.jpg", "small"), "sample-media/a.jpg");
  assert.equal(m.sizedImage("https://example.com/a.jpg", "small"), "https://example.com/a.jpg");
  assert.equal(m.sizedImage(null, "small"), null);
});

test("badges distinguish gif, video and photo", () => {
  const m = loadMedia();
  assert.equal(m.badgeFor({ type: "animated_gif" }), "GIF");
  assert.equal(m.badgeFor({ type: "video", duration: 15000 }), "0:15");
  assert.equal(m.badgeFor({ type: "video" }), "VIDEO");
  assert.equal(m.badgeFor({ type: "photo" }), "");
});

/* ---------------------------------------------------------------------------
   The regression itself
   --------------------------------------------------------------------------- */

test("the dashboard normalizer preserves every field playback depends on", () => {
  const src = readFileSync(join(root, "extension/dashboard/app.js"), "utf8");
  const fn = src.slice(src.indexOf("function normalizeMedia"), src.indexOf("function normalizeItem"));
  for (const field of ["hls", "width", "height", "poster", "mp4Variants", "aspect"]) {
    // Either `field:` or ES6 shorthand `field,`.
    assert.ok(new RegExp("\\b" + field + "\\s*[:,]").test(fn), "normalizeMedia must emit " + field);
  }
  // A video with no still is still worth keeping if it has something playable.
  assert.ok(/\.filter\(\(m\) => m\.url \|\| m\.mp4 \|\| m\.hls\)/.test(fn));
});

test("media urls may be relative, but never a foreign scheme", () => {
  const src = readFileSync(join(root, "extension/dashboard/app.js"), "utf8");
  const line = src.match(/const safeMediaUrl[\s\S]*?\n  \};/)[0];
  const safeMediaUrl = new Function("return " + line.replace(/^const safeMediaUrl = /, "").replace(/;$/, ""))();

  assert.equal(safeMediaUrl("https://pbs.twimg.com/a.jpg"), "https://pbs.twimg.com/a.jpg");
  assert.equal(safeMediaUrl("sample-media/a.jpg"), "sample-media/a.jpg");
  // These must never reach an src attribute.
  assert.equal(safeMediaUrl("javascript:alert(1)"), null);
  assert.equal(safeMediaUrl("JavaScript:alert(1)"), null);
  assert.equal(safeMediaUrl("data:text/html,<script>"), null);
  assert.equal(safeMediaUrl("//evil.example.com/a.jpg"), null);
  assert.equal(safeMediaUrl(""), null);
  assert.equal(safeMediaUrl(null), null);
});

test("an exported file re-imports with its media intact", () => {
  // The dashboard persists and exports media under `media`, but the scraper
  // emits `media_items`. Reading only the latter meant a file exported from
  // the dashboard re-imported with every image and video silently gone.
  const src = readFileSync(join(root, "extension/dashboard/app.js"), "utf8");
  assert.match(src, /normalizeMedia\(b\.media_items \|\| b\.media\)/);
});

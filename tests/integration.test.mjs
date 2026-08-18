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

test("the lightbox sits above every other layer", () => {
  const tokens = read("shared/m3e/tokens.css");
  const layout = read("dashboard/layout.css");

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
  const lightbox = read("dashboard/lightbox.js");
  const app = read("dashboard/app.js");
  const html = read("dashboard/index.html");
  assert.doesNotMatch(lightbox, /addEventListener\("keydown"|event\.key/);
  assert.doesNotMatch(app, /bindGlobalKeys|event\.key/);
  assert.doesNotMatch(html, /<kbd|Press slash|Press i/);
});

test("modal Escape remains owned by the shared overlay primitive", () => {
  const interactions = read("shared/m3e/interactions.js");
  const overlay = interactions.slice(interactions.indexOf("function createOverlay"), interactions.indexOf("Snackbar queue"));
  assert.match(overlay, /event\.key === "Escape"/);
  assert.match(overlay, /event\.stopPropagation\(\); close\(\)/);
});

test("the lightbox escapes user content rather than interpolating it", () => {
  const src = read("dashboard/lightbox.js");
  // Captions and alt text come from captured posts and are attacker-influenced.
  assert.match(src, /els\.caption\.textContent = /);
  assert.doesNotMatch(src, /caption\.innerHTML\s*=\s*[^"']*(alt|caption)/i);
});

/* ---------------------------------------------------------------------------
   Extension bridge
   --------------------------------------------------------------------------- */

test("the bridge degrades to a no-op outside the extension", () => {
  const src = read("dashboard/bridge.js");
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
  for (const f of ["index.html", "app.js", "layout.css", "bridge.js", "lightbox.js"]) {
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

test("relative asset paths resolve in both locations", () => {
  // dashboard/../shared/ works from the repo AND from extension/dashboard/,
  // which is the whole reason the mirror can be a straight copy.
  const html = read("dashboard/index.html");
  for (const m of html.matchAll(/(?:src|href)="(\.\.\/[^"]+)"/g)) {
    const fromRepo = join(root, "dashboard", m[1]);
    const fromExt = join(root, "extension/dashboard", m[1]);
    assert.ok(existsSync(fromRepo), "missing in repo: " + m[1]);
    assert.ok(existsSync(fromExt), "missing in extension: " + m[1]);
  }
});

test("the sample library is not fetched inside the extension", () => {
  // It isn't mirrored, so the fetch would 404 on every extension start.
  const app = read("dashboard/app.js");
  const seed = app.slice(app.indexOf("seed with the sample file"), app.indexOf('fetch("bookmarks.json")'));
  assert.match(seed, /XBridge && XBridge\.available/);
});

test("captured posts reach the dashboard through the normal import path", () => {
  // The bridge must not invent a second normalisation path; scraper output has
  // to go through `normalize` + `merge` exactly as an imported file does.
  const app = read("dashboard/app.js");
  const fn = app.slice(app.indexOf("async function importFromExtension"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  assert.match(body, /XBridge\.pull\(\)/);
  assert.match(body, /normalize\(rows\)/);
  assert.match(body, /merge\(items\)/);
  assert.match(body, /saveItems\(\)/);
});

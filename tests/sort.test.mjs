/**
 * Sort behaviour.
 *
 * The comparators are pure functions of item fields, so they are exercised
 * directly here. What matters most is the shuffle: it has to be random
 * *between* sessions and perfectly stable *within* one, and those two
 * requirements pull in opposite directions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "dashboard/app.js"), "utf8");

/** Lift a top-level helper out of app.js so it can be tested in isolation. */
function lift(name) {
  const start = app.indexOf("function " + name + "(");
  assert.ok(start > -1, "missing function: " + name);
  let depth = 0, i = app.indexOf("{", start);
  const from = i;
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) break;
  }
  return new Function("return function " + name + app.slice(start + ("function " + name).length, from) + app.slice(from, i + 1))();
}

const hashSeed = lift("hashSeed");
const rng = lift("rng");

/* ---------------------------------------------------------------------------
   The PRNG
   --------------------------------------------------------------------------- */

test("the seeded PRNG is deterministic and well distributed", () => {
  // Same seed, same sequence — this is what makes a shuffle reproducible
  // from a URL.
  const a = rng(12345), b = rng(12345);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());

  // Different seeds diverge.
  assert.notEqual(rng(1)(), rng(2)());

  // Uniform enough that a shuffle doesn't visibly clump.
  const draw = rng(99);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) {
    const v = draw();
    assert.ok(v >= 0 && v < 1, "out of range: " + v);
    buckets[Math.floor(v * 10)]++;
  }
  for (const n of buckets) assert.ok(n > 1500 && n < 2500, "skewed distribution: " + buckets.join(","));
});

test("hashSeed spreads similar ids apart", () => {
  // Tweet ids are sequential, so a weak hash would order the shuffle by id.
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(hashSeed("190100000000000" + i + ":42"));
  assert.equal(seen.size, 500, "hash collisions across sequential ids");

  const a = rng(hashSeed("1901000000000001:42"))();
  const b = rng(hashSeed("1901000000000002:42"))();
  assert.ok(Math.abs(a - b) > 0.01, "adjacent ids produced adjacent scores");
});

test("a shuffle is stable for one seed and re-deals for another", () => {
  const ids = Array.from({ length: 40 }, (_, i) => "19010000000000" + String(i).padStart(2, "0"));
  const order = (seed) =>
    ids.slice().sort((x, y) => rng(hashSeed(x + ":" + seed))() - rng(hashSeed(y + ":" + seed))());

  assert.deepEqual(order("111"), order("111"), "same seed must give the same order");
  assert.notDeepEqual(order("111"), order("222"), "a new seed must re-deal");
  assert.notDeepEqual(order("111"), ids, "a shuffle that returns input order isn't shuffling");

  /* Filtering must not re-deal the survivors. This is the property that keeps
     the list from jumping when a filter chip is toggled — scores depend on
     the item id, not on the array's contents. */
  const full = order("111");
  const subset = full.filter((_, i) => i % 3 === 0);
  const resorted = subset.slice().sort(
    (x, y) => rng(hashSeed(x + ":111"))() - rng(hashSeed(y + ":111"))()
  );
  assert.deepEqual(resorted, subset, "filtering changed the relative order");
});

/* ---------------------------------------------------------------------------
   Wiring
   --------------------------------------------------------------------------- */

test("every sort key is implemented, grouped, and reachable", () => {
  const block = app.slice(app.indexOf("const SORTS = ["), app.indexOf("const SORT_GROUPS"));
  const keys = [...block.matchAll(/key:\s*"([a-z]+)"/g)].map((m) => m[1]);
  const groups = [...block.matchAll(/group:\s*"([A-Za-z]+)"/g)].map((m) => m[1]);

  assert.equal(keys.length, groups.length, "every sort needs a group");
  assert.ok(keys.length >= 16, "expected the expanded sort set, got " + keys.length);
  assert.equal(new Set(keys).size, keys.length, "duplicate sort key");

  // Each group in SORTS must exist in SORT_GROUPS, or its items never render.
  const declared = app.slice(app.indexOf("const SORT_GROUPS"), app.indexOf("];", app.indexOf("const SORT_GROUPS")));
  for (const g of new Set(groups)) assert.ok(declared.includes('"' + g + '"'), "group not rendered: " + g);

  // Each key needs a comparator, or it silently falls back to newest.
  const cmp = app.slice(app.indexOf("const cmp = {"), app.indexOf("}[state.sort]"));
  for (const k of keys) assert.match(cmp, new RegExp("\\b" + k + ":"), "no comparator for " + k);
});

test("the shuffle seed round-trips through the URL", () => {
  // A shared link must reproduce the exact order the sender saw.
  assert.match(app, /if \(isShuffle\(\)\) p\.set\("seed", state\.shuffleSeed\)/);
  assert.match(app, /if \(seed && \/\^\[0-9\]\{1,10\}\$\/\.test\(seed\)\) state\.shuffleSeed = seed/);
});

test("picking a shuffle re-deals it", () => {
  // Tapping Shuffle while already shuffled must mean "shuffle again", and
  // switching to it fresh must not open on a stale order.
  const handler = app.slice(app.indexOf('const key = btn.dataset.sort;'));
  assert.match(handler.slice(0, 300), /if \(isShuffle\(key\)\) reshuffle\(\);/);
});

test("only shuffles are marked as re-dealing", () => {
  const block = app.slice(app.indexOf("const SORTS = ["), app.indexOf("const SORT_GROUPS"));
  const reshuffling = [...block.matchAll(/key:\s*"([a-z]+)"[^\n]*reshuffle:\s*true/g)].map((m) => m[1]);
  assert.deepEqual(reshuffling.sort(), ["random", "surprise"]);
});

test("comparators never mutate the list they are given", () => {
  // `visible()` is called on every render; sorting in place would scramble
  // state.items as a side effect.
  const fn = app.slice(app.indexOf("function sortList("), app.indexOf("const isShuffle"));
  assert.match(fn, /const copy = list\.slice\(\);/);
  assert.match(fn, /copy\.sort\(cmp\)/);
  assert.doesNotMatch(fn, /\blist\.sort\(/);
});

test("shuffle scores are precomputed, not recomputed per comparison", () => {
  // A comparator runs O(n log n) times; hashing inside it would make a large
  // library crawl.
  const fn = app.slice(app.indexOf("function sortList("), app.indexOf("const isShuffle"));
  assert.match(fn, /score = new Map\(/);
  assert.match(fn, /random: \(a, b\) => score\.get\(a\.tweet_id\) - score\.get\(b\.tweet_id\)/);
});

/* ---------------------------------------------------------------------------
   Menu behaviour these sorts exposed

   Both bugs below existed before this change and were invisible with seven
   options. At seventeen the menu scrolls and overflows, and they became
   unmissable.
   --------------------------------------------------------------------------- */

test("scrolling inside a menu does not close it", () => {
  const src = readFileSync(join(root, "shared/m3e/interactions.js"), "utf8");
  // The scroll listener is in the capture phase, so it also sees scrolling
  // within the menu — which closed the menu the moment a user reached for a
  // lower item.
  assert.match(src, /function onScroll\(event\)/);
  assert.match(src, /menu\.contains\(event\.target\)\) return;/);
  assert.doesNotMatch(src, /addEventListener\("scroll", close, true\)/);
});

test("a menu is capped to the space available on screen", () => {
  const src = readFileSync(join(root, "shared/m3e/interactions.js"), "utf8");
  // Clamping only the top edge let a tall menu run off the bottom, leaving
  // items rendered outside the viewport and unreachable by any scroll.
  assert.match(src, /menu\.style\.maxHeight = above \+ "px"/);
  assert.match(src, /menu\.style\.maxHeight = Math\.max\(120, below\) \+ "px"/);
});

test("clicking the sort trigger toggles rather than stacking menus", () => {
  // openMenu's outside-click handler treats the trigger as "inside", so the
  // toggle has to be owned by the caller.
  assert.match(app, /if \(sortMenu\) \{ sortMenu\.close\(\); return; \}/);
  assert.match(app, /onClose: \(\) => \{ sortMenu = null; \}/);
});

#!/usr/bin/env node
/* =============================================================================
   Sync shared/m3e → extension/shared/m3e

   Why this exists
   ---------------
   `shared/m3e/*` is the single source of truth for the design system: both the
   dashboard and the extension popup are built on it.

   The dashboard can just reference `../shared/m3e/tokens.css`, because it is
   served from the repo. The extension cannot. A Chrome extension's root is the
   directory containing `manifest.json`, and an extension page may not reference
   anything above that root — `../shared/…` from `extension/popup.html` resolves
   outside the package and simply fails to load.

   Rather than fork the design system (guaranteed drift) or move the manifest to
   the repo root (which would ship the dashboard, tests, and .git inside the
   extension), we keep one authored copy and mirror it into the package.

   The mirrored copy IS committed, so "Load unpacked → extension/" works with no
   build step. `--check` verifies the mirror is current and is run by the test
   suite, so the copy can never silently drift from the source.

   Usage:
     node tools/sync-shared.mjs           # write the mirror
     node tools/sync-shared.mjs --check   # exit 1 if the mirror is stale
   ============================================================================= */

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Text assets get a provenance banner; binaries are copied byte-for-byte.
const PAIRS = [
  { src: join(ROOT, "shared", "m3e"),   dest: join(ROOT, "extension", "shared", "m3e"),   banner: true },
  { src: join(ROOT, "shared", "fonts"), dest: join(ROOT, "extension", "shared", "fonts"), banner: false },
];

const BANNER = (dir, name) =>
  `/* AUTO-GENERATED — do not edit.
   Mirrored from ${dir}/${name} by tools/sync-shared.mjs.
   Edit the original and re-run:  node tools/sync-shared.mjs
*/
`;

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name))));
    else out.push(join(dir, entry.name));
  }
  return out.sort();
}

const check = process.argv.includes("--check");
const stale = [];
let count = 0;

for (const { src, dest, banner } of PAIRS) {
  if (!existsSync(src)) continue;
  const label = relative(ROOT, src);
  const files = await listFiles(src);
  count += files.length;

  for (const file of files) {
    const rel = relative(src, file);
    const target = join(dest, rel);
    // CSS and JS carry a banner so nobody edits the copy by mistake. Fonts are
    // binary: any prefix would corrupt them.
    const expected = banner
      ? Buffer.from(BANNER(label, rel) + (await readFile(file, "utf8")))
      : await readFile(file);

    if (check) {
      const actual = existsSync(target) ? await readFile(target) : null;
      if (!actual || !actual.equals(expected)) stale.push(label + "/" + rel);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, expected);
    }
  }

  // Remove mirrored files whose source no longer exists.
  if (existsSync(dest)) {
    const names = new Set(files.map((f) => relative(src, f)));
    for (const file of await listFiles(dest)) {
      const rel = relative(dest, file);
      if (names.has(rel)) continue;
      if (check) stale.push(label + "/" + rel + " (orphaned)");
      else await rm(file);
    }
  }
}

if (check) {
  if (stale.length) {
    console.error("extension/shared is out of date:\n  " + stale.join("\n  "));
    console.error("\nRun: node tools/sync-shared.mjs");
    process.exit(1);
  }
  console.log("extension/shared is up to date (" + count + " files).");
} else {
  console.log("Mirrored " + count + " file(s) → extension/shared/");
}

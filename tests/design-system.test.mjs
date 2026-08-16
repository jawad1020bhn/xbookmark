/* =============================================================================
   Design-system regression tests

   The design system is code, so its rules are testable. These guard the
   invariants that are easy to break silently in a later edit and expensive to
   notice by eye:

     · every colour role pair that carries text meets WCAG AA (4.5:1);
     · every role pair that carries a meaningful non-text boundary meets 1.4.11
       (3:1);
     · the extension's mirrored copy of shared/ is current;
     · both surfaces reference only files that exist.

   Run: node tests/design-system.test.mjs
   ============================================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const M3EColor = require(join(ROOT, "shared/m3e/color.js"));

/* The full personalisation space a user can actually reach from the settings
   dialog: 6 curated seeds (plus any custom colour, which these bracket) ×
   4 variants × 3 contrast levels × light/dark. */
const SEEDS = ["#5B4CF5", "#1D9BF0", "#0F7B6C", "#2E7D46", "#D2542B", "#B0399B"];

function everyScheme(fn) {
  for (const seed of SEEDS) {
    for (const variant of M3EColor.VARIANTS) {
      for (const contrast of M3EColor.CONTRAST_LEVELS) {
        for (const dark of [false, true]) {
          fn(M3EColor.scheme(seed, { seed, dark, variant, contrast }), {
            seed, variant, contrast, mode: dark ? "dark" : "light",
          });
        }
      }
    }
  }
}

/* ---------------------------------------------------------------------------
   Colour
   --------------------------------------------------------------------------- */

test("every text role pair meets WCAG AA (4.5:1)", () => {
  const PAIRS = [
    ["onSurface", "surface"],
    ["onSurfaceVariant", "surface"],
    ["onSurfaceVariant", "surfaceContainer"],
    ["onSurfaceVariant", "surfaceContainerHigh"],
    ["onSurface", "surfaceContainerLowest"],
    ["onSurface", "surfaceContainerHighest"],
    ["onPrimary", "primary"],
    ["onPrimaryContainer", "primaryContainer"],
    ["onSecondary", "secondary"],
    ["onSecondaryContainer", "secondaryContainer"],
    ["onTertiary", "tertiary"],
    ["onTertiaryContainer", "tertiaryContainer"],
    ["onError", "error"],
    ["onErrorContainer", "errorContainer"],
    ["inverseOnSurface", "inverseSurface"],
  ];

  const failures = [];
  everyScheme((scheme, ctx) => {
    for (const [fg, bg] of PAIRS) {
      const ratio = M3EColor.contrastRatio(scheme.roles[fg], scheme.roles[bg]);
      if (ratio < 4.5) {
        failures.push(
          `${ctx.seed}/${ctx.variant}/${ctx.contrast}/${ctx.mode} ` +
          `${fg} on ${bg} = ${ratio.toFixed(2)}`
        );
      }
    }
  });

  assert.deepEqual(failures, [], `${failures.length} text pairs below 4.5:1`);
});

test("meaningful non-text boundaries meet WCAG 1.4.11 (3:1)", () => {
  // `outline` marks control boundaries (outlined buttons, chips, fields).
  // `outlineVariant` is excluded on purpose: M3 scopes it to decorative
  // dividers, which 1.4.11 explicitly exempts. components.css must therefore
  // never use outlineVariant for a control border — see the notes there.
  const PAIRS = [
    ["outline", "surface"],
    ["outline", "surfaceContainer"],
    ["outline", "surfaceContainerLow"],
    ["primary", "surface"],
    ["error", "surface"],
    ["secondary", "surface"],
  ];

  const failures = [];
  everyScheme((scheme, ctx) => {
    for (const [fg, bg] of PAIRS) {
      const ratio = M3EColor.contrastRatio(scheme.roles[fg], scheme.roles[bg]);
      if (ratio < 3) {
        failures.push(
          `${ctx.seed}/${ctx.variant}/${ctx.contrast}/${ctx.mode} ` +
          `${fg} on ${bg} = ${ratio.toFixed(2)}`
        );
      }
    }
  });

  assert.deepEqual(failures, [], `${failures.length} boundaries below 3:1`);
});

test("no control border uses the decorative outlineVariant role", () => {
  const css = readFileSync(join(ROOT, "shared/m3e/components.css"), "utf8");
  // Selectors whose border is the control's own boundary.
  const CONTROL_BORDERS = [
    ".m3e-button--outlined",
    ".m3e-chip",
    ".m3e-icon-button--outlined",
    ".m3e-card--outlined",
    ".m3e-badge--outline",
  ];
  for (const sel of CONTROL_BORDERS) {
    // Grab the rule body following the selector.
    const match = css.match(
      new RegExp(sel.replace(/[.\-]/g, "\\$&") + "\\s*\\{([^}]*)\\}")
    );
    assert.ok(match, `expected a rule for ${sel}`);
    assert.ok(
      !/outline-variant/.test(match[1]),
      `${sel} uses outline-variant for a control boundary; use outline (3:1)`
    );
  }
});

test("contrast levels are monotonic — higher contrast never reduces a ratio", () => {
  for (const seed of SEEDS) {
    for (const dark of [false, true]) {
      const ratios = M3EColor.CONTRAST_LEVELS.map((contrast) => {
        const s = M3EColor.scheme(seed, { dark, variant: "vibrant", contrast });
        return M3EColor.contrastRatio(s.roles.onSurface, s.roles.surface);
      });
      for (let i = 1; i < ratios.length; i++) {
        assert.ok(
          ratios[i] >= ratios[i - 1] - 0.01,
          `${seed} ${dark ? "dark" : "light"}: contrast went down ` +
          `(${ratios.map((r) => r.toFixed(2)).join(" → ")})`
        );
      }
    }
  }
});

test("curated seeds stay visually distinct under every variant", () => {
  // Variants re-chroma the seed to a fixed target, so only HUE survives. Two
  // seeds sharing a hue collapse to the same scheme and the theme picker shows
  // two identical swatches. Guard the curated set against that.
  const theme = readFileSync(join(ROOT, "shared/m3e/theme.js"), "utf8");
  const block = theme.match(/const SEEDS = \[([\s\S]*?)\];/);
  assert.ok(block, "could not find the SEEDS list in theme.js");
  const hexes = [...block[1].matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  assert.ok(hexes.length >= 4, "expected a curated seed list");

  for (const variant of M3EColor.VARIANTS) {
    for (const dark of [false, true]) {
      const seen = new Map();
      for (const hex of hexes) {
        const primary = M3EColor.scheme(hex, { dark, variant }).roles.primary;
        const clash = seen.get(primary);
        assert.ok(
          !clash,
          `${variant}/${dark ? "dark" : "light"}: seeds ${clash} and ${hex} ` +
          `both produce primary ${primary}`
        );
        seen.set(primary, hex);
      }
    }
  }
});

/* ---------------------------------------------------------------------------
   Packaging
   --------------------------------------------------------------------------- */

test("extension/shared is in sync with shared/", () => {
  // A Chrome extension cannot reference files above its root, so shared/ is
  // mirrored into the package. If the mirror drifts, the popup silently ships
  // a stale design system.
  try {
    execFileSync(process.execPath, [join(ROOT, "tools/sync-shared.mjs"), "--check"], {
      stdio: "pipe",
    });
  } catch (err) {
    assert.fail(
      "extension/shared is stale — run: node tools/sync-shared.mjs\n" +
      String(err.stderr || "")
    );
  }
});

test("every asset referenced by a surface exists", () => {
  const surfaces = [
    { html: "dashboard/index.html", base: "dashboard" },
    { html: "extension/popup.html", base: "extension" },
  ];

  for (const { html, base } of surfaces) {
    const src = readFileSync(join(ROOT, html), "utf8");
    const refs = [
      ...src.matchAll(/(?:href|src)="([^"#]+)"/g),
    ].map((m) => m[1]).filter((h) => !/^(https?:|data:|mailto:)/.test(h));

    for (const ref of refs) {
      const target = resolve(ROOT, base, ref);
      assert.ok(existsSync(target), `${html} references missing file: ${ref}`);
    }
  }
});

test("popup.html references no path outside the extension root", () => {
  // `../shared/...` resolves outside the package and fails to load in Chrome.
  const src = readFileSync(join(ROOT, "extension/popup.html"), "utf8");
  const escaping = [...src.matchAll(/(?:href|src)="(\.\.\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    escaping,
    [],
    "popup.html must not reference paths above extension/ — they fail under MV3"
  );
});

test("the popup loads no remote resources (MV3 CSP forbids them)", () => {
  const src = readFileSync(join(ROOT, "extension/popup.html"), "utf8");
  const remote = [...src.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(remote, [], "popup.html must not load remote resources");
});

/* ---------------------------------------------------------------------------
   Tokens
   --------------------------------------------------------------------------- */

test("component CSS references only defined custom properties", () => {
  const tokens = readFileSync(join(ROOT, "shared/m3e/tokens.css"), "utf8");
  const components = readFileSync(join(ROOT, "shared/m3e/components.css"), "utf8");

  // Colour roles are injected at runtime by theme.js, so collect those too.
  const themeJs = readFileSync(join(ROOT, "shared/m3e/theme.js"), "utf8");

  const defined = new Set([
    ...[...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]),
    ...[...themeJs.matchAll(/"(--[\w-]+)"/g)].map((m) => m[1]),
  ]);

  // theme.js builds colour names programmatically from the role list.
  const roles = Object.keys(M3EColor.scheme("#5B4CF5", {}).roles);
  for (const role of roles) {
    defined.add("--md-sys-color-" + role.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
  }

  const used = new Set(
    [...components.matchAll(/var\((--md-[\w-]+)/g)].map((m) => m[1])
  );

  const missing = [...used].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(missing, [], `${missing.length} undefined token(s) referenced`);
});

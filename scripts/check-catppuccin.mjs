#!/usr/bin/env node
// Parity check for the Catppuccin pipeline: render every compiled style with
// Catppuccin's real Mocha/Latte colors through extension/lib/catppuccin.js and
// compare, color by color, with upstream's own LESS compile of the same style.
// Any difference means the token plugin or the runtime color math is off.
//
// Usage: node scripts/check-catppuccin.mjs [path-to-userstyles-checkout]

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import less from "less";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(process.argv[2] || join(ROOT, ".cache/catppuccin-userstyles"));
const OUT = join(ROOT, "extension/adapters/catppuccin");
const color = require(join(ROOT, "extension/lib/color.js"));
const { renderFlavor } = require(join(ROOT, "extension/lib/catppuccin.js"));

const lib = readFileSync(join(SRC, "lib/std/v1.less"), "utf8");
function flavorColors(name) {
  const line = lib.match(new RegExp(`@${name}:\\s*\\{([^}]*)\\}`))[1];
  const flavor = {};
  for (const [, key, hex] of line.matchAll(/@(\w+): (#[0-9a-f]{6});/g)) flavor[key] = color.parse(hex);
  flavor.accent = flavor.mauve;
  return flavor;
}

// The real opposite flavor stands in for the runtime's mirrored `inv` colors.
function checkFlavor(name) {
  const flavor = flavorColors(name);
  const opposite = flavorColors(name === "latte" ? "mocha" : "latte");
  for (const [key, value] of Object.entries(opposite)) flavor[`inv${key}`] = value;
  return flavor;
}

// Canonical form for comparing: URL escapes decoded, every color as rgba with
// rounded channels (inside url() too), long decimals cut to 6 places.
const COLOR = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^()]*\)/g;
function normalize(css) {
  const canon = (rgb) => `C(${[rgb.r, rgb.g, rgb.b].map(Math.round).join(",")},${+(rgb.a ?? 1).toFixed(2)})`;
  return css
    .replace(/%(2[0389cC]|28|29)/g, (e) => decodeURIComponent(e))
    .replace(COLOR, (t) => {
      const rgb = color.parse(t);
      return rgb ? canon(rgb) : t;
    })
    .replace(/\d+\.\d+/g, (n) => String(+(+n).toFixed(4)))
    .replace(/color-scheme:\s*(light|dark)/g, "color-scheme:S");
}

const { blocksOf, userVarsOf, IMPORT } = await import(join(ROOT, "scripts/build-catppuccin.mjs"));
const index = JSON.parse(readFileSync(join(OUT, "index.json"), "utf8")).styles;

let bad = 0;
for (const { id, light } of index) {
  for (const [mode, flavorName] of [["dark", "mocha"], ["light", "latte"]]) {
    const source = readFileSync(join(SRC, "styles", id, "catppuccin.user.less"), "utf8");
    const vars = userVarsOf(source, flavorName).replace("@accentColor: accent;", "@accentColor: mauve;");
    const body = source.replace(
      /@import\s+"https:\/\/userstyles\.catppuccin\.com\/lib\/(?:std\/v1|lib)\.less";/g,
      `@import (reference) "${join(SRC, "lib/std/v1.less")}";`,
    );
    const { css } = await less.render(`${vars}\n${body}`, { filename: `${id}.less`, compress: true });
    const expected = normalize(blocksOf(css).map((b) => b.css.replace(IMPORT, "").trim()).join("\n"));

    const file = join(OUT, "styles", `${id}.${mode === "light" && light ? "light" : "dark"}.json`);
    const style = JSON.parse(readFileSync(file, "utf8"));
    const actual = normalize(renderFlavor(style, checkFlavor(flavorName), mode));

    if (actual !== expected) {
      bad++;
      let i = 0;
      while (actual[i] === expected[i]) i++;
      const at = Math.max(0, i - 60);
      console.log(`${id} (${mode}) differs at ${i}:\n  ours:     ${actual.slice(at, i + 80)}\n  upstream: ${expected.slice(at, i + 80)}`);
    }
  }
}
console.log(bad ? `${bad} mismatches` : `all ${index.length} styles match upstream in dark and light`);
process.exit(bad ? 1 : 0);

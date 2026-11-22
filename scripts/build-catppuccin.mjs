#!/usr/bin/env node
// Compile Catppuccin's userstyles into palette-independent adapters.
//
// Catppuccin styles are LESS: they read colors from a flavor map (@base, @text,
// @blue, ...) and derive more with darken(), fade(), mix() and friends. Here
// every palette color is a placeholder token, and a LESS plugin turns every
// color function that touches a token into a recorded expression. The output
// CSS contains tokens like `owt_e12_x`; the extension evaluates those
// expressions against the live Omarchy palette (extension/lib/catppuccin.js).
//
// Usage: node scripts/build-catppuccin.mjs [path-to-userstyles-checkout]

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import less from "less";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "https://github.com/catppuccin/userstyles.git";
const COMMIT = "7cad6352b192723c9de2b9ebb508079d7ca7cdb2";
const OUT = join(ROOT, "extension/adapters/catppuccin");

// Built once per theme polarity; Omarchy light themes use the latte build.
const MODES = { dark: "mocha", light: "latte" };

const COLORS = [
  "rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal",
  "sky", "sapphire", "blue", "lavender", "text", "subtext1", "subtext0", "overlay2", "overlay1",
  "overlay0", "surface2", "surface1", "surface0", "base", "mantle", "crust",
];

const token = (name) => `owt_${name}_x`;
const IMPORT = /@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g;
const TOKEN = /^owt_(\w+?)_x$/;

function checkout(dir) {
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", REPO]);
  }
  execFileSync("git", ["-C", dir, "fetch", "-q", "--depth", "1", "origin", COMMIT]);
  execFileSync("git", ["-C", dir, "checkout", "-q", "FETCH_HEAD"]);
}

// Catppuccin's std lib with every palette hex replaced by a token. The CSS
// filter map stays as upstream: filters can't be derived for an arbitrary
// color at runtime, so icons recolored by filter keep Catppuccin's hue.
//
// Flavors of the opposite polarity get `inv` tokens, so a style that borrows
// Latte colors inside a Mocha build gets the mirrored palette, not the same one.
function tokenLib(source, flavor) {
  const start = source.indexOf("@catppuccin: {");
  const end = source.indexOf("\n};", source.indexOf("@mocha:", start)) + 3;
  const flavors = ["latte", "frappe", "macchiato", "mocha"];
  const map =
    "@catppuccin: {\n" +
    flavors
      .map((f) => {
        const prefix = (f === "latte") === (flavor === "latte") ? "" : "inv";
        return `  @${f}: { ${[...COLORS, "accent"].map((c) => `@${c}: ~"${token(prefix + c)}";`).join(" ")} };`;
      })
      .join("\n") +
    "\n};";
  // The accent filter falls back to mauve's, Catppuccin's default accent.
  const rest = source
    .slice(end)
    .replace(/(@mauve: ([^;]*);)/g, (all, _m, mauve) => `${all} @accent: ${mauve};`);
  return source.slice(0, start) + map + rest;
}

// Default values for the style's ==UserStyle== @var options.
function userVars(source, flavor) {
  const vars = { lightFlavor: flavor, darkFlavor: flavor, accentColor: "accent" };
  const header = source.match(/==UserStyle==([\s\S]*?)==\/UserStyle==/)?.[1] || "";
  for (const line of header.split("\n")) {
    const m = line.match(/^@var\s+(\w+)\s+([\w-]+)\s+(?:"[^"]*"|'[^']*'|\S+)\s+(.*)$/);
    if (!m) continue;
    const [, type, name, raw] = m;
    if (name in vars) continue;
    let value = raw.trim();
    if (type === "select") {
      const options = [...value.matchAll(/"([^"]*)"|'([^']*)'/g)].map((o) => o[1] ?? o[2]);
      const chosen = options.find((o) => o.endsWith("*")) || options[0] || "";
      value = chosen.replace(/\*$/, "").split(":")[0];
    } else if (type === "range" || type === "number") {
      const parts = value.replace(/[[\]]/g, "").split(",").map((p) => p.trim().replace(/['"]/g, ""));
      value = parts[0] + (parts.length > 4 ? parts[4] : "");
    } else if (type === "text") {
      value = value.replace(/^["']|["']$/g, "") || "~''";
    }
    vars[name] = value;
  }
  return Object.entries(vars).map(([k, v]) => `@${k}: ${v};`).join("\n");
}

// The LESS plugin: color functions that receive a token record an expression
// and return a token for it. Without tokens they run as usual.
const COLOR_FUNCTIONS = [
  "fade", "fadein", "fadeout", "darken", "lighten", "saturate", "desaturate", "spin", "mix", "tint",
  "shade", "contrast", "greyscale", "average", "multiply", "screen", "overlay", "softlight",
  "hardlight", "difference", "exclusion", "negation", "hue", "saturation", "lightness", "red",
  "green", "blue", "alpha", "luma", "luminance", "hsl", "hsla", "rgb", "rgba",
];

function tokenPlugin(exprs) {
  const ids = new Map();
  return {
    install(lessInstance, _pluginManager, functions) {
      const { tree } = lessInstance;
      const registry = lessInstance.functions.functionRegistry;

      const tokenOf = (node) => (typeof node?.value === "string" ? node.value.match(TOKEN)?.[1] : null);
      const serialize = (node) => {
        const name = tokenOf(node);
        if (name) return name.startsWith("e") && /^e\d+$/.test(name) ? { e: +name.slice(1) } : { r: name };
        if (node instanceof tree.Dimension) return { n: node.value, u: node.unit.toString() };
        if (node instanceof tree.Color) return { c: node.rgb, a: node.alpha };
        return { k: node.toCSS ? node.toCSS({}) : String(node.value) };
      };

      for (const fn of COLOR_FUNCTIONS) {
        const original = registry.get(fn);
        functions.add(fn, function (...args) {
          if (!args.some(tokenOf)) return original.apply(this, args);
          const expr = [fn, ...args.map(serialize)];
          const key = JSON.stringify(expr);
          if (!ids.has(key)) {
            ids.set(key, exprs.length);
            exprs.push(expr);
          }
          return new tree.Anonymous(token(`e${ids.get(key)}`));
        });
      }
    },
  };
}

// Styles Catppuccin files under `browser_extension` theme another extension's
// UI drawn on top of many sites (Shinigami Eyes on YouTube, Reddit, X...).
// They are add-ons: applied on top of a site's own style, never instead of it.
function addonIds(src) {
  const ids = new Set();
  let current = null;
  for (const line of readFileSync(join(src, "scripts/userstyles.yml"), "utf8").split("\n")) {
    const entry = line.match(/^  ([\w.-]+):\s*$/);
    if (entry) current = entry[1];
    else if (current && /^\s+categories:.*\bbrowser_extension\b/.test(line)) ids.add(current);
  }
  return ids;
}

// Split compiled CSS into its @-moz-document blocks: [{matchers, css}].
function documentBlocks(css) {
  const blocks = [];
  let at = 0;
  while ((at = css.indexOf("@-moz-document", at)) !== -1) {
    const open = css.indexOf("{", at);
    const matchers = [...css.slice(at + 14, open).matchAll(/(url-prefix|url|domain|regexp)\(\s*(["'])((?:\\.|(?!\2).)*)\2\s*\)/g)].map(
      ([, type, , value]) => [type, unescapeCss(value)],
    );
    let depth = 0;
    let i = open;
    let quote = null;
    for (; i < css.length; i++) {
      const ch = css[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) break;
    }
    blocks.push({ matchers, css: css.slice(open + 1, i).trim() });
    at = i + 1;
  }
  return blocks;
}

// CSS string escapes: `\.` is `.`, `\2f` is `/`. Stylus reads regexp() the same way.
function unescapeCss(value) {
  return value.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_, esc) =>
    /^[0-9a-fA-F]/.test(esc) && esc.trim().length > 1 ? String.fromCodePoint(parseInt(esc, 16)) : esc[0],
  );
}

// Tokens inside url(...) go into data URIs, where `#` must be written %23.
// color-scheme follows the Omarchy theme too; as a token it also lets most
// styles share one build for light and dark themes.
function markTokens(css) {
  return css
    .replace(/url\((["']?)([\s\S]*?)\1\)/g, (all) => all.replace(/owt_(\w+?)_x/g, "owtu_$1_x"))
    .replace(/color-scheme:\s*(?:light|dark)(?=\s*[;}!])/g, "color-scheme:owt_scheme_x");
}

async function compile(id, source, flavor, libPaths) {
  const libPath = libPaths[flavor];
  const body = source.replace(
    /@import\s+"https:\/\/userstyles\.catppuccin\.com\/lib\/(?:std\/v1|lib)\.less";/g,
    `@import (reference) "${libPath}";`,
  );
  const exprs = [];
  const { css } = await less.render(`${userVars(source, flavor)}\n${body}`, {
    filename: `${id}.less`,
    plugins: [tokenPlugin(exprs)],
    javascriptEnabled: false,
    compress: true,
  });
  return { exprs, blocks: documentBlocks(markTokens(css)) };
}

async function main() {
  const src = resolve(process.argv[2] || join(ROOT, ".cache/catppuccin-userstyles"));
  if (!process.argv[2]) checkout(src);

  const libDir = join(ROOT, ".cache/catppuccin-lib");
  mkdirSync(libDir, { recursive: true });
  const upstreamLib = readFileSync(join(src, "lib/std/v1.less"), "utf8");
  const libPaths = {};
  for (const flavor of Object.values(MODES)) {
    libPaths[flavor] = join(libDir, `v1.${flavor}.less`);
    writeFileSync(libPaths[flavor], tokenLib(upstreamLib, flavor));
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "styles"), { recursive: true });

  const index = [];
  const failed = [];
  const addons = addonIds(src);
  for (const id of readdirSync(join(src, "styles")).sort()) {
    const file = join(src, "styles", id, "catppuccin.user.less");
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const name = source.match(/@name\s+(.+)/)?.[1].replace(/\s*Catppuccin$/, "").trim() || id;

    try {
      const builds = {};
      for (const [mode, flavor] of Object.entries(MODES)) builds[mode] = await compile(id, source, flavor, libPaths);

      const matchers = builds.dark.blocks.map((b) => b.matchers);
      if (JSON.stringify(matchers) !== JSON.stringify(builds.light.blocks.map((b) => b.matchers))) {
        throw new Error("dark and light builds have different @-moz-document blocks");
      }
      if (!matchers.length) throw new Error("no @-moz-document block");
      // Constructed stylesheets can't @import. The imports are add-ons (code
      // highlighting themes) with Catppuccin's colors baked in, so drop them,
      // unless the import *was* the style (codeberg pulls its whole theme).
      const imported = builds.dark.blocks.some((b) => IMPORT.test(b.css));
      IMPORT.lastIndex = 0;
      for (const build of Object.values(builds)) {
        for (const block of build.blocks) block.css = block.css.replace(IMPORT, "").trim();
      }
      if (imported && builds.dark.blocks.every((b) => b.css.length < 1000)) throw new Error("only imports a remote theme");

      // Most styles don't branch on the flavor; ship the light build only
      // when it differs, and point the index at the dark one otherwise.
      const json = (build) => JSON.stringify({ exprs: build.exprs, blocks: build.blocks.map((b) => b.css) });
      const dark = json(builds.dark);
      const light = json(builds.light);
      writeFileSync(join(OUT, "styles", `${id}.dark.json`), dark);
      if (light !== dark) writeFileSync(join(OUT, "styles", `${id}.light.json`), light);
      index.push({ id, name, light: light !== dark, ...(addons.has(id) && { addon: true }), blocks: matchers });
    } catch (error) {
      failed.push([id, String(error.message || error).split("\n")[0]]);
    }
  }

  writeFileSync(join(OUT, "index.json"), JSON.stringify({ commit: COMMIT, styles: index }));
  writeFileSync(join(OUT, "LICENSE"), readFileSync(join(src, "LICENSE"), "utf8"));

  console.log(`built ${index.length} styles from catppuccin/userstyles@${COMMIT.slice(0, 7)}`);
  if (failed.length) {
    console.log(`skipped ${failed.length}:`);
    for (const [id, why] of failed) console.log(`  ${id}: ${why}`);
  }
}

export { userVars as userVarsOf, documentBlocks as blocksOf, IMPORT };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

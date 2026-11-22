// Package the extension for release, after `npm run build:catppuccin`:
//   dist/omarchy-web-theme-<version>.zip        Load unpacked. Keeps the manifest
//                                               `key`, so the ID matches what the
//                                               native host allows.
//   dist/omarchy-web-theme-<version>-store.zip  Chrome Web Store upload. The store
//                                               rejects `key` and assigns its own ID.
// Usage: node scripts/package.mjs [tag]   # tag (e.g. v0.1.0) must match the version
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");
const DIST = join(ROOT, "dist");

const fail = (message) => {
  console.error(`package: ${message}`);
  process.exit(1);
};

const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (manifest.version !== version) fail(`manifest.json is ${manifest.version}, package.json is ${version}`);
const tag = process.argv[2];
if (tag && tag !== `v${version}`) fail(`tag ${tag} does not match version ${version}`);
if (!existsSync(join(EXT, "adapters/catppuccin/index.json"))) fail("run `npm run build:catppuccin` first");

rmSync(DIST, { recursive: true, force: true });

function build(name, edit) {
  const stage = join(DIST, name);
  cpSync(EXT, stage, { recursive: true });
  const m = structuredClone(manifest);
  edit?.(m);
  writeFileSync(join(stage, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  const zip = join(DIST, `${name}.zip`);
  // -X: no extra file attributes, so the same tree gives the same zip.
  execFileSync("zip", ["-qrX", zip, "."], { cwd: stage });
  rmSync(stage, { recursive: true });
  console.log(`wrote ${zip.slice(ROOT.length + 1)}`);
}

build(`omarchy-web-theme-${version}`);
build(`omarchy-web-theme-${version}-store`, (m) => delete m.key);

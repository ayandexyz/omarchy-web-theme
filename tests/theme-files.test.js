// Reading the theme from disk must give the same palette the native host sends.
const test = require("node:test");
const assert = require("node:assert/strict");

const { parseToml, buildPalette, listedDirs } = require("../extension/lib/theme-files.js");

const COLORS_TOML = `mode = "dark"

accent = "#7fbbb3"   # trailing comment
selection = '#3d484d'
# muted = "#000000"
background = "#2d353b"
font = "JetBrains Mono"
[extra]
`;

test("parseToml reads flat string pairs and skips comments and tables", () => {
  assert.deepEqual(parseToml(COLORS_TOML), {
    mode: "dark",
    accent: "#7fbbb3",
    selection: "#3d484d",
    background: "#2d353b",
    font: "JetBrains Mono",
  });
});

test("buildPalette matches the native host's message", () => {
  assert.deepEqual(buildPalette({ colorsToml: COLORS_TOML, name: "everforest\n", generation: "42-7\n" }), {
    type: "palette",
    name: "everforest",
    generation: "42-7",
    mode: "dark",
    colors: { accent: "#7fbbb3", selection: "#3d484d", background: "#2d353b" },
  });
});

test("buildPalette defaults to dark mode", () => {
  assert.equal(buildPalette({ colorsToml: 'background = "#ffffff"' }).mode, "dark");
  assert.equal(buildPalette({ colorsToml: 'mode = "light"' }).mode, "light");
});

test("listedDirs reads directories from Chromium's file listing", () => {
  const html = `<script>start("/home/");</script>
<script>addRow("ayan-de","ayan-de",1,5184,"5.1 kB",1795346662,"11/22/26, 4:54:22 PM");</script>
<script>addRow("notes.txt","notes.txt",0,12,"12 B",1795346662,"11/22/26, 4:54:22 PM");</script>
<script>addRow("guest","guest",1,0,"0 B",1795346662,"11/22/26, 4:54:22 PM");</script>`;
  assert.deepEqual(listedDirs(html), ["ayan-de", "guest"]);
});

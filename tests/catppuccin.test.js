// Runtime for compiled Catppuccin styles. Full parity with upstream's own LESS
// output is checked by `npm run check:catppuccin`; these cover the pieces.
const test = require("node:test");
const assert = require("node:assert/strict");

const color = require("../extension/lib/color.js");
const { flavorFromPalette, render, match } = require("../extension/lib/catppuccin.js");

const palette = {
  mode: "dark",
  colors: {
    accent: "#8bcbb1",
    selection: "#2b5147",
    muted: "#64887b",
    background: "#142620",
    dark_background: "#0f1e19",
    darker_background: "#0a1713",
    lighter_background: "#203b31",
    foreground: "#dfede5",
    dark_foreground: "#91ad9f",
    light_foreground: "#bed6c9",
    red: "#d88d91",
    yellow: "#c5cc91",
    green: "#8bcbb1",
    blue: "#96b7d0",
  },
};

const style = (exprs, ...blocks) => ({ exprs, blocks });
const lightness = (hex) => color.toOklch(color.parse(hex)).l;

test("flavor takes Omarchy's own colors where they exist", () => {
  const f = flavorFromPalette(palette);
  const hex = (c) => color.format(c);
  assert.equal(hex(f.base), hex(color.parse("#142620")));
  assert.equal(hex(f.mantle), hex(color.parse("#0f1e19")));
  assert.equal(hex(f.crust), hex(color.parse("#0a1713")));
  assert.equal(hex(f.surface0), hex(color.parse("#203b31")));
  assert.equal(hex(f.text), hex(color.parse("#dfede5")));
  assert.equal(hex(f.overlay1), hex(color.parse("#64887b")));
  assert.equal(hex(f.accent), hex(color.parse("#8bcbb1")));
});

test("flavor fills every Catppuccin color, ramps in order", () => {
  const f = flavorFromPalette(palette);
  for (const name of ["rosewater", "pink", "mauve", "peach", "teal", "sky", "sapphire", "lavender"]) {
    assert.ok(f[name] && Number.isFinite(f[name].r), name);
  }
  const ramp = ["surface0", "surface1", "surface2", "overlay0", "overlay2"].map((n) => color.toOklch(f[n]).l);
  assert.deepEqual([...ramp].sort((a, b) => a - b), ramp);
});

test("inverse colors flip lightness", () => {
  const f = flavorFromPalette(palette);
  assert.ok(color.toOklch(f.invbase).l > 0.85, "inverse base is light");
  assert.ok(color.toOklch(f.invtext).l < 0.5, "inverse text is dark");
});

test("render fills palette tokens and expressions", () => {
  const css = render(style([["fade", { r: "accent" }, { n: 30, u: "%" }]], "a{color:owt_text_x;background:owt_e0_x}"), palette);
  assert.equal(css, "a{color:#dfede5;background:rgba(139, 203, 177, 0.3)}");
});

test("darken matches LESS", () => {
  // lessc: darken(#dfede5, 10%) = #bedbca
  const css = render(style([["darken", { r: "text" }, { n: 10, u: "%" }]], "a{color:owt_e0_x}"), palette);
  assert.equal(css, "a{color:#bedbca}");
});

test("url tokens are URL-encoded", () => {
  const css = render(
    style([["fade", { r: "text" }, { n: 50, u: "%" }]], `a{background:url("data:image/svg+xml,fill%3D%22owtu_text_x%22 owtu_e0_x")}`),
    palette,
  );
  assert.match(css, /fill%3D%22%23dfede5%22 rgba%28223%2C237%2C229%2C0\.5%29/);
});

test("color-scheme follows the palette", () => {
  assert.equal(render(style([], "a{color-scheme:owt_scheme_x}"), palette), "a{color-scheme:dark}");
  assert.equal(render(style([], "a{color-scheme:owt_scheme_x}"), { ...palette, mode: "light" }), "a{color-scheme:light}");
});

test("calls LESS can't evaluate stay in the CSS", () => {
  const css = render(style([["rgba", { r: "base" }, { k: "var(--opacity)" }]], "a{color:owt_e0_x}"), palette);
  assert.equal(css, "a{color:rgba(#142620, var(--opacity))}");
});

test("percentages formatted next to a literal % don't double it", () => {
  const css = render(style([["lightness", { r: "base" }]], "a{--l:owt_e0_x%}"), palette);
  assert.match(css, /^a\{--l:\d+(\.\d+)?%\}$/);
});

test("only the requested blocks render", () => {
  assert.equal(render(style([], "a{x:1}", "b{x:2}"), palette, [1]), "b{x:2}");
});

test("matching: domain, subdomain, url-prefix, regexp", () => {
  const index = [
    { id: "gh", blocks: [[["regexp", "https://github.com(?!(/home$)).*$"]], [["domain", "gist.github.com"]]] },
    { id: "yt", blocks: [[["domain", "youtube.com"]], [["url-prefix", "https://studio.youtube.com"]]] },
  ];
  assert.deepEqual(match(index, "https://github.com/foo").site, { style: index[0], blocks: [0] });
  assert.equal(match(index, "https://github.com/home").site, null);
  assert.deepEqual(match(index, "https://gist.github.com/x").site.blocks, [1]);
  assert.deepEqual(match(index, "https://www.youtube.com/watch").site.blocks, [0]);
  assert.deepEqual(match(index, "https://studio.youtube.com/").site.blocks, [0, 1]);
  assert.deepEqual(match(index, "https://example.com/"), { site: null, addons: [] });
  assert.deepEqual(match(index, "not a url"), { site: null, addons: [] });
});

test("add-on styles never take a site's own style's place", () => {
  // Shinigami Eyes (another extension's UI) sorts before YouTube and matches it.
  const index = [
    { id: "shinigami-eyes", addon: true, blocks: [[["domain", "youtube.com"], ["domain", "reddit.com"]]] },
    { id: "youtube", blocks: [[["domain", "youtube.com"]]] },
  ];
  const yt = match(index, "https://www.youtube.com/");
  assert.equal(yt.site.style.id, "youtube");
  assert.deepEqual(yt.addons.map((a) => a.style.id), ["shinigami-eyes"]);
  const reddit = match(index, "https://www.reddit.com/");
  assert.equal(reddit.site, null);
  assert.deepEqual(reddit.addons.map((a) => a.style.id), ["shinigami-eyes"]);
});

test("lightness helper sanity", () => {
  assert.ok(lightness("#000") < lightness("#fff"));
});

const test = require("node:test");
const assert = require("node:assert/strict");

const color = require("../extension/lib/color.js");
const { createMapper, roleForProperty } = require("../extension/lib/mapper.js");
const { adapterFor } = require("../extension/adapters/index.js");

// The jade "Year of the Horse" palette.
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
    bright_foreground: "#f0faf4",
    red: "#d88d91",
    yellow: "#c5cc91",
    orange: "#d2ab8d",
    green: "#8bcbb1",
    cyan: "#86c7c5",
    blue: "#96b7d0",
    magenta: "#b7a1c8",
  },
};

const rgbOf = (hex) => color.format(color.parse(hex));

test("parses hex, rgb, modern rgb, hsl and named colors", () => {
  assert.deepEqual(color.parse("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(color.parse("#00000080").a.toFixed(2), "0.50");
  assert.deepEqual(color.parse("rgba(10, 20, 30, 0.5)"), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(color.parse("rgb(10 20 30 / 25%)"), { r: 10, g: 20, b: 30, a: 0.25 });
  assert.equal(color.key(color.parse("hsl(0, 100%, 50%)")), "255,0,0");
  assert.equal(color.key(color.parse("white")), "255,255,255");
  assert.equal(color.parse("var(--x)"), null);
  assert.equal(color.parse("currentColor"), null);
});

test("OKLCH round-trips", () => {
  for (const hex of ["#142620", "#1d9bf0", "#ffffff", "#000000", "#d88d91"]) {
    const rgb = color.parse(hex);
    assert.equal(color.key(color.fromOklch(color.toOklch(rgb))), color.key(rgb), hex);
  }
});

test("replaceColors leaves url() alone", () => {
  const out = color.replaceColors("url(white.png), linear-gradient(#000, white)", () => "X");
  assert.equal(out, "url(white.png), linear-gradient(X, X)");
});

test("roles come from property names", () => {
  assert.equal(roleForProperty("color"), "text");
  assert.equal(roleForProperty("background-color"), "surface");
  assert.equal(roleForProperty("border-top-color"), "border");
  assert.equal(roleForProperty("--bgColor-default"), "surface");
  assert.equal(roleForProperty("--fgColor-muted"), "text");
  assert.equal(roleForProperty("--borderColor-default"), "border");
  assert.equal(roleForProperty("--brand"), "unknown");
});

test("a dark site's page background becomes the theme background", () => {
  const m = createMapper(palette, { baseBackground: color.parse("#0d1117") });
  assert.equal(m.flip, false);
  assert.equal(m.map("#0d1117", "surface"), rgbOf("#142620"));
});

test("raised surfaces stay lighter than the page", () => {
  const m = createMapper(palette, { baseBackground: color.parse("#0d1117") });
  const page = color.toOklch(color.parse(m.map("#0d1117", "surface")));
  const card = color.toOklch(color.parse(m.map("#161b22", "surface")));
  const inset = color.toOklch(color.parse(m.map("#010409", "surface")));
  assert.ok(card.l > page.l, "card lighter than page");
  assert.ok(inset.l < page.l, "inset darker than page");
});

test("light sites are mirrored under a dark theme", () => {
  const m = createMapper(palette, { baseBackground: color.parse("#ffffff") });
  assert.equal(m.flip, true);
  assert.equal(m.map("#ffffff", "surface"), rgbOf("#142620"));
  // Near-black body text becomes light theme text.
  const text = color.toOklch(color.parse(m.map("#1f2328", "text")));
  assert.ok(text.l > 0.8, `body text too dim: ${text.l}`);
});

test("text snaps to the nearest foreground tier", () => {
  const m = createMapper(palette, { baseBackground: color.parse("#000") });
  assert.equal(m.map("rgb(231, 233, 234)", "text"), rgbOf("#dfede5"));
  // Secondary gray on black lands on a dimmer tier than body text.
  assert.equal(m.map("rgb(113, 118, 123)", "text"), rgbOf("#91ad9f"));
});

test("chromatic colors take the nearest theme hue, brand hue takes accent", () => {
  const plain = createMapper(palette, { baseBackground: color.parse("#000") });
  const red = color.toOklch(color.parse(plain.map("#ff0000", "text")));
  assert.ok(color.hueDistance(red.h, color.toOklch(color.parse("#d88d91")).h) < 5);

  const brandHue = color.toOklch(color.parse("#1d9bf0")).h;
  const branded = createMapper(palette, { baseBackground: color.parse("#000"), brandHue });
  const blue = color.toOklch(color.parse(branded.map("#1d9bf0", "text")));
  assert.ok(color.hueDistance(blue.h, color.toOklch(color.parse("#8bcbb1")).h) < 5);
});

test("alpha survives mapping", () => {
  const m = createMapper(palette, { baseBackground: color.parse("#000") });
  assert.match(m.map("rgba(231, 233, 234, 0.1)", "surface"), /rgba\(.*, 0\.1\)$/);
});

test("mapValue rewrites every color in a value", () => {
  const m = createMapper(palette, { baseBackground: color.parse("#000") });
  const out = m.mapValue("0 1px 2px rgba(0,0,0,.5), 0 0 0 1px #2f3336", "box-shadow");
  assert.doesNotMatch(out, /#2f3336/);
  assert.match(out, /^0 1px 2px rgba\(/);
});

test("x.com adapter maps its fixed colors to exact slots", () => {
  const x = adapterFor("x.com");
  const m = createMapper(palette, { baseBackground: color.parse("#000"), colorMap: x.colorMap });
  assert.equal(m.map("rgb(29, 155, 240)", "text"), rgbOf("#8bcbb1"));
  assert.equal(m.map("rgb(47, 51, 54)", "border"), rgbOf("#2b5147"));
  assert.equal(adapterFor("example.com"), null);
});

test("adapter css fills every variable with a palette color", () => {
  const slots = Object.fromEntries(Object.entries(palette.colors).map(([k, v]) => [k, rgbOf(v)]));
  for (const host of ["github.com", "www.youtube.com"]) {
    const css = adapterFor(host).css(slots);
    assert.doesNotMatch(css, /undefined/, host);
  }
});

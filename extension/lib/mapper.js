// Role-based palette mapping: turns any site color into an Omarchy color.
//
// Neutrals (grays, near-blacks, near-whites) keep their *relative* lightness
// to the page background, so a site's card/hover/border hierarchy survives,
// but they take the theme background's hue. Chromatic colors snap to the theme
// color with the nearest hue; the site's dominant brand hue becomes `accent`.
(function (root) {
  const OWT = (root.OWT = root.OWT || {});
  const color = OWT.color || require("./color.js");

  const NEUTRAL_CHROMA = 0.04;
  const SNAP_DISTANCE = 0.015;
  // Light sites separate surfaces by tiny lightness steps (white page, #f6f8fa
  // card); widen them so cards stay visible against a dark theme background.
  const SURFACE_STEP_SCALE = 1.6;
  // Text sitting this close to the page background is inverse text on a
  // filled button or badge, not dim body text.
  const INVERSE_TEXT = 0.2;
  const BRAND_HUE_RANGE = 20;

  const SURFACES = [
    "darker_background",
    "dark_background",
    "background",
    "lighter_background",
    "selection",
  ];
  const TEXTS = ["muted", "dark_foreground", "light_foreground", "foreground", "bright_foreground"];
  const HUES = ["red", "orange", "yellow", "green", "cyan", "blue", "magenta"];

  // Name hints for CSS custom properties, whose role is otherwise unknown.
  const ROLE_HINTS = [
    [/border|divider|outline|separator|stroke|line/, "border"],
    [/(^|-)(fg|text|foreground|font|ink|icon)(-|$)|text-color|fgcolor/, "text"],
    [/(^|-)(bg|background|surface|canvas|base|layer|backdrop|overlay|card|panel)(-|$)|bgcolor/, "surface"],
  ];

  function roleForProperty(property) {
    if (property === "color" || property === "caret-color" || property === "fill") return "text";
    if (property === "text-decoration-color" || property === "text-shadow") return "text";
    if (property.startsWith("background")) return "surface";
    if (/border|outline|column-rule|stroke/.test(property)) return "border";
    if (property === "box-shadow") return "border";
    if (property.startsWith("--")) {
      const name = property.toLowerCase();
      for (const [pattern, role] of ROLE_HINTS) if (pattern.test(name)) return role;
    }
    return "unknown";
  }

  // palette: {mode, colors: {background: "#142620", ...}} from the native host.
  // options.baseBackground: the site's own page background (parsed color).
  // options.baseText: the site's own body text color (parsed color).
  // options.brandHue: the site's dominant chromatic hue, if one was found.
  // options.colorMap: adapter table of exact colors -> palette slot names.
  function createMapper(palette, options = {}) {
    const slots = {};
    for (const [name, hex] of Object.entries(palette.colors)) {
      const parsed = color.parse(hex);
      if (parsed) slots[name] = { rgb: parsed, lch: color.toOklch(parsed) };
    }
    const slot = (name) => slots[name] || slots.background || slots.foreground;
    const present = (names) => names.filter((n) => slots[n]).sort((a, b) => slots[a].lch.l - slots[b].lch.l);

    const surfaces = present(SURFACES);
    const texts = present(TEXTS);
    const hues = HUES.filter((n) => slots[n]);
    const bg = slot("background").lch;
    const themeDark = palette.mode !== "light";

    const base = options.baseBackground ? color.toOklch(options.baseBackground) : null;
    const siteDark = base ? base.l < 0.5 : themeDark;
    // A light site under a dark theme (or vice versa) is mirrored in lightness.
    const flip = siteDark !== themeDark;
    const baseL = base ? (flip ? 1 - base.l : base.l) : bg.l;

    // Text is matched by contrast, not raw lightness: how far a color sits from
    // its page background, as a share of the furthest it could sit. A light
    // site's near-black body text and a dark site's near-white text both come
    // out around 0.75-0.95 and land on the same theme tier.
    const contrast = (l, pageL, dark) =>
      Math.min(1, Math.max(0, (dark ? l - pageL : pageL - l) / (dark ? 1 - pageL : pageL)));
    const siteBaseL = base ? base.l : bg.l;
    const textTiers = texts.map((n) => [n, contrast(slots[n].lch.l, bg.l, themeDark)]);
    // Calibrate so the site's body text lands exactly on `foreground`; every
    // other text color keeps its contrast relative to it.
    const fgTier = textTiers.find(([n]) => n === "foreground");
    const baseText = options.baseText ? contrast(color.toOklch(options.baseText).l, siteBaseL, siteDark) : 0;
    const textScale = fgTier && baseText > 0.3 ? fgTier[1] / baseText : 1;

    const colorMap = options.colorMap || {};
    const cache = new Map();

    function withAlpha(rgb, a) {
      return color.format({ ...rgb, a });
    }

    function nearestByLightness(names, l) {
      let best = names[0];
      for (const n of names) if (Math.abs(slots[n].lch.l - l) < Math.abs(slots[best].lch.l - l)) best = n;
      return best;
    }

    function mapNeutral(lch, role) {
      const l = flip ? 1 - lch.l : lch.l;

      if (role === "unknown") role = (themeDark ? l < 0.5 : l > 0.5) ? "surface" : "text";

      if (role === "text") {
        const raw = contrast(lch.l, siteBaseL, siteDark);
        if (raw < INVERSE_TEXT) return mapNeutral(lch, "surface");
        const target = raw * textScale;
        let best = textTiers[0];
        for (const tier of textTiers) if (Math.abs(tier[1] - target) < Math.abs(best[1] - target)) best = tier;
        return withAlpha(slots[best[0]].rgb, lch.a);
      }

      // Surfaces and borders: keep the offset from the page background.
      const step = (l - baseL) * (flip ? SURFACE_STEP_SCALE : 1);
      const target = Math.min(1, Math.max(0, bg.l + step));
      const tier = nearestByLightness(surfaces, target);
      if (Math.abs(slots[tier].lch.l - target) <= SNAP_DISTANCE) return withAlpha(slots[tier].rgb, lch.a);
      return color.format(color.fromOklch({ l: target, c: bg.c, h: bg.h, a: lch.a }));
    }

    function mapChromatic(lch) {
      let name = "accent";
      if (!(slots.accent && options.brandHue !== undefined && color.hueDistance(lch.h, options.brandHue) <= BRAND_HUE_RANGE)) {
        name = hues[0];
        for (const n of hues) {
          if (color.hueDistance(lch.h, slots[n].lch.h) < color.hueDistance(lch.h, slots[name].lch.h)) name = n;
        }
      }
      if (!name) return null;

      // Keep a little of the source lightness so hover/pressed states stay
      // distinct. Not mirrored: a blue stays about as bright as it was.
      const target = slots[name].lch;
      return color.format(
        color.fromOklch({ l: target.l + (lch.l - target.l) * 0.3, c: target.c, h: target.h, a: lch.a }),
      );
    }

    function mapParsed(rgb, role) {
      const mapped = colorMap[color.key(rgb)];
      if (mapped && slots[mapped]) return withAlpha(slots[mapped].rgb, rgb.a);

      const lch = color.toOklch(rgb);
      if (lch.c < NEUTRAL_CHROMA) return mapNeutral(lch, role);

      // Faintly tinted surfaces near the page background are still surfaces.
      const l = flip ? 1 - lch.l : lch.l;
      if (role === "surface" && lch.c < 0.08 && Math.abs(l - baseL) < 0.15) return mapNeutral(lch, role);

      return mapChromatic(lch) || mapNeutral(lch, role);
    }

    // Map one CSS color token. Returns null to leave the token unchanged.
    function map(token, role) {
      const cacheKey = role + "|" + token;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const rgb = color.parse(token);
      const result = rgb ? mapParsed(rgb, role) : null;
      cache.set(cacheKey, result);
      return result;
    }

    // Map every color inside a full CSS value (shadows, gradients, ...).
    function mapValue(value, property) {
      const role = roleForProperty(property);
      return color.replaceColors(value, (token) => map(token, role) || token);
    }

    return { map, mapValue, flip, siteDark };
  }

  OWT.mapper = { createMapper, roleForProperty };

  if (typeof module !== "undefined") module.exports = OWT.mapper;
})(globalThis);

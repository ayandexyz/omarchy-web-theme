// Runtime for the compiled Catppuccin adapters (scripts/build-catppuccin.mjs).
//
// Compiled CSS holds tokens instead of colors: `owt_base_x` is a palette color,
// `owt_e12_x` is expression 12 (e.g. darken(base, 5%)), `owt_scheme_x` is the
// color-scheme keyword. Tokens spelled `owtu_..._x` sit inside url(...) and
// get URL-safe output. This file builds a Catppuccin flavor out of the Omarchy
// palette, evaluates the expressions with LESS's own color math, and renders.
(function (root) {
  const OWT = (root.OWT = root.OWT || {});
  const color = OWT.color || require("./color.js");

  // ---- Omarchy palette -> Catppuccin flavor --------------------------------

  function mixLab(a, b, t) {
    const x = color.toOklch(a);
    const y = color.toOklch(b);
    const toLab = (c) => [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)];
    const [l1, a1, b1] = toLab(x);
    const [l2, a2, b2] = toLab(y);
    const L = l1 + (l2 - l1) * t;
    const A = a1 + (a2 - a1) * t;
    const B = b1 + (b2 - b1) * t;
    const h = (Math.atan2(B, A) * 180) / Math.PI;
    return color.fromOklch({ l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h, a: 1 });
  }

  function flavorFromPalette(palette) {
    const p = {};
    for (const [name, hex] of Object.entries(palette.colors || {})) {
      const parsed = color.parse(hex);
      if (parsed) p[name] = parsed;
    }
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const dark = palette.mode !== "light";

    const base = p.background || (dark ? { r: 30, g: 30, b: 46, a: 1 } : { r: 239, g: 241, b: 245, a: 1 });
    const text = p.foreground || (dark ? white : black);
    const away = dark ? black : white;
    const mantle = p.dark_background || mixLab(base, away, 0.15);
    const crust = p.darker_background || mixLab(base, away, 0.3);
    const surface0 = p.lighter_background || mixLab(base, text, 0.1);
    const ramp = (t) => mixLab(surface0, text, t);

    const red = p.red || { r: 220, g: 90, b: 90, a: 1 };
    const yellow = p.yellow || mixLab(red, { r: 255, g: 220, b: 0, a: 1 }, 0.8);
    const green = p.green || { r: 120, g: 190, b: 120, a: 1 };
    const blue = p.blue || { r: 110, g: 150, b: 230, a: 1 };
    const cyan = p.cyan || mixLab(green, blue, 0.5);
    const magenta = p.magenta || mixLab(red, blue, 0.5);

    const flavor = {
      base,
      mantle,
      crust,
      surface0,
      surface1: ramp(0.12),
      surface2: ramp(0.24),
      overlay0: ramp(0.36),
      overlay1: p.muted || ramp(0.48),
      overlay2: ramp(0.58),
      subtext0: p.dark_foreground || ramp(0.7),
      subtext1: p.light_foreground || ramp(0.84),
      text,
      rosewater: mixLab(red, text, 0.6),
      flamingo: mixLab(red, text, 0.4),
      pink: p.bright_magenta || mixLab(magenta, text, 0.25),
      mauve: magenta,
      red,
      maroon: p.bright_red || mixLab(red, text, 0.2),
      peach: p.orange || mixLab(red, yellow, 0.5),
      yellow,
      green,
      teal: cyan,
      sky: p.bright_cyan || mixLab(cyan, text, 0.2),
      sapphire: mixLab(cyan, blue, 0.5),
      blue,
      lavender: p.bright_blue || mixLab(blue, magenta, 0.3),
      accent: p.accent || blue,
    };
    // Some styles borrow the opposite flavor on purpose (an "inverse primary"
    // for snackbars, say). Those are `inv<name>` tokens: same hue and chroma,
    // lightness mirrored the way Catppuccin's Mocha and Latte mirror each other.
    for (const [name, c] of Object.entries(flavor)) flavor[`inv${name}`] = invert(c);
    return flavor;
  }

  function invert(c) {
    const lch = color.toOklch(c);
    return color.fromOklch({ ...lch, l: Math.min(0.97, Math.max(0.1, 1.32 - lch.l)) });
  }

  // ---- LESS color functions -------------------------------------------------
  // Same math as less/lib/less/functions/color.js, on {r, g, b, a} (0..255).

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function toHsl({ r, g, b, a }) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    // h / 6 * 360 rather than h * 60: the same float path as LESS's toHSL.
    return { h: h * 360, s, l, a };
  }

  function fromHsl(h, s, l, a) {
    // Plain `h % 360` as in LESS's hsla(); hue() below wraps negatives.
    h = (h % 360) / 360;
    const m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
    const m1 = l * 2 - m2;
    const hue = (x) => {
      x = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
      if (x * 6 < 1) return m1 + (m2 - m1) * x * 6;
      if (x * 2 < 1) return m2;
      if (x * 3 < 2) return m1 + (m2 - m1) * (2 / 3 - x) * 6;
      return m1;
    };
    return { r: hue(h + 1 / 3) * 255, g: hue(h) * 255, b: hue(h - 1 / 3) * 255, a };
  }

  function luma({ r, g, b }) {
    const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function mix(c1, c2, weight = 50) {
    const p = weight / 100;
    const w = p * 2 - 1;
    const da = c1.a - c2.a;
    const w1 = ((w * da === -1 ? w : (w + da) / (1 + w * da)) + 1) / 2;
    const w2 = 1 - w1;
    return {
      r: c1.r * w1 + c2.r * w2,
      g: c1.g * w1 + c2.g * w2,
      b: c1.b * w1 + c2.b * w2,
      a: c1.a * p + c2.a * (1 - p),
    };
  }

  const BLEND = {
    multiply: (cb, cs) => cb * cs,
    screen: (cb, cs) => cb + cs - cb * cs,
    overlay: (cb, cs) => ((cb *= 2) <= 1 ? BLEND.multiply(cb, cs) : BLEND.screen(cb - 1, cs)),
    softlight: (cb, cs) => {
      let d = 1;
      let e = cb;
      if (cs > 0.5) {
        e = 1;
        d = cb > 0.25 ? Math.sqrt(cb) : ((16 * cb - 12) * cb + 4) * cb;
      }
      return cb - (1 - 2 * cs) * e * (d - cb);
    },
    hardlight: (cb, cs) => BLEND.overlay(cs, cb),
    difference: (cb, cs) => Math.abs(cb - cs),
    exclusion: (cb, cs) => cb + cs - 2 * cb * cs,
    average: (cb, cs) => (cb + cs) / 2,
    negation: (cb, cs) => 1 - Math.abs(cb + cs - 1),
  };

  function blend(mode, c1, c2) {
    const ab = c1.a;
    const as = c2.a;
    const ar = as + ab * (1 - as);
    const out = { a: ar };
    for (const ch of ["r", "g", "b"]) {
      const cb = c1[ch] / 255;
      const cs = c2[ch] / 255;
      let cr = BLEND[mode](cb, cs);
      if (ar) cr = (as * cs + ab * (cb - as * (cb + cs - cr))) / ar;
      out[ch] = cr * 255;
    }
    return out;
  }

  const num = (v) => ({ n: v, u: "" });
  const pct = (v) => ({ n: v, u: "%" });
  const amount = (arg) => (arg && typeof arg.n === "number" ? arg.n / 100 : 0);
  // number() in LESS: percentages become fractions, plain numbers stay.
  const fraction = (arg) => (arg.u === "%" ? arg.n / 100 : arg.n);

  function adjustHsl(c, key, delta, method) {
    const hsl = toHsl(c);
    hsl[key] = clamp01(method === "relative" ? hsl[key] + hsl[key] * delta : hsl[key] + delta);
    return fromHsl(hsl.h, hsl.s, hsl.l, hsl.a);
  }

  // LESS sets alpha through an HSL round trip; its float error decides how
  // some channels round, so do the same to match its output exactly.
  function withAlpha(c, a) {
    const hsl = toHsl(c);
    return fromHsl(hsl.h, hsl.s, hsl.l, clamp01(a));
  }

  const FUNCTIONS = {
    fade: (c, a) => withAlpha(c, amount(a)),
    fadein: (c, a, m) => withAlpha(c, m?.k === "relative" ? c.a + c.a * amount(a) : c.a + amount(a)),
    fadeout: (c, a, m) => withAlpha(c, m?.k === "relative" ? c.a - c.a * amount(a) : c.a - amount(a)),
    darken: (c, a, m) => adjustHsl(c, "l", -amount(a), m?.k),
    lighten: (c, a, m) => adjustHsl(c, "l", amount(a), m?.k),
    saturate: (c, a, m) => adjustHsl(c, "s", amount(a), m?.k),
    desaturate: (c, a, m) => adjustHsl(c, "s", -amount(a), m?.k),
    greyscale: (c) => adjustHsl(c, "s", -1),
    spin: (c, a) => {
      const hsl = toHsl(c);
      return fromHsl(hsl.h + a.n, hsl.s, hsl.l, hsl.a);
    },
    mix: (c1, c2, w) => mix(c1, c2, w ? w.n : 50),
    tint: (c, w) => mix({ r: 255, g: 255, b: 255, a: 1 }, c, w ? w.n : 50),
    shade: (c, w) => mix({ r: 0, g: 0, b: 0, a: 1 }, c, w ? w.n : 50),
    contrast: (c, dark = { r: 0, g: 0, b: 0, a: 1 }, light = { r: 255, g: 255, b: 255, a: 1 }, threshold) => {
      if (luma(dark) > luma(light)) [dark, light] = [light, dark];
      const t = threshold ? fraction(threshold) : 0.43;
      return luma(c) * c.a < t ? light : dark;
    },
    hue: (c) => num(toHsl(c).h),
    saturation: (c) => pct(toHsl(c).s * 100),
    lightness: (c) => pct(toHsl(c).l * 100),
    red: (c) => num(c.r),
    green: (c) => num(c.g),
    blue: (c) => num(c.b),
    alpha: (c) => num(c.a),
    luma: (c) => pct(luma(c) * c.a * 100),
    luminance: (c) => pct((0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 * c.a * 100),
    hsl: (h, s, l, a) => hslOf(h, s, l, a),
    hsla: (h, s, l, a) => hslOf(h, s, l, a),
    rgb: (r, g, b, a) => rgbOf(r, g, b, a),
    rgba: (r, g, b, a) => rgbOf(r, g, b, a),
  };
  for (const mode of Object.keys(BLEND)) FUNCTIONS[mode] = (c1, c2) => blend(mode, c1, c2);

  // rgba(@color, 0.4) and hsla(@color, 0.4) only replace the alpha.
  function hslOf(h, s, l, a) {
    if (isColor(h)) return { ...h, a: s ? clamp01(fraction(s)) : h.a };
    return fromHsl(h.n, clamp01(fraction(s)), clamp01(fraction(l)), a ? clamp01(fraction(a)) : 1);
  }

  function rgbOf(r, g, b, a) {
    if (isColor(r)) return { ...r, a: g ? clamp01(fraction(g)) : r.a };
    const ch = (x) => (x.u === "%" ? x.n * 2.55 : x.n);
    return { r: ch(r), g: ch(g), b: ch(b), a: a ? clamp01(fraction(a)) : 1 };
  }

  // ---- Evaluation and rendering ---------------------------------------------

  const isColor = (v) => v && typeof v.r === "number";
  const valid = (v) =>
    v && (isColor(v) ? [v.r, v.g, v.b, v.a].every(Number.isFinite) : typeof v.n === "number" ? Number.isFinite(v.n) : v.k !== undefined);

  function createEvaluator(exprs, flavor) {
    const values = new Map();

    function arg(a) {
      if (a.r !== undefined) return flavor[a.r];
      if (a.e !== undefined) return value(a.e);
      if (a.c !== undefined) return { r: a.c[0], g: a.c[1], b: a.c[2], a: a.a ?? 1 };
      return a;
    }

    function value(id) {
      if (!values.has(id)) {
        const [fn, ...args] = exprs[id];
        const resolved = args.map(arg);
        let result;
        try {
          result = FUNCTIONS[fn](...resolved);
        } catch {
          result = undefined;
        }
        // LESS leaves a call it can't evaluate in the CSS as written, like
        // rgba(@base, var(--opacity)), for the browser to resolve.
        if (!valid(result)) result = { k: `${fn}(${resolved.map((v) => formatValue(v, false) ?? "").join(", ")})` };
        values.set(id, result);
      }
      return values.get(id);
    }

    return (name) => (/^e\d+$/.test(name) ? value(+name.slice(1)) : flavor[name]);
  }

  const round = (v, digits) => +v.toFixed(digits);
  const hex = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");

  function formatValue(v, inUrl) {
    if (isColor(v)) {
      const a = round(v.a ?? 1, 3);
      if (a >= 1) return `${inUrl ? "%23" : "#"}${hex(v.r)}${hex(v.g)}${hex(v.b)}`;
      const body = [v.r, v.g, v.b].map((x) => Math.round(Math.min(255, Math.max(0, x)))).concat(a);
      return inUrl ? `rgba%28${body.join("%2C")}%29` : `rgba(${body.join(", ")})`;
    }
    if (v && typeof v.n === "number") return `${round(v.n, 8)}${v.u || ""}`;
    if (v && v.k !== undefined) return v.k;
    return null;
  }

  // Render a compiled style's CSS for one palette: the given blocks, or all.
  function render(style, palette, blocks) {
    return renderFlavor(style, flavorFromPalette(palette), palette.mode === "light" ? "light" : "dark", blocks);
  }

  function renderFlavor(style, flavor, scheme, blocks) {
    const lookup = createEvaluator(style.exprs, flavor);
    return (blocks ? blocks.map((i) => style.blocks[i]) : style.blocks)
      .join("\n")
      .replace(/owt(u?)_(\w+?)_x/g, (token, url, name, offset, css) => {
        if (name === "scheme") return scheme;
        const value = lookup(name);
        // A percentage formatted into a string that already writes "%"
        // (`%("%s%", lightness(@c))`): LESS prints the bare number there.
        if (value?.u === "%" && css[offset + token.length] === "%") return formatValue({ n: value.n }, false);
        return formatValue(value, !!url) ?? "transparent";
      });
  }

  // ---- Matching ---------------------------------------------------------------

  function matches([type, value], url) {
    switch (type) {
      case "domain":
        return url.hostname === value || url.hostname.endsWith("." + value);
      case "url-prefix":
        return url.href.startsWith(value);
      case "url":
        return url.href === value;
      case "regexp":
        try {
          return new RegExp(`^(?:${value})$`).test(url.href);
        } catch {
          return false;
        }
    }
    return false;
  }

  // Every style that applies to a URL, as [{style, blocks}] in index order.
  function matchAll(index, href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return [];
    }
    const found = [];
    for (const style of index) {
      const blocks = style.blocks.flatMap((matchers, i) => (matchers.some((m) => matches(m, url)) ? [i] : []));
      if (blocks.length) found.push({ style, blocks });
    }
    return found;
  }

  // The site's own style and the add-on styles (other extensions' UI) that
  // apply to a URL: {site: {style, blocks} | null, addons: [...]}.
  function match(index, href) {
    const found = matchAll(index, href);
    return { site: found.find((f) => !f.style.addon) || null, addons: found.filter((f) => f.style.addon) };
  }

  OWT.catppuccin = { flavorFromPalette, render, renderFlavor, match };

  if (typeof module !== "undefined") module.exports = OWT.catppuccin;
})(globalThis);

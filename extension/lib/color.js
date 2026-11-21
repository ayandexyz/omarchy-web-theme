// Color parsing and OKLCH conversion. Shared by the content script (as a
// global on OWT) and the Node tests (as a CommonJS module).
(function (root) {
  const OWT = (root.OWT = root.OWT || {});

  const NAMED = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    silver: [192, 192, 192],
    whitesmoke: [245, 245, 245],
    gainsboro: [220, 220, 220],
    lightgray: [211, 211, 211],
    lightgrey: [211, 211, 211],
    darkgray: [169, 169, 169],
    darkgrey: [169, 169, 169],
    dimgray: [105, 105, 105],
    dimgrey: [105, 105, 105],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    yellow: [255, 255, 0],
    orange: [255, 165, 0],
    purple: [128, 0, 128],
  };

  // Matches one color inside a CSS value. url(...) segments are protected by
  // the caller, so named colors inside file names are not touched.
  const COLOR_TOKEN = new RegExp(
    "#[0-9a-fA-F]{3,8}\\b|(?:rgba?|hsla?)\\([^()]*\\)|\\b(?:" +
      Object.keys(NAMED).join("|") +
      ")\\b",
    "g",
  );

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function parseAlpha(part) {
    if (part === undefined) return 1;
    return part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part);
  }

  function parseChannel(part) {
    return part.endsWith("%") ? (parseFloat(part) * 255) / 100 : parseFloat(part);
  }

  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }

  // Returns {r, g, b, a} with r/g/b in 0..255, or null for anything unparsed
  // (currentColor, var(), color-mix(), ...), which callers leave alone.
  function parse(input) {
    const value = input.trim().toLowerCase();

    if (value === "transparent") return null;
    if (NAMED[value]) {
      const [r, g, b] = NAMED[value];
      return { r, g, b, a: 1 };
    }

    if (value.startsWith("#")) {
      let hex = value.slice(1);
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
      if (hex.length !== 6 && hex.length !== 8) return null;
      const n = (i) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }

    const fn = value.match(/^(rgba?|hsla?)\((.*)\)$/);
    if (!fn) return null;
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.some((p) => p.includes("var("))) return null;

    if (fn[1].startsWith("rgb")) {
      return {
        r: clamp(parseChannel(parts[0]), 0, 255),
        g: clamp(parseChannel(parts[1]), 0, 255),
        b: clamp(parseChannel(parts[2]), 0, 255),
        a: clamp(parseAlpha(parts[3]), 0, 1),
      };
    }

    const [r, g, b] = hslToRgb(
      parseFloat(parts[0]),
      clamp(parseFloat(parts[1]) / 100, 0, 1),
      clamp(parseFloat(parts[2]) / 100, 0, 1),
    );
    return { r, g, b, a: clamp(parseAlpha(parts[3]), 0, 1) };
  }

  const toLinear = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const fromLinear = (c) =>
    255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function toOklch({ r, g, b, a }) {
    const lr = toLinear(r);
    const lg = toLinear(g);
    const lb = toLinear(b);

    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

    const h = (Math.atan2(B, A) * 180) / Math.PI;
    return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h, a };
  }

  function fromOklch({ l, c, h, a }) {
    const rad = (h * Math.PI) / 180;
    const A = c * Math.cos(rad);
    const B = c * Math.sin(rad);

    const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;

    return {
      r: clamp(fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_), 0, 255),
      g: clamp(fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_), 0, 255),
      b: clamp(fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_), 0, 255),
      a: a === undefined ? 1 : a,
    };
  }

  function format({ r, g, b, a }) {
    const rgb = `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
    return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${+a.toFixed(3)})`;
  }

  // Key for exact-match color tables (adapters): alpha is ignored so a site's
  // translucent hover tint maps with its solid parent.
  function key({ r, g, b }) {
    return `${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
  }

  function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // Replace every color in a CSS value, leaving url(...) untouched.
  function replaceColors(value, replacer) {
    return value
      .split(/(url\([^)]*\))/i)
      .map((part, i) => (i % 2 ? part : part.replace(COLOR_TOKEN, replacer)))
      .join("");
  }

  OWT.color = { parse, toOklch, fromOklch, format, key, hueDistance, replaceColors };

  if (typeof module !== "undefined") module.exports = OWT.color;
})(globalThis);

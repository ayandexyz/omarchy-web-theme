// The general engine. It never edits a site's own rules: it reads every color
// declaration from the page's stylesheets, maps it through the palette, and
// writes the result into one override sheet with the same selectors. That
// sheet is adopted, so it cascades after all of the page's own CSS: with equal
// specificity it wins without !important, which it only copies from the
// original declaration. So an adapter (a Catppuccin community style, with its
// more specific selectors) layered on top still wins wherever it says
// something, and the engine fills in what it doesn't cover.
// Inline style attributes are rewritten in place, keeping the originals so a
// theme change or toggle-off can restore them.
(function (root) {
  const OWT = (root.OWT = root.OWT || {});

  const COLOR_PROPS = new Set([
    "color",
    "background-color",
    "background-image",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-block-start-color",
    "border-block-end-color",
    "border-inline-start-color",
    "border-inline-end-color",
    "outline-color",
    "column-rule-color",
    "text-decoration-color",
    "caret-color",
    "accent-color",
    "fill",
    "stroke",
    "box-shadow",
    "text-shadow",
  ]);

  const RESCAN_MS = 1500;

  const isColorProp = (prop) => COLOR_PROPS.has(prop) || prop.startsWith("--");

  function createEngine({ palette, adapter, fetchCss }) {
    const { color, mapper: mapperLib } = OWT;
    const doc = document;

    let mapper = null;
    let processed = new WeakSet();
    const fetched = new Set();
    const fetchedSheets = [];
    const inlineOriginals = new WeakMap();
    const inlineMapped = new WeakMap();
    const inlineWritten = new WeakMap();
    let observer = null;
    let timer = null;
    let scheduled = false;

    const slots = {};
    for (const [name, hex] of Object.entries(palette.colors)) {
      const parsed = color.parse(hex);
      if (parsed) slots[name] = color.format(parsed);
    }

    // Every sheet of ours is a constructed, adopted sheet: adopted sheets
    // cascade after every document sheet (so ties, !important ones included,
    // go to us), and moving elements around can't drop insertRule() rules.
    //   early    page background before the first scan, so nothing flashes;
    //            its body rule is dropped once the real mapping is in
    //   out      the general engine's mapped rules
    //   adapter  a site adapter or community style, on top of the engine
    //   extra    add-on styles (other extensions' UI), on top of everything
    const generic = adapter?.generic !== false;
    const scheme = palette.mode === "light" ? "light" : "dark";
    const htmlRule = `html { background-color: ${slots.background} !important; color-scheme: ${scheme}; }`;
    const early = new CSSStyleSheet();
    early.replaceSync(htmlRule + (generic ? ` body { background-color: ${slots.background} !important; }` : ""));
    let out = null;
    let adapterSheet = null;
    let extraSheet = null;

    function keepAdopted() {
      const ours = [early, out, adapterSheet, extraSheet].filter(Boolean);
      const current = doc.adoptedStyleSheets;
      if (ours.every((s, i) => current[current.length - ours.length + i] === s)) return;
      doc.adoptedStyleSheets = [...current.filter((s) => !ours.includes(s)), ...ours];
    }

    function rulesOf(sheet) {
      try {
        return sheet.cssRules;
      } catch {
        // Cross-origin sheet: fetch its text through the background worker.
        if (sheet.href && !fetched.has(sheet.href)) {
          fetched.add(sheet.href);
          fetchCss(sheet.href).then((text) => {
            if (!text || !out) return;
            const copy = new CSSStyleSheet();
            try {
              copy.replaceSync(text);
            } catch {
              return;
            }
            fetchedSheets.push({ sheet: copy, media: sheet.media?.mediaText });
            schedule();
          });
        }
        return null;
      }
    }

    function* walk(rules, wrappers) {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          yield [rule, wrappers];
        } else if (rule instanceof CSSMediaRule) {
          yield* walk(rule.cssRules, [...wrappers, `@media ${rule.conditionText}`]);
        } else if (rule instanceof CSSSupportsRule) {
          yield* walk(rule.cssRules, [...wrappers, `@supports ${rule.conditionText}`]);
        } else if (typeof CSSContainerRule !== "undefined" && rule instanceof CSSContainerRule) {
          yield* walk(rule.cssRules, [...wrappers, `@container ${rule.conditionText}`]);
        } else if (rule.cssRules) {
          // @layer blocks: our unlayered output already beats layered rules.
          yield* walk(rule.cssRules, wrappers);
        }
      }
    }

    function* allRules() {
      const sheets = [...doc.styleSheets].map((sheet) => ({ sheet, media: sheet.media?.mediaText }));
      for (const { sheet, media } of [...sheets, ...fetchedSheets]) {
        const rules = rulesOf(sheet);
        if (!rules) continue;
        const wrappers = media && media !== "all" ? [`@media ${media}`] : [];
        yield* walk(rules, wrappers);
      }
    }

    function colorDeclarations(style) {
      const found = [];
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (!isColorProp(prop)) continue;
        const value = style.getPropertyValue(prop);
        // Custom properties with quotes are strings, not colors ("black friday").
        if (!value || (prop.startsWith("--") && /["']/.test(value))) continue;
        found.push([prop, value, style.getPropertyPriority(prop)]);
      }
      return found;
    }

    // The site's dominant chromatic hue, in 30-degree buckets, becomes accent.
    function findBrandHue() {
      const buckets = new Array(12).fill(0);
      for (const [rule] of allRules()) {
        for (const [prop, value] of colorDeclarations(rule.style)) {
          if (prop !== "color" && prop !== "background-color" && !prop.startsWith("--")) continue;
          color.replaceColors(value, (token) => {
            const rgb = color.parse(token);
            if (rgb) {
              const lch = color.toOklch(rgb);
              if (lch.c >= 0.08) buckets[Math.floor(lch.h / 30) % 12]++;
            }
            return token;
          });
        }
      }
      const top = buckets.indexOf(Math.max(...buckets));
      return buckets[top] > 0 ? top * 30 + 15 : undefined;
    }

    // The site's own page background and body text, read with our sheets off.
    function siteBase() {
      const ours = [early, out, adapterSheet, extraSheet].filter(Boolean);
      for (const s of ours) s.disabled = true;
      let background = null;
      for (const el of [doc.body, doc.documentElement]) {
        if (!el) continue;
        const rgb = color.parse(getComputedStyle(el).backgroundColor);
        if (rgb && rgb.a > 0.5) {
          background = rgb;
          break;
        }
      }
      const text = color.parse(getComputedStyle(doc.body || doc.documentElement).color);
      for (const s of ours) s.disabled = false;
      // Nothing painted: the browser default canvas, white in a light scheme.
      if (!background && !matchMedia("(prefers-color-scheme: dark)").matches) {
        background = { r: 255, g: 255, b: 255, a: 1 };
      }
      return { background, text };
    }

    function buildMapper() {
      const base = siteBase();
      mapper = mapperLib.createMapper(palette, {
        baseBackground: base.background,
        baseText: base.text,
        brandHue: findBrandHue(),
        colorMap: adapter?.colorMap,
      });
    }

    function rewriteRules() {
      const sheet = out;
      for (const [rule, wrappers] of allRules()) {
        if (processed.has(rule)) continue;
        processed.add(rule);

        const decls = [];
        for (const [prop, value, priority] of colorDeclarations(rule.style)) {
          const mapped = mapper.mapValue(value, prop);
          if (mapped !== value) decls.push(`${prop}: ${mapped}${priority ? " !important" : ""}`);
        }
        if (!decls.length) continue;

        let text = `${rule.selectorText} { ${decls.join("; ")} }`;
        for (const wrapper of [...wrappers].reverse()) text = `${wrapper} { ${text} }`;
        try {
          sheet.insertRule(text, sheet.cssRules.length);
        } catch {
          // Selectors this browser rejects out of context (nested, vendor).
        }
      }
    }

    function rewriteInline(el) {
      const style = el.style;
      if (!style || inlineWritten.get(el) === style.cssText) return;

      // A value we wrote earlier is not a new original: keep the old one, or a
      // site touching one property would get every other one mapped twice.
      const previous = inlineOriginals.get(el) || {};
      const previousMapped = inlineMapped.get(el) || {};
      const originals = {};
      const mapped = {};
      for (let i = 0; i < style.length; i++) {
        const prop = style[i];
        if (!isColorProp(prop)) continue;
        const value = style.getPropertyValue(prop);
        originals[prop] =
          previous[prop] && previousMapped[prop] === value ? previous[prop] : [value, style.getPropertyPriority(prop)];
      }

      for (const [prop, [value, priority]] of Object.entries(originals)) {
        mapped[prop] = mapper.mapValue(value, prop);
        if (mapped[prop] !== style.getPropertyValue(prop)) style.setProperty(prop, mapped[prop], priority);
      }
      inlineOriginals.set(el, originals);
      inlineMapped.set(el, mapped);
      inlineWritten.set(el, style.cssText);
    }

    function restoreInline(el) {
      const originals = inlineOriginals.get(el);
      if (!originals) return;
      for (const [prop, [value, priority]] of Object.entries(originals)) el.style.setProperty(prop, value, priority);
      inlineOriginals.delete(el);
      inlineMapped.delete(el);
      inlineWritten.delete(el);
    }

    function scan() {
      scheduled = false;
      if (!out) return;
      keepAdopted();
      if (generic) {
        rewriteRules();
        for (const el of doc.querySelectorAll("[style]")) rewriteInline(el);
      }
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      setTimeout(scan, 50);
    }

    function onMutations(mutations) {
      for (const m of mutations) {
        if (m.type === "attributes") {
          if (generic && mapper) rewriteInline(m.target);
        } else if (m.type === "characterData" || [...m.addedNodes].some((n) => n.nodeName === "STYLE" || n.nodeName === "LINK")) {
          schedule();
        } else if (generic && mapper) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.hasAttribute("style")) rewriteInline(n);
            for (const child of n.querySelectorAll("[style]")) rewriteInline(child);
          }
        }
      }
    }

    let stopped = false;

    // The adapter needs no page CSS to work from, so it goes on at
    // document_start and the page never shows its own colors first.
    if (adapter?.css) {
      adapterSheet = new CSSStyleSheet();
      adapterSheet.replaceSync(adapter.css(slots));
    }
    if (adapter?.extra) {
      extraSheet = new CSSStyleSheet();
      extraSheet.replaceSync(adapter.extra);
    }
    keepAdopted();

    // Sites switch their own light/dark mode with an attribute on <html> or
    // <body> (YouTube's `dark`, GitHub's `data-color-mode`), without a reload.
    // The mapping depends on which one the site is in, so redo it on a switch.
    const MODE_CHECK_MS = 250;
    let modeObserver = null;
    let modeTimer = null;
    function watchMode() {
      modeObserver = new MutationObserver((mutations) => {
        if (mutations.every((m) => m.attributeName === "style")) return;
        clearTimeout(modeTimer);
        modeTimer = setTimeout(() => {
          if (!out || siteDark(siteBase().background) === mapper.siteDark) return;
          out.replaceSync("");
          processed = new WeakSet();
          for (const el of doc.querySelectorAll("[style]")) restoreInline(el);
          buildMapper();
          scan();
        }, MODE_CHECK_MS);
      });
      for (const el of [doc.documentElement, doc.body]) if (el) modeObserver.observe(el, { attributes: true });
    }

    function siteDark(background) {
      return background ? color.toOklch(background).l < 0.5 : palette.mode !== "light";
    }

    function start() {
      if (stopped) return;
      out = new CSSStyleSheet();
      if (generic) {
        buildMapper();
        watchMode();
      }
      scan();
      // Real mapping is in: the html rule stays as the base, the body rule goes.
      early.replaceSync(htmlRule);

      observer = new MutationObserver(onMutations);
      observer.observe(doc.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style"],
      });
      // Sites like x.com add rules with insertRule(), which no observer sees.
      timer = setInterval(schedule, RESCAN_MS);
    }

    function stop() {
      stopped = true;
      doc.removeEventListener("DOMContentLoaded", start);
      observer?.disconnect();
      modeObserver?.disconnect();
      clearTimeout(modeTimer);
      clearInterval(timer);
      for (const el of doc.querySelectorAll("[style]")) restoreInline(el);
      const ours = [early, out, adapterSheet, extraSheet];
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => !ours.includes(s));
      out = adapterSheet = extraSheet = null;
      processed = new WeakSet();
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }

    return { stop };
  }

  OWT.engine = { createEngine };
})(globalThis);

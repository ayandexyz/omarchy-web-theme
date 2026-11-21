// The general engine. It never edits a site's own rules: it reads every color
// declaration from the page's stylesheets, maps it through the palette, and
// writes the result into one override sheet with the same selectors and
// !important. Inline style attributes are rewritten in place, keeping the
// originals so a theme change or toggle-off can restore them.
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

    function makeStyle(id) {
      const el = doc.createElement("style");
      el.id = id;
      el.dataset.owt = "";
      (doc.head || doc.documentElement).appendChild(el);
      return el;
    }

    // Shown immediately so a page does not flash its own background before the
    // first scan. The body rule is dropped once the real mapping is in place.
    const early = makeStyle("omarchy-web-theme-early");
    const generic = adapter?.generic !== false;
    const scheme = palette.mode === "light" ? "light" : "dark";
    early.textContent =
      `html { background-color: ${slots.background} !important; color-scheme: ${scheme}; }` +
      (generic ? `\nbody { background-color: ${slots.background} !important; }` : "");

    // Constructed sheets: adopted sheets cascade after every document sheet,
    // so ties between !important rules always go to us, and moving <style>
    // elements around can't drop rules added with insertRule().
    let out = null;
    let adapterSheet = null;

    function keepAdopted() {
      const ours = [out, adapterSheet].filter(Boolean);
      const current = doc.adoptedStyleSheets;
      if (ours.every((s, i) => current[current.length - ours.length + i] === s)) return;
      doc.adoptedStyleSheets = [...current.filter((s) => !ours.includes(s)), ...ours];
    }

    function ownSheet(sheet) {
      return sheet.ownerNode?.dataset && "owt" in sheet.ownerNode.dataset;
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
        if (ownSheet(sheet)) continue;
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
        found.push([prop, value]);
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
      early.disabled = true;
      out && (out.disabled = true);
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
      early.disabled = false;
      out && (out.disabled = false);
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
        for (const [prop, value] of colorDeclarations(rule.style)) {
          const mapped = mapper.mapValue(value, prop);
          if (mapped !== value) decls.push(`${prop}: ${mapped} !important`);
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

      for (const [prop, [value]] of Object.entries(originals)) {
        mapped[prop] = mapper.mapValue(value, prop);
        if (mapped[prop] !== style.getPropertyValue(prop)) style.setProperty(prop, mapped[prop], "important");
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

    function start() {
      out = new CSSStyleSheet();
      if (adapter?.css) {
        adapterSheet = new CSSStyleSheet();
        adapterSheet.replaceSync(adapter.css(slots));
      }
      if (generic) buildMapper();
      scan();
      // Real mapping is in: the html rule stays as the base, the body rule goes.
      early.textContent = early.textContent.split("\n")[0];

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
      observer?.disconnect();
      clearInterval(timer);
      for (const el of doc.querySelectorAll("[style]")) restoreInline(el);
      early.remove();
      const ours = [out, adapterSheet];
      doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => !ours.includes(s));
      out = adapterSheet = null;
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

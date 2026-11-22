// Runs in every frame at document_start. Reads the cached palette, picks the
// site's adapter (a Catppuccin community style when one matches, else a
// built-in one), starts the engine, and restarts it whenever the palette, the
// toggles, or the matching style change.
(function () {
  const OWT = globalThis.OWT;
  if (!(document.documentElement instanceof HTMLHtmlElement)) return;

  const host = location.hostname;
  const NAV_CHECK_MS = 1000;
  let engine = null;
  let applied = "";
  let state = null;
  let lastHref = location.href;
  let run = 0;

  function message(msg) {
    return chrome.runtime.sendMessage(msg).catch(() => null);
  }

  function fetchCss(url) {
    return message({ type: "fetch-css", url }).then((reply) => reply?.text || null);
  }

  async function adapterFor(useCommunity) {
    if (useCommunity) {
      const style = await message({ type: "catppuccin", href: location.href });
      const builtin = OWT.adapters.adapterFor(host);
      const extra = style?.addonCss || "";
      if (style?.css) {
        // The general engine still runs underneath: the community style wins
        // wherever it says something (it cascades later, with more specific
        // selectors), and the engine covers what it misses, like CSS a site
        // changed after the style was written (YouTube's hashed variables).
        return { id: `catppuccin:${style.id}:${style.css.length}:${extra.length}`, css: () => style.css, extra };
      }
      // Only add-ons (another extension's UI): the usual adapter, plus them.
      if (extra) return { ...(builtin || {}), id: `${builtin?.id || "generic"}+addons:${extra.length}`, extra };
    }
    return OWT.adapters.adapterFor(host);
  }

  async function apply(next) {
    state = next;
    const { palette, enabled = true, disabledHosts = [], plainHosts = [] } = next;
    const active = palette?.colors && enabled && !disabledHosts.includes(host);
    const mine = ++run;
    const adapter = active ? await adapterFor(!plainHosts.includes(host)) : null;
    if (mine !== run) return; // a newer apply() started while we waited

    const signature = active ? JSON.stringify(palette) + "|" + (adapter?.id || "") : "";
    if (signature === applied) return;
    applied = signature;

    engine?.stop();
    engine = null;
    if (active) engine = OWT.engine.createEngine({ palette, adapter, fetchCss });
  }

  const KEYS = ["palette", "enabled", "disabledHosts", "plainHosts"];
  chrome.storage.local.get(KEYS).then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && KEYS.some((k) => k in changes)) chrome.storage.local.get(KEYS).then(apply);
  });

  // Single-page sites (GitHub, YouTube) navigate without reloading, and a
  // community style can match some paths but not others.
  if (window === window.top) {
    setInterval(() => {
      if (location.href === lastHref || !state) return;
      lastHref = location.href;
      apply(state);
    }, NAV_CHECK_MS);
  }
})();

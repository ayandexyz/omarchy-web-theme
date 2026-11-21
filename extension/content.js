// Runs in every frame at document_start. Reads the cached palette, starts the
// engine, and restarts it whenever the palette or the site toggle changes.
(function () {
  const OWT = globalThis.OWT;
  if (!(document.documentElement instanceof HTMLHtmlElement)) return;

  const host = location.hostname;
  let engine = null;
  let applied = "";

  function fetchCss(url) {
    return chrome.runtime
      .sendMessage({ type: "fetch-css", url })
      .then((reply) => reply?.text || null)
      .catch(() => null);
  }

  function apply({ palette, enabled = true, disabledHosts = [] }) {
    const active = palette?.colors && enabled && !disabledHosts.includes(host);
    const signature = active ? JSON.stringify(palette) : "";
    if (signature === applied) return;
    applied = signature;

    engine?.stop();
    engine = null;
    if (active) {
      engine = OWT.engine.createEngine({ palette, adapter: OWT.adapters.adapterFor(host), fetchCss });
    }
  }

  const KEYS = ["palette", "enabled", "disabledHosts"];
  chrome.storage.local.get(KEYS).then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && KEYS.some((k) => k in changes)) chrome.storage.local.get(KEYS).then(apply);
  });
})();

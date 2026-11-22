// Keeps a port open to the native host and mirrors its palette into
// chrome.storage.local, which every content script listens to. An open native
// port also keeps this service worker alive.
importScripts("lib/color.js", "lib/catppuccin.js");

const HOST = "io.github.ayandexyz.omarchy_web_theme";
const RETRY_MS = 5000;

let port = null;
let retry = null;

function connect() {
  if (port) return;
  clearTimeout(retry);

  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(async (message) => {
    if (message.type === "palette") {
      await chrome.storage.local.set({ palette: message, hostError: null });
    } else if (message.type === "error") {
      await chrome.storage.local.set({ hostError: message.error });
    }
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "native host disconnected";
    port = null;
    chrome.storage.local.set({ hostError: error });
    retry = setTimeout(connect, RETRY_MS);
  });
}

// ---- Catppuccin community styles --------------------------------------------
// Built by scripts/build-catppuccin.mjs into adapters/catppuccin/. Matching and
// rendering happen here, once per site and palette, so pages only receive
// finished CSS and never parse the index.

let catppuccinIndex = null;
const styleFiles = new Map();
const rendered = new Map();

async function loadJson(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function renderStyle({ style, blocks }, palette) {
  const mode = palette.mode === "light" && style.light ? "light" : "dark";
  const key = `${style.id}.${mode}|${blocks.join(",")}`;
  if (!rendered.has(key)) {
    const file = `adapters/catppuccin/styles/${style.id}.${mode}.json`;
    if (!styleFiles.has(file)) styleFiles.set(file, loadJson(file));
    const data = await styleFiles.get(file);
    rendered.set(key, data ? OWT.catppuccin.render(data, palette, blocks) : "");
  }
  return rendered.get(key);
}

// {id, name, css} for the site's own style (or null), plus `addons`: the CSS
// of add-on styles for other extensions' UI, applied on top of whatever runs.
async function catppuccinFor(href) {
  catppuccinIndex ??= (await loadJson("adapters/catppuccin/index.json"))?.styles || [];
  const { site, addons } = OWT.catppuccin.match(catppuccinIndex, href);
  if (!site && !addons.length) return null;

  const { palette } = await chrome.storage.local.get("palette");
  if (!palette?.colors) return null;

  const addonCss = (await Promise.all(addons.map((a) => renderStyle(a, palette)))).join("\n");
  const css = site ? await renderStyle(site, palette) : "";
  return {
    id: site?.style.id || null,
    name: site?.style.name || null,
    css,
    addons: addons.map((a) => a.style.id),
    addonCss,
  };
}

// Rendered CSS depends on the palette; raw style files don't.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "palette" in changes) rendered.clear();
});

// Cross-origin stylesheets can't be read from the page; the extension's
// host permissions let us fetch their text here instead.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.type === "catppuccin") {
    catppuccinFor(message.href)
      .then(reply)
      .catch(() => reply(null));
    return true;
  }
  if (message.type === "fetch-css") {
    fetch(message.url, { credentials: "omit" })
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => reply({ text }))
      .catch(() => reply({ text: null }));
    return true;
  }
  if (message.type === "reconnect") {
    connect();
    port?.postMessage({ type: "get" });
  }
});

// The alarm restarts the worker (and the port) if Chrome ever stopped it.
chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();

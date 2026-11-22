// Mirrors the current Omarchy palette into chrome.storage.local, which every
// content script listens to. The palette comes from the theme files directly
// when the user allowed file URL access, otherwise from the native host.
importScripts("lib/color.js", "lib/catppuccin.js", "lib/theme-files.js");

const HOST = "io.github.ayandexyz.omarchy_web_theme";
const RETRY_MS = 5000;
const POLL_MS = 1000;

// Toggling file URL access reloads the extension, so the source picked here
// holds for this worker's whole life.
async function start() {
  if (await chrome.extension.isAllowedFileSchemeAccess()) watchFiles();
  else connect();
}

// ---- Theme files (file:// access) -------------------------------------------

let watching = false;
let stateDir = null;
let lastStamp = null;

async function readFile(path) {
  try {
    const res = await fetch(`file://${path}`);
    // Directory listings come back with status 0; missing paths throw.
    return res.ok || res.status === 0 ? await res.text() : null;
  } catch {
    return null;
  }
}

const hasTheme = async (home) => (await readFile(`${home}/${OWT.themeFiles.STATE_DIR}/theme/colors.toml`)) !== null;

// The extension can't ask for $HOME, so try the path the user gave, then every
// directory under /home.
async function findStateDir() {
  const { homeDir } = await chrome.storage.local.get("homeDir");
  const candidates = homeDir ? [homeDir.replace(/\/+$/, "")] : [];
  const listing = await readFile("/home/");
  if (listing) candidates.push(...OWT.themeFiles.listedDirs(listing).map((name) => `/home/${name}`));
  for (const home of candidates) if (await hasTheme(home)) return `${home}/${OWT.themeFiles.STATE_DIR}`;
  return null;
}

async function pollFiles() {
  stateDir ??= await findStateDir();
  if (!stateDir) {
    if (lastStamp !== "no-theme") await chrome.storage.local.set({ fileError: "no-theme" });
    lastStamp = "no-theme";
    return;
  }
  const [colorsToml, name, generation] = await Promise.all([
    readFile(`${stateDir}/theme/colors.toml`),
    readFile(`${stateDir}/theme.name`),
    readFile(`${stateDir}/theme.generation`),
  ]);
  if (colorsToml === null) {
    stateDir = lastStamp = null;
    return;
  }
  const stamp = `${generation}|${colorsToml}`;
  if (stamp === lastStamp) return;
  lastStamp = stamp;
  const palette = OWT.themeFiles.buildPalette({ colorsToml, name: name || "", generation: generation || "" });
  await chrome.storage.local.set({ palette, source: "files", fileError: null, hostError: null });
}

function watchFiles() {
  if (watching) return;
  watching = true;
  // Each tick makes extension API calls, which also keeps this worker alive.
  const tick = () => pollFiles().finally(() => setTimeout(tick, POLL_MS));
  tick();
}

// A new path from the popup: look again right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "homeDir" in changes) stateDir = lastStamp = null;
});

// ---- Native host ------------------------------------------------------------

let port = null;
let retry = null;

function connect() {
  if (port) return;
  clearTimeout(retry);

  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener(async (message) => {
    if (message.type === "palette") {
      await chrome.storage.local.set({ palette: message, source: "host", hostError: null });
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
    start();
    port?.postMessage({ type: "get" });
  }
});

// The alarm restarts the worker (and the palette source) if Chrome ever stopped it.
chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.runtime.onInstalled.addListener(start);
start();

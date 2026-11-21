// Keeps a port open to the native host and mirrors its palette into
// chrome.storage.local, which every content script listens to. An open native
// port also keeps this service worker alive.
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

// Cross-origin stylesheets can't be read from the page; the extension's
// host permissions let us fetch their text here instead.
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
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

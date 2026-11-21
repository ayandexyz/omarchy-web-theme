const SWATCHES = [
  "darker_background",
  "background",
  "lighter_background",
  "selection",
  "muted",
  "foreground",
  "accent",
  "bright_foreground",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "magenta",
  "brown",
];

const $ = (id) => document.getElementById(id);

async function currentHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return new URL(tab.url).hostname;
  } catch {
    return "";
  }
}

async function render() {
  const host = await currentHost();
  const { palette, enabled = true, disabledHosts = [], hostError } = await chrome.storage.local.get([
    "palette",
    "enabled",
    "disabledHosts",
    "hostError",
  ]);

  if (palette?.colors) {
    const c = palette.colors;
    const root = document.documentElement.style;
    root.setProperty("--bg", c.background);
    root.setProperty("--fg", c.foreground);
    root.setProperty("--muted", c.dark_foreground || c.muted);
    root.setProperty("--accent", c.accent);
    root.setProperty("--line", c.lighter_background || c.selection);

    $("name").textContent = palette.name || "Omarchy theme";
    $("mode").textContent = `${palette.mode} theme`;
    $("swatches").replaceChildren(
      ...SWATCHES.filter((k) => c[k]).map((k) => {
        const span = document.createElement("span");
        span.style.background = c[k];
        span.title = `${k} ${c[k]}`;
        return span;
      }),
    );
  }

  $("enabled").checked = enabled;
  $("host").textContent = host || "this site";
  $("site").checked = !disabledHosts.includes(host);
  $("site").disabled = !host || !enabled;

  $("error").hidden = !hostError || !!palette;
  $("error").textContent = `Native host: ${hostError}. Run install.sh, then restart the browser.`;

  $("enabled").onchange = (e) => chrome.storage.local.set({ enabled: e.target.checked });
  $("site").onchange = (e) =>
    chrome.storage.local.set({
      disabledHosts: e.target.checked ? disabledHosts.filter((h) => h !== host) : [...disabledHosts, host],
    });
}

chrome.runtime.sendMessage({ type: "reconnect" }).catch(() => {});
chrome.storage.onChanged.addListener(render);
render();

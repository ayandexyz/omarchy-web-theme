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

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return { host: new URL(tab.url).hostname, href: tab.url };
  } catch {
    return { host: "", href: "" };
  }
}

const toggle = (list, item, on) => (on ? list.filter((h) => h !== item) : [...new Set([...list, item])]);

async function render() {
  const { host, href } = await currentTab();
  const { palette, enabled = true, disabledHosts = [], plainHosts = [], hostError } = await chrome.storage.local.get([
    "palette",
    "enabled",
    "disabledHosts",
    "plainHosts",
    "hostError",
  ]);
  const community = href ? await chrome.runtime.sendMessage({ type: "catppuccin", href }).catch(() => null) : null;

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

  $("community-row").hidden = $("credit").hidden = !community?.id;
  $("community-name").textContent = community ? `(${community.name})` : "";
  $("community").checked = !plainHosts.includes(host);
  $("community").disabled = !enabled || disabledHosts.includes(host);

  $("enabled").onchange = (e) => chrome.storage.local.set({ enabled: e.target.checked });
  $("site").onchange = (e) => chrome.storage.local.set({ disabledHosts: toggle(disabledHosts, host, e.target.checked) });
  // Off falls back to the built-in adapter or the general engine.
  $("community").onchange = (e) => chrome.storage.local.set({ plainHosts: toggle(plainHosts, host, e.target.checked) });
}

chrome.runtime.sendMessage({ type: "reconnect" }).catch(() => {});
chrome.storage.onChanged.addListener(render);
render();

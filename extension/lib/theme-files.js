// Reading the Omarchy theme straight from disk, for when the extension has
// "Allow access to file URLs" and no native host is needed. Pure parsing lives
// here so the Node tests can cover it; background.js does the fetching.
(function (root) {
  const OWT = (root.OWT = root.OWT || {});

  // Relative to the user's home directory.
  const STATE_DIR = ".local/state/omarchy/current";

  // colors.toml is flat `key = "value"` pairs; tables and arrays are not used,
  // so a full TOML parser would be dead weight.
  function parseToml(text) {
    const out = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || line.startsWith("[")) continue;
      const m = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/);
      if (m) out[m[1]] = m[2] ?? m[3];
    }
    return out;
  }

  // Same shape the native host sends.
  function buildPalette({ colorsToml, name = "", generation = "" }) {
    const { mode = "dark", ...values } = parseToml(colorsToml);
    const colors = {};
    // Only plain "#rrggbb" values are colors; skip anything else a theme adds.
    for (const [key, value] of Object.entries(values)) if (value.startsWith("#")) colors[key] = value;
    return { type: "palette", name: name.trim(), generation: generation.trim(), mode, colors };
  }

  // Directory names from Chromium's file:// listing page, which emits one
  // addRow(name, url, isdir, ...) call per entry.
  function listedDirs(html) {
    return [...html.matchAll(/addRow\("([^"]+)",\s*"[^"]*",\s*1\b/g)].map((m) => m[1]);
  }

  OWT.themeFiles = { STATE_DIR, parseToml, buildPalette, listedDirs };

  if (typeof module !== "undefined") module.exports = OWT.themeFiles;
})(globalThis);

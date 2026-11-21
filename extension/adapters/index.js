// Per-site adapters. Each one can:
//   colorMap  exact site colors ("r,g,b") -> palette slot, checked before the
//             general mapping (good for sites with hard-coded colors, like x.com)
//   css(p)    extra CSS appended after the general engine's output, usually to
//             point a site's own CSS variables at the palette. `p` holds
//             "rgb(...)" strings keyed by palette slot name.
//   generic   false to skip the general engine entirely (default true)
//
// Variable names and colors below were taken from each site's dark theme and
// will drift as the sites change. Inspect with DevTools when one looks off.
(function (root) {
  const OWT = (root.OWT = root.OWT || {});

  const vars = (selector, pairs) =>
    `${selector} {\n${pairs.map(([name, value]) => `  ${name}: ${value} !important;`).join("\n")}\n}`;

  const adapters = [
    {
      id: "x",
      match: (host) => host === "x.com" || host.endsWith(".x.com") || host === "twitter.com",
      // X uses atomic classes with fixed colors for its Dim and Lights out themes.
      colorMap: {
        "0,0,0": "background", // Lights out page
        "21,32,43": "background", // Dim page
        "22,24,28": "lighter_background", // Lights out cards, search field
        "30,39,50": "lighter_background", // Dim cards
        "32,35,39": "lighter_background", // Lights out hover
        "47,51,54": "selection", // Lights out borders
        "56,68,77": "selection", // Dim borders
        "231,233,234": "foreground", // primary text, white buttons
        "247,249,249": "bright_foreground",
        "113,118,123": "muted", // Lights out secondary text
        "139,152,165": "muted", // Dim secondary text
        "29,155,240": "accent", // X blue
        "249,24,128": "red", // like
        "0,186,124": "green", // repost
      },
    },
    {
      id: "github",
      match: (host) => host === "github.com" || host === "gist.github.com",
      css: (p) =>
        vars(":root, [data-color-mode], [data-dark-theme], [data-light-theme]", [
          ["--bgColor-default", p.background],
          ["--bgColor-muted", p.dark_background],
          ["--bgColor-inset", p.darker_background],
          ["--bgColor-emphasis", p.lighter_background],
          ["--bgColor-neutral-muted", p.lighter_background],
          ["--bgColor-accent-emphasis", p.accent],
          ["--bgColor-accent-muted", p.selection],
          ["--bgColor-success-emphasis", p.green],
          ["--bgColor-danger-emphasis", p.red],
          ["--overlay-bgColor", p.dark_background],
          ["--header-bgColor", p.darker_background],
          ["--fgColor-default", p.foreground],
          ["--fgColor-muted", p.dark_foreground],
          ["--fgColor-accent", p.accent],
          ["--fgColor-success", p.green],
          ["--fgColor-danger", p.red],
          ["--fgColor-attention", p.yellow],
          ["--fgColor-done", p.magenta],
          ["--fgColor-onEmphasis", p.darker_background],
          ["--borderColor-default", p.selection],
          ["--borderColor-muted", p.lighter_background],
          ["--borderColor-accent-emphasis", p.accent],
          ["--button-primary-bgColor-rest", p.accent],
          ["--button-primary-fgColor-rest", p.darker_background],
          ["--button-default-bgColor-rest", p.lighter_background],
          ["--underlineNav-borderColor-active", p.accent],
          // Pre-2023 Primer names, still used on some pages.
          ["--color-canvas-default", p.background],
          ["--color-canvas-subtle", p.dark_background],
          ["--color-canvas-inset", p.darker_background],
          ["--color-fg-default", p.foreground],
          ["--color-fg-muted", p.dark_foreground],
          ["--color-accent-fg", p.accent],
          ["--color-border-default", p.selection],
          ["--color-border-muted", p.lighter_background],
        ]),
    },
    {
      id: "youtube",
      match: (host) => host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com",
      colorMap: {
        "15,15,15": "background", // hard-coded page background
        "255,0,0": "red", // brand red stays red, not accent
      },
      css: (p) =>
        vars("html, html[dark], [dark], ytd-app", [
          ["--yt-spec-base-background", p.background],
          ["--yt-spec-general-background-a", p.background],
          ["--yt-spec-raised-background", p.dark_background],
          ["--yt-spec-menu-background", p.dark_background],
          ["--yt-spec-additive-background", p.lighter_background],
          ["--yt-spec-badge-chip-background", p.lighter_background],
          ["--yt-spec-10-percent-layer", p.lighter_background],
          ["--yt-spec-outline", p.selection],
          ["--yt-spec-text-primary", p.foreground],
          ["--yt-spec-text-secondary", p.dark_foreground],
          ["--yt-spec-text-disabled", p.muted],
          ["--yt-spec-icon-inactive", p.dark_foreground],
          ["--yt-spec-icon-active-other", p.foreground],
          ["--yt-spec-call-to-action", p.accent],
          ["--yt-spec-themed-blue", p.accent],
        ]),
    },
  ];

  function adapterFor(host) {
    return adapters.find((a) => a.match(host)) || null;
  }

  OWT.adapters = { adapters, adapterFor };

  if (typeof module !== "undefined") module.exports = OWT.adapters;
})(globalThis);

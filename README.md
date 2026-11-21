# Omarchy Web Theme

Repaints the websites you visit in your current Omarchy theme, and repaints them
again the moment you switch themes, with no reload.

Omarchy already themes the browser itself: it sets the toolbar color and
light/dark mode through Chromium policy. Pages keep their own colors. This
extension handles the pages.

## How it works

```
~/.local/state/omarchy/current/theme/colors.toml
        │  (watched: theme.generation bumps on every theme switch)
        ▼
native host  ──stdio port──▶  background worker  ──storage──▶  content script, every tab
(python)                      (caches the palette)              (engine + site adapters)
```

**Native host** (`host/omarchy-web-theme-host`). A browser extension can't read
local files, so a small Python program sends the palette over Chrome's native
messaging. The extension holds one long-lived connection open. The host sends
the palette when that connection opens, and again within about a second of
every theme change.

**General engine** (`extension/lib/engine.js`, `mapper.js`) handles any site:

- It reads every color declaration from the page's stylesheets, including
  cross-origin sheets (fetched through the background worker) and rules added
  later with `insertRule`.
- It writes one override sheet with the same selectors and `!important`. The
  site's own CSS is never edited.
- It rewrites inline `style` colors, and keeps the originals so a theme switch
  or turning it off restores them.
- Colors are mapped by **role**, using OKLCH (a color format that separates
  lightness from hue):
  - **Surfaces** keep their lightness offset from the page background, so
    cards, hover states and insets stay distinct, and take the theme
    background's hue.
  - **Text** is matched by contrast. The site's body text becomes exactly
    `foreground`, and other text keeps its contrast relative to it. Text that
    sits on a filled button becomes background-colored.
  - **Chromatic colors** snap to the theme color with the nearest hue. The
    site's dominant brand hue becomes `accent`.
- Light sites under a dark theme (and the reverse) are mirrored in lightness.

**Adapters** (`extension/adapters/index.js`) refine sites that need it:

- `colorMap`: exact site colors mapped to palette slots. Used for x.com, whose
  atomic CSS has fixed colors.
- `css`: points a site's own CSS variables at the palette. Used for GitHub's
  Primer variables and YouTube's `--yt-spec-*` variables.

Adapter CSS is applied after the engine's output, so it wins.

## Install

```bash
./install.sh
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.
3. Restart the browser once so it picks up the native host.

The extension ID is fixed by the `key` in `manifest.json`
(`fkobbjpabkbibggchmmggiehdbnhjgkd`), which is what the native host allows.
The toolbar popup shows the current palette, a global on/off switch, and an
on/off switch for the current site.

To remove it: run `./uninstall.sh`, then remove the extension in
`chrome://extensions`.

## Tests

```bash
npm test           # color math, mapper, adapters (node) + native host (python)
npm run test:e2e   # headless Chromium: engine on a light page, then the real
                   # extension + native host, including a live theme switch
```

The end-to-end run uses a throwaway profile and theme folder. It doesn't touch
your real ones.

## Adding an adapter

Open the site, find its theme variables or fixed colors in DevTools, and add an
entry to `adapters`. Palette slot names are the keys of Omarchy's
`colors.toml`: `background`, `dark_background`, `darker_background`,
`lighter_background`, `selection`, `foreground`, `dark_foreground`,
`light_foreground`, `bright_foreground`, `muted`, `accent`, `red`, `orange`,
`yellow`, `green`, `cyan`, `blue`, `magenta`.

Sites change their CSS, so adapter tables drift. When a site looks wrong,
check its adapter first.

## Known limits

- **Shadow DOM** (web components) is not reached yet.
- **Variables that hold bare channel values** (`--rgb: 255 255 255`, used as
  `rgb(var(--rgb))`) are not recognized as colors.
- **Nested CSS** (`&` rules) is skipped.
- **SVG `fill` and `stroke` attributes** are skipped. The CSS properties are
  mapped.
- **x.com in light mode**: the x.com adapter is tuned for its Dim and Lights
  out themes. Set X to follow the device setting, which Omarchy sets to match
  your theme.
- **Canvas, images and video** are left alone on purpose.

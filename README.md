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
  When a site switches its own light/dark mode without reloading (an
  attribute on `<html>` or `<body>`, as on YouTube and GitHub), the mapping is
  redone.

**Community styles** (`scripts/build-catppuccin.mjs`, `extension/lib/catppuccin.js`)
cover 135 sites, including GitHub, YouTube, X, Reddit, Wikipedia, Gmail,
Stack Overflow, MDN and ChatGPT. They come from
[Catppuccin's userstyles](https://github.com/catppuccin/userstyles): themes
written by hand for each site, built here so they use any Omarchy palette:

- Catppuccin's styles are LESS and read their colors from a palette map
  (`@base`, `@text`, `@blue`, ...). The build swaps that map for placeholders,
  and a LESS plugin records every color function that touches one
  (`darken(@base, 5%)`, `fade(@accent, 30%)`, `mix(...)`) as an expression
  instead of computing it.
- In the browser, the background worker builds a Catppuccin palette out of
  Omarchy's colors (`base` = `background`, `text` = `foreground`, the
  surface and overlay steps blended between them, and so on). It then runs
  the recorded expressions with LESS's own color math, renders the CSS for
  the matching site, and caches it until the theme changes.
- On a site with a community style, the general engine still runs underneath.
  Its rules reuse the site's own selectors and are `!important` only where
  the site's were, so the community style (more specific selectors, applied
  after it) wins wherever it says something. The engine fills in what the
  style misses, like CSS a site changed after the style was written (YouTube
  now uses hashed variable names Catppuccin's style doesn't know). The popup
  has a "Community style" switch per site to turn the style off.
- Styles Catppuccin tags as `browser_extension` (Shinigami Eyes, 7TV, Indie
  Wiki Buddy, Stylus) theme another extension's UI on top of many sites. They
  are add-ons: applied on top of a site's own style, never instead of it.

`npm run check:catppuccin` renders every style with Catppuccin's real
Mocha and Latte colors and compares it, color for color, with Catppuccin's own
LESS build. All 135 match.

**Adapters** (`extension/adapters/index.js`) refine sites without a community
style, or ones where you turned it off:

- `colorMap`: exact site colors mapped to palette slots. Used for x.com, whose
  atomic CSS has fixed colors.
- `css`: points a site's own CSS variables at the palette. Used for GitHub's
  Primer variables and YouTube's `--yt-spec-*` variables.

Adapter CSS is applied after the engine's output, so it wins.

## Install

```bash
./install.sh
```

This installs the native host and builds the community styles. The build needs
`npm`; without it the extension still works, with only the general engine and
the built-in adapters. To rebuild by hand: `npm ci && npm run build:catppuccin`.
That fetches Catppuccin's userstyles at a pinned commit into `.cache/` and
writes `extension/adapters/catppuccin/` (about 12 MB, git-ignored). Bump
`COMMIT` in the script to update.

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
npm test                 # color math, mapper, adapters, Catppuccin runtime (node)
                         # + native host (python)
npm run check:catppuccin # every community style vs Catppuccin's own build
npm run test:e2e         # headless Chromium: engine on a light page, the real
                         # extension + native host with a live theme switch,
                         # and a community style (paste.rs, served locally)
```

The end-to-end run uses throwaway profiles and a throwaway theme folder. It
doesn't touch your real ones, and nothing leaves the machine: `paste.rs`
resolves to a local server.

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

- **Community styles:**
  - `proton` is skipped, because it does arithmetic on colors directly.
  - Icons recolored with CSS `filter` keep Catppuccin's hue, since filters
    can't be computed for an arbitrary color.
  - Catppuccin's add-on stylesheets loaded with `@import` (code highlighting
    themes) are dropped.
  - Where a style borrows the opposite flavor (an "inverse" color), it gets
    your palette with lightness mirrored, which is close but not exact.

- **Shadow DOM** (web components) is not reached yet.
- **Variables that hold bare channel values** (`--rgb: 255 255 255`, used as
  `rgb(var(--rgb))`) are not recognized as colors.
- **Nested CSS** (`&` rules) is skipped.
- **SVG `fill` and `stroke` attributes** are skipped. The CSS properties are
  mapped.
- **Canvas, images and video** are left alone on purpose.
- **Dark sections inside a light site** (GitHub's logged-out header, for
  example) get mirrored along with the rest of the page and come out light.
  Sites that follow the browser's dark preference avoid this, and Omarchy sets
  that preference to match your theme.

## Credits

Community styles are built from
[catppuccin/userstyles](https://github.com/catppuccin/userstyles), MIT
licensed. The build copies their license to
`extension/adapters/catppuccin/LICENSE`.

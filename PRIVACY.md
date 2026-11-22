# Privacy Policy

_Last updated: 2026-11-22_

Theme Everywhere collects no data. It has no servers, no analytics and no
accounts, and it sends nothing to the developer or anyone else.

## What it reads

- **Your Omarchy theme.** It reads three small files under
  `~/.local/state/omarchy/current/` (`theme/colors.toml`, `theme.name`,
  `theme.generation`) to get your color palette. With file URL access turned
  on it reads them directly. It also lists `/home` once to find your home
  folder. Without file URL access, the optional native host
  (`omarchy-web-theme-host`, installed only if you run `install.sh`) reads the
  same files and passes the palette to the extension on your machine.
- **The pages you visit.** To recolor a page, it reads that page's
  stylesheets and colors in your browser. When a page uses a stylesheet from
  another domain, the extension downloads that stylesheet itself, without
  cookies, the same way the page already did. Nothing about the page is
  stored or sent anywhere.

## What it stores

In your browser's local extension storage only: the current palette, your
on/off switches (global, per site, and per community style), and the home
folder path if you typed one in. Removing the extension deletes all of it.

## Contact

Questions: open an issue at
https://github.com/ayandexyz/theme-everywhere/issues

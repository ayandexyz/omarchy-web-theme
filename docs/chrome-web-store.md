# Chrome Web Store listing

Text to paste into the developer dashboard
(https://chrome.google.com/webstore/devconsole). Upload
`theme-everywhere-<version>-store.zip` from the GitHub release: it is the
same extension without the manifest `key`, which the store rejects.

## Store listing

**Name:** Theme Everywhere

**Summary** (132 characters max):

> Repaints every website in your current Omarchy theme, and repaints it again the moment you switch themes.

**Category:** Make Chrome Yours → Accessibility (or Workflow & Planning)

**Description:**

> Omarchy already themes your terminal, editor and browser toolbar. Theme Everywhere does the same for the pages themselves: every site you visit takes on your current Omarchy palette, and switches with it live when you change themes. No reload needed.
>
> • Works on any site: colors are remapped by role (backgrounds, text, accents), so pages stay readable and keep their structure.
> • 135 sites get hand-made styles (GitHub, YouTube, X, Reddit, Wikipedia, Gmail, Stack Overflow, MDN, ChatGPT and more), adapted from Catppuccin's userstyles to your palette.
> • Light and dark themes both work, including sites that switch their own mode.
> • Turn it off for everything, for one site, or just a site's hand-made style, from the toolbar popup.
>
> Setup: after installing, open the extension's Details on chrome://extensions and turn on "Allow access to file URLs". The extension reads your theme from ~/.local/state/omarchy/current and nothing else on disk.
>
> Requires Omarchy (https://omarchy.org). Open source: https://github.com/ayandexyz/theme-everywhere

**Icon:** `extension/icons/icon-128.png`

**Screenshots** (1280×800 or 640×400, at least one): take a few of well-known
sites in two different Omarchy themes, plus the popup open.

**Small promo tile** (440×280): optional.

## Privacy practices

**Single purpose:**

> Recolor the websites the user visits to match their current Omarchy desktop theme.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `host_permissions: <all_urls>` | The extension recolors every site the user visits, so its content script runs on all pages. The background worker also downloads a page's cross-origin stylesheets (without cookies) because pages can't read their colors themselves. |
| `storage` | Holds the current palette, which every tab reads, and the user's on/off switches. |
| `alarms` | A once-a-minute alarm restarts the background worker if Chrome stopped it, so theme changes keep reaching open tabs. |
| `nativeMessaging` | Optional fallback: users who don't grant file URL access can install a small local helper that sends the palette instead. It only talks to that helper on the user's own machine. |
| File URL access (user-granted) | Reads the Omarchy theme files in `~/.local/state/omarchy/current/` and lists `/home` to find them. Nothing else on disk is read. |

**Remote code:** No. All code ships in the package.

**Data usage:** Collects nothing. Tick none of the data types, and certify
that data is not sold, not used for unrelated purposes, and not used for
creditworthiness.

**Privacy policy URL:**
https://github.com/ayandexyz/theme-everywhere/blob/master/PRIVACY.md

## After the first upload

The store assigns its own extension ID. Add it to `allowed_origins` in
`host/io.github.ayandexyz.omarchy_web_theme.json` so the native host also works
for store installs, and release again. File URL access needs no change.

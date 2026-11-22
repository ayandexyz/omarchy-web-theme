#!/bin/bash

# Remove the Omarchy Web Theme native host. Remove the extension itself from
# chrome://extensions.

set -euo pipefail

HOST_NAME="io.github.ayandexyz.omarchy_web_theme"

# Only the host: the README suggests unzipping the extension next to it.
rm -f "$HOME/.local/share/omarchy-web-theme/omarchy-web-theme-host"
rmdir "$HOME/.local/share/omarchy-web-theme" 2>/dev/null || true
find "$HOME/.config" -maxdepth 4 -path "*/NativeMessagingHosts/$HOST_NAME.json" -delete -print |
  sed "s|^$HOME|  removed ~|"

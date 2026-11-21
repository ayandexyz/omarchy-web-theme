#!/bin/bash

# Remove the Omarchy Web Theme native host. Remove the extension itself from
# chrome://extensions.

set -euo pipefail

HOST_NAME="io.github.ayandexyz.omarchy_web_theme"

rm -rf "$HOME/.local/share/omarchy-web-theme"
find "$HOME/.config" -maxdepth 4 -path "*/NativeMessagingHosts/$HOST_NAME.json" -delete -print |
  sed "s|^$HOME|  removed ~|"

#!/bin/bash

# Install the Omarchy Web Theme native messaging host for every Chromium-based
# browser that has a profile on this machine.

set -euo pipefail

HOST_NAME="io.github.ayandexyz.omarchy_web_theme"
REPO_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
INSTALL_DIR="$HOME/.local/share/omarchy-web-theme"
HOST_PATH="$INSTALL_DIR/omarchy-web-theme-host"
TEMPLATE="$REPO_DIR/host/$HOST_NAME.json"

browser_dirs=(
  "$HOME/.config/chromium"
  "$HOME/.config/google-chrome"
  "$HOME/.config/google-chrome-beta"
  "$HOME/.config/google-chrome-unstable"
  "$HOME/.config/BraveSoftware/Brave-Browser"
  "$HOME/.config/BraveSoftware/Brave-Browser-Beta"
  "$HOME/.config/BraveSoftware/Brave-Browser-Nightly"
  "$HOME/.config/BraveSoftware/Brave-Origin"
  "$HOME/.config/microsoft-edge"
  "$HOME/.config/microsoft-edge-dev"
  "$HOME/.config/vivaldi"
)

python3 -c 'import tomllib' 2>/dev/null || {
  echo "omarchy-web-theme: python 3.11+ is required (tomllib)" >&2
  exit 1
}

install -Dm755 "$REPO_DIR/host/omarchy-web-theme-host" "$HOST_PATH"
manifest=$(sed "s|__HOST_PATH__|$HOST_PATH|g" "$TEMPLATE")

installed=()
for dir in "${browser_dirs[@]}"; do
  # Only browsers that are actually set up here.
  [[ -d $dir ]] || continue
  mkdir -p "$dir/NativeMessagingHosts"
  printf '%s\n' "$manifest" >"$dir/NativeMessagingHosts/$HOST_NAME.json"
  installed+=("${dir#"$HOME"/}")
done

if ((${#installed[@]} == 0)); then
  echo "No Chromium-based browser profile found. Start your browser once, then run this again." >&2
  exit 1
fi

echo "Native host installed at $HOST_PATH for:"
printf '  ~/%s\n' "${installed[@]}"
cat <<EOF

Next, load the extension:
  1. Open chrome://extensions and turn on Developer mode
  2. Click "Load unpacked" and pick $REPO_DIR/extension
  3. Restart the browser once so it picks up the native host
EOF

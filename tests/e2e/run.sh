#!/bin/bash

# End-to-end checks in headless Chromium:
#   1. the engine alone on a light test page (no extension APIs)
#   2. extension + native host on a served page, then a live theme switch
# Uses a throwaway profile and theme state; never touches your real ones.

set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
CHROMIUM=${OWT_CHROMIUM:-$(command -v chromium || command -v google-chrome-stable)}
WORK=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== engine on a light page"
engine=$("$CHROMIUM" --headless=new --no-sandbox --disable-gpu --allow-file-access-from-files \
  --virtual-time-budget=5000 --dump-dom "file://$ROOT/tests/e2e/engine.html" 2>/dev/null |
  grep -m1 -o 'RESULT{[^<]*' | sed 's/^RESULT//' || true)
[[ -n $engine ]] || fail "engine page produced no result"
node -e '
const r = JSON.parse(process.argv[1]);
const want = {
  bodyBg: "rgb(20, 38, 32)",        // page -> background
  bodyFg: "rgb(223, 237, 229)",     // body text -> foreground
  btnFg: "rgb(20, 38, 32)",         // inverse text on a filled button
  inlineBg: "rgb(20, 38, 32)",      // inline style rewritten
  labelVar: "\"black\"",            // string custom property untouched
  afterStopInlineBg: "rgb(255, 255, 255)", // stop() restores inline styles
  afterStopBody: "rgb(255, 255, 255)",
};
let bad = 0;
for (const [k, v] of Object.entries(want)) if (r[k] !== v) { console.error(`  ${k}: got ${r[k]}, want ${v}`); bad++; }
if (r.cardBg === r.bodyBg) { console.error("  card collapsed into page background"); bad++; }
if (r.late === "rgb(207, 34, 46)") { console.error("  rule added via insertRule was not mapped"); bad++; }
process.exit(bad ? 1 : 0);
' "$engine" || fail "engine mapping"
echo "ok"

echo "== extension + native host, live theme switch"
mkdir -p "$WORK/profile/NativeMessagingHosts" "$WORK/state/theme" "$WORK/site"
sed "s|__HOST_PATH__|$ROOT/host/omarchy-web-theme-host|" "$ROOT/host/io.github.ayandexyz.omarchy_web_theme.json" \
  >"$WORK/profile/NativeMessagingHosts/io.github.ayandexyz.omarchy_web_theme.json"
cat >"$WORK/state/theme/colors.toml" <<'TOML'
mode = "dark"
accent = "#8bcbb1"
selection = "#2b5147"
muted = "#64887b"
background = "#142620"
dark_background = "#0f1e19"
darker_background = "#0a1713"
lighter_background = "#203b31"
foreground = "#dfede5"
dark_foreground = "#91ad9f"
light_foreground = "#bed6c9"
bright_foreground = "#f0faf4"
red = "#d88d91"
blue = "#96b7d0"
TOML
echo jade >"$WORK/state/theme.name"
echo 1 >"$WORK/state/theme.generation"
cp "$ROOT/tests/e2e/site.html" "$WORK/site/index.html"

port=$((20000 + RANDOM % 20000))
(cd "$WORK/site" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1) &
pids+=($!)
debug_port=$((port + 1))
OMARCHY_WEB_THEME_STATE_DIR="$WORK/state" "$CHROMIUM" --headless=new --no-sandbox --disable-gpu \
  --user-data-dir="$WORK/profile" --load-extension="$ROOT/extension" \
  --disable-extensions-except="$ROOT/extension" --remote-debugging-port="$debug_port" about:blank 2>/dev/null &
pids+=($!)

result=$(timeout 60 node "$ROOT/tests/e2e/cdp.mjs" "$debug_port" "http://127.0.0.1:$port/" "$WORK/state")
node -e '
const { before, after } = JSON.parse(process.argv[1]);
let bad = 0;
const check = (got, want, what) => { if (got !== want) { console.error(`  ${what}: got ${got}, want ${want}`); bad++; } };
check(before.body, "rgb(20, 38, 32)", "page background");
check(before.text, "rgb(223, 237, 229)", "body text");
check(after.body, "rgb(42, 20, 24)", "page background after theme switch");
process.exit(bad ? 1 : 0);
' "$result" || fail "extension end-to-end"
echo "ok"

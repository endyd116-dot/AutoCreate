#!/bin/sh
# ============================================================
#  AutoCreate Runner - macOS / Linux launcher
#  (English only - terminal locales vary; Korean guidance is in
#   install.md and in the app screen.)
#  Mirrors run.bat so both platforms behave identically,
#  including the exit-code-75 restart used by auto-update.
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1

# --- Security note (R8 3.1, 2026-09-15) -----------------------------
#  On Windows, Chromium seals cookies with AES-256-GCM using a key that
#  DPAPI binds to the machine + user, and .token permissions are narrowed
#  with icacls. Neither applies here:
#    * On Linux without a keyring (gnome-keyring / kwallet), Chromium falls
#      back to a HARDCODED key -- profile cookies are effectively plaintext.
#    * On macOS Chromium uses the Keychain, which is stronger, but we have
#      NOT measured it.
#  We have not verified either case (no mac/Linux runner exists yet), so we
#  say so instead of pretending. Treat the runner folder as a secret: do not
#  put it on a shared machine or a synced/backed-up folder.
#  This is deferred, not solved. See docs/active/B2-HANDOFF.md.
# --------------------------------------------------------------------

echo ""
echo "  AutoCreate Runner"
echo "  -----------------"
echo ""

# --- 1) Node check --------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Node.js is not installed."
  echo "      Install Node 20 LTS from https://nodejs.org  then run this file again."
  echo ""
  exit 1
fi

# --- 2) Dependencies ------------------------------------------------
if [ ! -d "node_modules/playwright" ]; then
  echo "  [1/2] Installing dependencies ... this takes a few minutes the first time."
  npm install --no-audit --no-fund || { echo "  [X] Install failed. Check your internet connection."; exit 1; }
  echo "  [2/2] Installing browser ..."
  npx playwright install chromium || { echo "  [X] Browser install failed."; exit 1; }
  echo "  Done."
  echo ""
fi

# --- 3) Key (the app screen calls this the "key") --------------------
if [ ! -f ".token" ]; then
  if [ $# -ge 1 ]; then
    ACTOKEN="$1"
  else
    printf "  Paste the key from the app screen (starts with acr_)\n  Key: "
    read -r ACTOKEN
  fi
  if [ -z "${ACTOKEN:-}" ]; then
    echo "  [X] No key entered. Get one from the app: Settings > Runner > Turn on this PC."
    exit 1
  fi
  node ac-runner.mjs --token "$ACTOKEN" || { echo "  [X] Could not save the key."; exit 1; }
fi

# --- 4) Run (restart loop) ------------------------------------------
# Exit code 75 means "I just updated myself, start me again" (runner/lib/update.mjs).
# Any other code ends the loop, so a real crash or Ctrl+C still stops the program.
echo "  Running. Keep this window open. Press Ctrl+C to stop."
echo ""
while true; do
  node ac-runner.mjs
  code=$?
  if [ "$code" -eq 75 ]; then
    echo ""
    echo "  Updated - restarting ..."
    echo ""
    continue
  fi
  break
done

echo ""
echo "  Runner stopped."
exit 0

#!/usr/bin/env bash
# Install the latest Filey release without the Gatekeeper prompt.
# Files downloaded with curl carry no quarantine flag, so macOS opens the app directly.
set -euo pipefail

REPO="FlrnDml/filey"
APP="Filey.app"

[ "$(uname)" = "Darwin" ] || { echo "Filey is macOS-only." >&2; exit 1; }

# Newest published release, pre-releases included (drafts are not visible here).
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" \
  | grep -o '"browser_download_url": *"[^"]*\.dmg"' \
  | head -n1 | cut -d'"' -f4)
[ -n "$URL" ] || { echo "No DMG found in the latest release." >&2; exit 1; }

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() { hdiutil detach "$MNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "Downloading $URL"
curl -fL --progress-bar -o "$TMP/Filey.dmg" "$URL"

mkdir "$MNT"
hdiutil attach "$TMP/Filey.dmg" -nobrowse -readonly -mountpoint "$MNT" -quiet

pkill -x Filey 2>/dev/null || true
rm -rf "/Applications/$APP"
cp -R "$MNT/$APP" /Applications/
xattr -dr com.apple.quarantine "/Applications/$APP" 2>/dev/null || true  # safety net

echo "Installed. Opening Filey…"
open "/Applications/$APP"

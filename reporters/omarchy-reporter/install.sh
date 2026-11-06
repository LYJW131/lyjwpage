#!/usr/bin/env bash
# Builds the reporter into ~/.local/bin and adds a launcher entry.
set -euo pipefail
cd "$(dirname "$0")"
bin="${XDG_BIN_HOME:-$HOME/.local/bin}/omarchy-reporter"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
apps="$data/applications"
icons="$data/icons/hicolor/256x256/apps"
mkdir -p "$(dirname "$bin")" "$apps" "$icons"
go build -ldflags '-s -w' -o "$bin.new" .
mv "$bin.new" "$bin"
magick resources/icon.png -resize 256x256 "$icons/omarchy-reporter.png" 2>/dev/null || cp resources/icon.png "$icons/omarchy-reporter.png"
gtk-update-icon-cache -q "$data/icons/hicolor" 2>/dev/null || true
cat > "$apps/omarchy-reporter.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Omarchy Reporter
Comment=Report the focused app to lyjwpage
Exec=$bin
Icon=omarchy-reporter
StartupWMClass=omarchy-reporter
Categories=Utility;
DESKTOP
echo "installed $bin"

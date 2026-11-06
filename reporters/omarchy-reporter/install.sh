#!/usr/bin/env bash
# Builds the reporter into ~/.local/bin and adds a launcher entry.
set -euo pipefail
cd "$(dirname "$0")"
bin="${XDG_BIN_HOME:-$HOME/.local/bin}/omarchy-reporter"
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$(dirname "$bin")" "$apps"
go build -ldflags '-s -w' -o "$bin.new" .
mv "$bin.new" "$bin"
cat > "$apps/omarchy-reporter.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Omarchy Reporter
Comment=Report the focused app to lyjwpage
Exec=$bin
Icon=network-transmit-receive
StartupWMClass=omarchy-reporter
Categories=Utility;
DESKTOP
echo "installed $bin"

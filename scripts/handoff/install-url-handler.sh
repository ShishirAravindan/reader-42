#!/bin/bash
# Teach this desktop what koreader:// means.
#
# KOReader registers MIME types but NOT a URL scheme, so a browser has no way
# to hand it a book. That is the whole reason the shelf has to run on the same
# machine as the reader: POST /open spawns it server-side.
#
# Registering a scheme removes that constraint. The shelf can then be served
# from anywhere — a Raspberry Pi holding the Syncthing folder, say — and still
# open a book on the machine you are sitting at, because the browser fires the
# URL locally.
#
#   KOREADER_BIN=/path/to/koreader.sh LIBRARY_ROOT=/path/to/library \
#     ./scripts/handoff/install-url-handler.sh
set -euo pipefail

: "${KOREADER_BIN:?set KOREADER_BIN to the koreader launcher}"
: "${LIBRARY_ROOT:?set LIBRARY_ROOT to the library folder}"

here="$(cd "$(dirname "$0")" && pwd)"
apps="$HOME/.local/share/applications"
mkdir -p "$apps"

cat > "$apps/koreader-url.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=KOReader (URL handler)
Exec=env KOREADER_BIN=$KOREADER_BIN LIBRARY_ROOT=$LIBRARY_ROOT $here/koreader-open %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/koreader;
EOF

update-desktop-database "$apps" 2>/dev/null || true
xdg-mime default koreader-url.desktop x-scheme-handler/koreader

echo "registered: $(xdg-mime query default x-scheme-handler/koreader)"
echo "try:        xdg-open \"koreader://open?file=Some%20Book.epub\""

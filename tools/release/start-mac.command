#!/bin/sh
# Scheldemist: double-click to play. Keep the window open while you play; close it to stop the game.
cd "$(dirname "$0")" || exit 1
# macOS marks every file of a download; once you chose to open this, clear the mark on this folder only,
# or macOS stops the game's own parts one by one.
xattr -dr com.apple.quarantine . 2>/dev/null
./runtime/node launch.mjs || { echo; echo "Press Enter to close."; read -r _; }

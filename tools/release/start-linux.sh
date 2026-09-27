#!/bin/sh
# Scheldemist: run this to play. Keep the window open while you play; close it or press Ctrl+C to stop.
cd "$(dirname "$0")" || exit 1
./runtime/node launch.mjs || { echo; echo "Press Enter to close."; read -r _; }

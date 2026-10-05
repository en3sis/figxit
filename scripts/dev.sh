#!/bin/bash
source "$(dirname "$0")/lib.sh"

state=$HOME/.local/state/figxit

SIGN_ID=- scripts/build.sh helper
pkill -x figxit-helper || true
pkill -x figxit-engine || true
mkdir -p "$state"
touch "$state/stopped"

trap 'kill $helper 2>/dev/null; exit 0' INT TERM EXIT
FIGXIT_NO_ENGINE=1 "$APP/Contents/MacOS/figxit-helper" &
helper=$!
cd engine
bun --watch src/main.ts daemon

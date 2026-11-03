#!/bin/bash
source "$(dirname "$0")/lib.sh"

state=$HOME/.local/state/figxit

scripts/build.sh helper
pkill -x figxit-helper || true
pkill -x figxit-engine || true
mkdir -p "$state"
touch "$state/stopped"

trap 'pkill -x figxit-helper; exit 0' INT TERM EXIT
open -g --env FIGXIT_NO_ENGINE=1 "$APP"
cd engine
bun --watch src/main.ts daemon

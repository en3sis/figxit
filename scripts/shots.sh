#!/bin/bash
source "$(dirname "$0")/lib.sh"

SIGN_ID=- scripts/build.sh helper
cd engine
bun run scripts/shots.ts

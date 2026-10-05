#!/bin/bash
source "$(dirname "$0")/lib.sh"

cf_login
exec bun run scripts/stats.ts "$@"

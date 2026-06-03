#!/bin/bash
# Telegram Outreach Runner
# Called from Hermes/Telegram. Runs the outreach pipeline and returns results.
#
# Usage:
#   bash scripts/tg-outreach.sh "hvac" "Portland" "OR" 10
#   bash scripts/tg-outreach.sh "plumbing" "Seattle" "WA" 5 --dry-run

KEYWORD="${1:-hvac}"
CITY="${2:-Portland}"
STATE="${3:-OR}"
MAX="${4:-10}"
DRY_RUN=""
[[ "$5" == "--dry-run" ]] && DRY_RUN="--dry-run"

cd /opt/data/adhelloleadsos
node scripts/telegram-outreach.js --keyword "$KEYWORD" --city "$CITY" --state "$STATE" --max "$MAX" $DRY_RUN

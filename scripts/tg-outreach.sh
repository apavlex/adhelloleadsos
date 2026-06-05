#!/bin/bash
# Telegram Outreach Runner
# Called from Hermes/Telegram. Runs the outreach pipeline and returns results.
#
# Usage (single trade - backwards compat):
#   bash scripts/tg-outreach.sh "hvac" "Portland" "OR" 10
#   bash scripts/tg-outreach.sh "plumbing" "Seattle" "WA" 5 --dry-run
#
# Usage (all home service trades - default):
#   bash scripts/tg-outreach.sh "" "Portland" "OR" 5
#   bash scripts/tg-outreach.sh --all "Portland" "OR" 5
#
# Usage (custom trades):
#   bash scripts/tg-outreach.sh --trades "hvac,plumbing,roofing" "Portland" "OR" 5

cd /opt/data/adhelloleadsos

# Parse arguments
TRADES=""
KEYWORD=""
CITY=""
STATE=""
MAX=""
DRY_RUN=""

if [[ "$1" == "--all" ]] || [[ "$1" == "" ]]; then
  # No keyword = all default trades
  CITY="${2:-Portland}"
  STATE="${3:-OR}"
  MAX="${4:-5}"
  [[ "$5" == "--dry-run" ]] && DRY_RUN="--dry-run"
  node scripts/telegram-outreach.js --city "$CITY" --state "$STATE" --max "$MAX" $DRY_RUN
elif [[ "$1" == "--trades" ]]; then
  TRADES="$2"
  CITY="${3:-Portland}"
  STATE="${4:-OR}"
  MAX="${5:-5}"
  [[ "$6" == "--dry-run" ]] && DRY_RUN="--dry-run"
  node scripts/telegram-outreach.js --trades "$TRADES" --city "$CITY" --state "$STATE" --max "$MAX" $DRY_RUN
else
  # Single keyword (backwards compat)
  KEYWORD="$1"
  CITY="${2:-Portland}"
  STATE="${3:-OR}"
  MAX="${4:-5}"
  [[ "$5" == "--dry-run" ]] && DRY_RUN="--dry-run"
  node scripts/telegram-outreach.js --keyword "$KEYWORD" --city "$CITY" --state "$STATE" --max "$MAX" $DRY_RUN
fi

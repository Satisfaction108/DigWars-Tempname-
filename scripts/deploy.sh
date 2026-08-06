#!/usr/bin/env bash
# pull latest dig-wars + restart the game server under pm2
set -euo pipefail

APP_DIR="${1:-$HOME/digwars}"
cd "$APP_DIR"
git pull --ff-only origin dig-wars
npm install
pm2 restart digwars
pm2 save

#!/bin/zsh
set -eu
cd "${0:A:h}"
export BLOKS_DATA_DIR="$PWD/.codemaniac-data"
export BLOKS_DEV_WORKSPACES=1
if [[ ! -f dist/index.html ]]; then
  echo "Build the interface first with: npm run build"
  exit 1
fi
if [[ ! -f electron/vendor/electron-updater.cjs ]]; then
  node scripts/bundle-updater.mjs
fi
electron_bin="$(node -p 'require("electron")')"
exec "$electron_bin" .

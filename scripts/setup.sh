#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
yarn install
[ -f server/.env ] || cp server/.env.example server/.env
[ -f client/.env.local ] || cp client/.env.example client/.env.local

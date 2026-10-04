#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
yarn install
[ -f server/.env ] || cp server/.env.example server/.env
[ -f packages/nextjs/.env.local ] || cp packages/nextjs/.env.example packages/nextjs/.env.local

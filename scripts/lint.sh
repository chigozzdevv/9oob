#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
yarn exec eslint server/src packages/schema/src packages/sdk/src packages/nextjs --max-warnings=0

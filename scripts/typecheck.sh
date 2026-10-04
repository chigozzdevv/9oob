#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
yarn workspace @9oob/schema check-types
yarn workspace @9oob/server check-types
yarn workspace @9oob/sdk check-types
yarn workspace @9oob/client check-types

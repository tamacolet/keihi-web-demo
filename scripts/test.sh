#!/bin/sh
set -eu

out=$(mktemp -d "${TMPDIR:-/tmp}/keihi-web-demo-tests.XXXXXX")
trap 'rm -rf "$out"' EXIT INT TERM

./node_modules/.bin/tsc -p tsconfig.test.json --outDir "$out"
node --test "$out"/tests/*.test.js

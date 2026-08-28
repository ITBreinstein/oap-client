#!/usr/bin/env bash
# Re-capture the committed ZOO-Project fixtures from the running deployment.
#
# Fixtures are evidence: findings quote them, and the contract-style assertions
# in test/interop compare live responses against them so that an upstream change
# shows up as a test failure rather than as a quiet drift. Re-run this only when
# the pinned SHA in pinned.env changes, and read the diff before committing it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../../packages/core/test/fixtures/zoo-project"
base=http://localhost:5090/ogc-api

# Written byte-for-byte, never reformatted — .prettierignore excludes this tree
# for exactly that reason. A fixture that has been through a pretty-printer can
# no longer prove what the server sent, and ZOO's compact, slash-escaped JSON is
# itself part of the evidence. Validity is checked, not imposed.
get() { # get <url> <path-under-fixtures>
  local url="$1" dest="$out/$2"
  mkdir -p "$(dirname "$dest")"
  curl -sSf -H 'Accept: application/json' -o "$dest" "$url"
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$dest"
  echo "    $2  <-  ${url#"$base"}"
}

echo "==> capturing from $base"
get "$base/" landing-page.json
get "$base/conformance" conformance.json
# The full collection is 703 processes. Twenty is enough to exercise paging
# links and the summary shape without committing a megabyte of fixture.
get "$base/processes?limit=20" process-list-limit20.json

# One process per description shape we need to generate a form for: a literal
# echo, a long-running one for async polling, and three with real geospatial
# inputs and outputs.
for process in echo longProcess Buffer Centroid Ogr2Ogr; do
  get "$base/processes/$process" "processes/$process.json"
done

echo "==> done; review the diff before committing"

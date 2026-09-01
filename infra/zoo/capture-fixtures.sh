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
  # Explicit `|| return 1`: `set -e` is suspended inside an `if` condition, so
  # without these a failed curl would fall through to the echo and be reported
  # as a successful capture. The loop below calls this in exactly that position.
  curl -sSf -H 'Accept: application/json' -o "$dest" "$url" || return 1
  python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$dest" || return 1
  echo "    $2  <-  ${url#"$base"}"
}

echo "==> capturing from $base"
get "$base/" landing-page.json
get "$base/conformance" conformance.json
# The full collection is 703 processes. Twenty is enough to exercise paging
# links and the summary shape without committing a megabyte of fixture.
get "$base/processes?limit=20" process-list-limit20.json
# Two more pages of the same walk. ZOO is the only server in the matrix that
# actually paginates, and it pages with `skip` rather than the `offset` OGC API
# - Common defines (finding 0019), so the rel=next walk is only testable against
# real hrefs. skip=690 is the last page: 13 entries and no `next`.
get "$base/processes?limit=20&skip=20" process-list-limit20-skip20.json
get "$base/processes?limit=20&skip=690" process-list-limit20-skip690.json

# Every process the fork itself provides.
#
# The deployment advertises 703, but 657 of those are auto-generated wrappers
# that come from the base image — 551 `SAGA.*` and 106 `OTB.*`, each one a
# mechanical translation of a third-party tool's command line. They are all the
# same shape as each other, so the 658th teaches us nothing the 2nd did not, and
# committing 5 MB of them would bury the fixtures that matter.
#
# What is left is the ~46 local service providers the fork bundles: hand-written
# descriptions, and the only ones on this server with real geospatial inputs, a
# live `maxOccurs: "unbounded"` (Gdal_Translate.GCP), a `format: "ogc-bbox"`
# bounding box (echo, EchoProcess, org.n52.javaps.test.*), and the vendor
# `extended-schema` sibling. Together they are ~100 kB.
#
# Derived from the live list rather than hardcoded, so a service added to the
# fork is captured on the next run instead of being silently missed.
echo "==> capturing the fork's own service providers"
local_ids="$(curl -sSf -H 'Accept: application/json' "$base/processes" |
  python3 -c '
import json, sys
for p in json.load(sys.stdin)["processes"]:
    if not p["id"].startswith(("SAGA.", "OTB.", "GRASS.")):
        print(p["id"])
')"

count=0
failed=0
for process in $local_ids; do
  # Two of them answer 500 rather than a description (finding 0020). That is the
  # finding, not a reason to abort the capture, so record and continue.
  if get "$base/processes/$process" "processes/$process.json"; then
    count=$((count + 1))
  else
    echo "    !! $process did not answer with a description (see finding 0020)"
    rm -f "$out/processes/$process.json"
    failed=$((failed + 1))
  fi
done
echo "==> captured $count descriptions, $failed unavailable"

echo "==> done; review the diff before committing"

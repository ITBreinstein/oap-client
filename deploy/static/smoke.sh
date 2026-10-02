#!/usr/bin/env bash
# After a deploy: check the static site from outside, with curl. Exits
# non-zero when any check fails. See README.md.
#
#   OAP_HOSTNAME=oap.example.nl deploy/static/smoke.sh
#
# SMOKE_INSECURE=1 skips certificate checks, for a local test against Caddy's
# internal CA only.
set -euo pipefail

hostname=${OAP_HOSTNAME:-}
[[ -n $hostname ]] || {
  echo "usage: OAP_HOSTNAME=<hostname> $0" >&2
  exit 2
}
base="https://$hostname"
curl_opts=(--silent --show-error --max-time 20)
[[ ${SMOKE_INSECURE:-} == 1 ]] && curl_opts+=(--insecure)

failures=0
ok() { printf 'ok    %s\n' "$1"; }
bad() {
  printf 'FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

# Response headers of a GET, CRs stripped.
head_of() { curl "${curl_opts[@]}" --output /dev/null --dump-header - "$base$1" | tr -d '\r'; }
status_in() { awk 'NR == 1 { print $2 }' <<<"$1"; }
# One header's value, matched case-insensitively.
header_in() {
  awk -v name="$2" 'index(tolower($0), tolower(name) ":") == 1 { sub(/^[^:]*:[ \t]*/, ""); print; exit }' <<<"$1"
}
expect() { # description, actual, expected
  if [[ $2 == "$3" ]]; then ok "$1"; else bad "$1: got '$2', expected '$3'"; fi
}
expect_match() { # description, actual, pattern
  if [[ $2 =~ $3 ]]; then ok "$1"; else bad "$1: got '$2'"; fi
}

root=$(head_of /)
expect "/ answers 200" "$(status_in "$root")" 200
expect "/ is revalidated (Cache-Control: no-cache)" "$(header_in "$root" cache-control)" no-cache

expect "HSTS" "$(header_in "$root" strict-transport-security)" "max-age=31536000"
expect "X-Content-Type-Options" "$(header_in "$root" x-content-type-options)" nosniff
expect "Referrer-Policy" "$(header_in "$root" referrer-policy)" strict-origin-when-cross-origin
expect "X-Frame-Options" "$(header_in "$root" x-frame-options)" DENY
expect_match "Permissions-Policy" "$(header_in "$root" permissions-policy)" "geolocation=\(\)"
csp="$(header_in "$root" content-security-policy)$(header_in "$root" content-security-policy-report-only)"
expect_match "a Content-Security-Policy (enforced or report-only)" "$csp" "frame-ancestors 'none'"

asset=$(curl "${curl_opts[@]}" "$base/" | grep -o -E '/assets/[^"]+\.js' | head -n 1 || true)
if [[ -z $asset ]]; then
  bad "index.html names a script under /assets/"
else
  asset_head=$(head_of "$asset")
  expect "$asset answers 200" "$(status_in "$asset_head")" 200
  expect_match "$asset is cached as immutable" "$(header_in "$asset_head" cache-control)" immutable
fi

expect "/api/anything answers 404 (no relay)" "$(status_in "$(head_of /api/anything)")" 404
expect "/api answers 404" "$(status_in "$(head_of /api)")" 404
expect "a missing asset answers 404, not index.html" \
  "$(status_in "$(head_of /assets/smoke-missing.js)")" 404
expect "a missing page answers 404" "$(status_in "$(head_of /smoke-missing)")" 404

config_head=$(head_of /config.json)
expect "/config.json answers 200" "$(status_in "$config_head")" 200
expect "/config.json is revalidated" "$(header_in "$config_head" cache-control)" no-cache
config=$(curl "${curl_opts[@]}" "$base/config.json")
if node -e 'JSON.parse(process.argv[1])' "$config" 2>/dev/null; then
  ok "/config.json parses as JSON"
else
  bad "/config.json does not parse as JSON"
fi

if ((failures > 0)); then
  echo "smoke: $failures check(s) failed"
  exit 1
fi
echo "smoke: all checks passed"

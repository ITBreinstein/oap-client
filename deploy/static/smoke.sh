#!/usr/bin/env bash
# After a deploy: check the static site and the relay behind it from outside,
# with curl. Exits non-zero when any check fails. See README.md.
#
#   OAP_HOSTNAME=oap.example.nl deploy/static/smoke.sh
#
# SMOKE_INSECURE=1 skips certificate checks, for a local test against Caddy's
# internal CA only. SMOKE_RATE_LIMIT=1 also checks that the relay rate-limits
# new sessions, even from a client that names itself differently each time;
# that leaves the machine running it rate-limited for about a minute.
# SMOKE_SKIP_RELAY=1 skips the checks that need the relay behind /api (and
# SMOKE_RATE_LIMIT with them), for a host where it is not deployed yet.
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
skip() { printf 'skip  %s\n' "$1"; }
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

expect "/api answers 404: not a relay path" "$(status_in "$(head_of /api)")" 404
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

# --- The relay, at /api -----------------------------------------------------

if [[ ${SMOKE_SKIP_RELAY:-} == 1 ]]; then
  skip "the relay at /api: SMOKE_SKIP_RELAY=1"
else
  relay_head=$(head_of /api/healthz)
  expect "/api/healthz answers 200" "$(status_in "$relay_head")" 200
  expect "/api/healthz comes from the relay (X-Relay: 1)" "$(header_in "$relay_head" x-relay)" 1

  endpoints=$(curl "${curl_opts[@]}" "$base/api/endpoints")
  # One line per endpoint: key, then base URL.
  # shellcheck disable=SC2016 # JavaScript, not shell
  listed=$(node -e '
    const { endpoints } = JSON.parse(process.argv[1]);
    for (const e of endpoints) console.log(`${e.key} ${e.baseUrl}`);
  ' "$endpoints" 2>/dev/null || echo "unreadable")
  if [[ $listed == unreadable ]]; then
    bad "/api/endpoints is the relay's endpoint list"
  elif [[ -z $listed ]]; then
    bad "/api/endpoints lists at least one endpoint"
  else
    if grep -qv ' https://' <<<"$listed"; then
      bad "/api/endpoints lists https: endpoints only: $(grep -v ' https://' <<<"$listed" | tr '\n' ' ')"
    else
      ok "/api/endpoints lists https: endpoints only ($(wc -l <<<"$listed" | tr -d ' '))"
    fi
    first=$(head -n 1 <<<"$listed" | cut -d' ' -f1)
    unauthorised=$(head_of "/api/read/$first/")
    expect "/api/read/$first/ without a session answers 401" "$(status_in "$unauthorised")" 401
    expect "… refused by the relay as unknown-session" \
      "$(header_in "$unauthorised" x-relay-error)" unknown-session
  fi
fi

# The relay's own port must not answer from outside: published on 127.0.0.1
# only, or not at all.
addresses=$(node -e '
  require("node:dns").lookup(process.argv[1], { all: true }, (error, found) => {
    if (error) process.exit(1);
    for (const { address } of found) console.log(address);
  });
' "${hostname%%:*}" 2>/dev/null || true)
if [[ -z $addresses ]]; then
  bad "$hostname resolves, to check the relay's port from outside"
fi
while read -r address; do
  [[ -n $address ]] || continue
  url="http://$address:8787/healthz"
  [[ $address == *:* ]] && url="http://[$address]:8787/healthz"
  if curl --silent --output /dev/null --connect-timeout 5 --max-time 8 "$url"; then
    bad "port 8787 on $address answers from outside"
  else
    ok "port 8787 on $address does not answer from outside"
  fi
done <<<"$addresses"

if [[ ${SMOKE_RATE_LIMIT:-} == 1 && ${SMOKE_SKIP_RELAY:-} == 1 ]]; then
  skip "the relay's rate limit: SMOKE_SKIP_RELAY=1"
elif [[ ${SMOKE_RATE_LIMIT:-} == 1 ]]; then
  # More sessions than any sane limit, each naming a different client in
  # X-Forwarded-For. Caddy replaces the header, so all count as this machine.
  limited=
  for i in $(seq 1 60); do
    answer=$(curl "${curl_opts[@]}" --output /dev/null --dump-header - --request POST \
      --header "X-Forwarded-For: 198.51.100.$i" "$base/api/sessions" | tr -d '\r')
    if [[ $(status_in "$answer") == 429 ]]; then
      limited=$answer
      break
    fi
  done
  if [[ -z $limited ]]; then
    bad "POST /api/sessions is rate-limited within 60 tries, whatever X-Forwarded-For says"
  else
    ok "POST /api/sessions is rate-limited after $((i - 1)), whatever X-Forwarded-For says"
    expect "… refused as rate-limited" "$(header_in "$limited" x-relay-error)" rate-limited
    expect_match "… with Retry-After in seconds" "$(header_in "$limited" retry-after)" '^[0-9]+$'
  fi
fi

if ((failures > 0)); then
  echo "smoke: $failures check(s) failed"
  exit 1
fi
echo "smoke: all checks passed"

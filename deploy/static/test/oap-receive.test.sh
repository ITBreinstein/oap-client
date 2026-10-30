#!/usr/bin/env bash
# Tests deploy/static/oap-receive.sh against a temporary web root. Needs GNU
# coreutils, find and tar, as on the server: run it on Linux (CI does).
#
#   deploy/static/test/oap-receive.test.sh
#
# The receiver is copied with its web root replaced, and run as sshd runs a
# forced command: the requested command in SSH_ORIGINAL_COMMAND, the archive
# on stdin. `date` is replaced too, so that release names are known in
# advance and seven deploys need not take seven seconds.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

root="$work/web"
mkdir -p "$root/releases" "$work/bin"
receiver="$work/oap-receive"
sed "s|^WEB_ROOT=/srv/oap-web\$|WEB_ROOT=$root|" "$here/../oap-receive.sh" >"$receiver"
grep -qx "WEB_ROOT=$root" "$receiver" || {
  echo "the receiver no longer sets WEB_ROOT=/srv/oap-web on a line of its own" >&2
  exit 1
}

# Prints FAKE_NOW, whatever format it is asked for.
cat >"$work/bin/date" <<'EOF'
#!/bin/sh
echo "$FAKE_NOW"
EOF
chmod +x "$work/bin/date"

passed=0
failed=0
ok() {
  passed=$((passed + 1))
  printf 'ok    %s\n' "$1"
}
bad() {
  failed=$((failed + 1))
  printf 'FAIL  %s\n' "$1"
}
check() { # description, command...
  local description=$1
  shift
  if "$@"; then ok "$description"; else bad "$description"; fi
}

# A commit SHA, distinct per number, with letters in it.
sha_of() { printf 'c0ffee%034x' "$1"; }

# An archive made as the workflow makes it: tar -C <dir> -czf <file> .
pack() { # directory, archive
  tar -C "$1" -czf "$2" .
}
site="$work/site"
mkdir -p "$site/assets"
echo '<!doctype html>' >"$site/index.html"
echo '{}' >"$site/config.json"
echo 'export {};' >"$site/assets/index-abc123.js"
# Unreadable to others in the archive: the receiver makes it readable.
chmod 600 "$site/assets/index-abc123.js"
pack "$site" "$work/good.tar.gz"

status=0
output=
# Runs the receiver; sets status and output (stderr and stdout).
receive() { # command, archive, timestamp
  status=0
  output=$(SSH_ORIGINAL_COMMAND=$1 FAKE_NOW=${3:-20260101T000000Z} PATH="$work/bin:$PATH" \
    bash "$receiver" <"$2" 2>&1) || status=$?
}

# Everything the receiver may change, as text: the link, and every path under
# the web root with its size and mode.
state() {
  readlink "$root/current" 2>/dev/null || echo "(no current)"
  (cd "$root" && find . -mindepth 1 -printf '%p %y %s %m\n' | sort)
  if [[ -d $root/current/ ]]; then
    (cd "$root/current/" && find . -type f -exec sha256sum {} + | sort)
  fi
}
no_incoming() { [[ -z $(find "$root/releases" -name '.incoming-*' -print -quit) ]]; }
releases() { find "$root/releases" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort; }

# --- A valid archive goes live ----------------------------------------------

receive "deploy $(sha_of 1)" "$work/good.tar.gz" 20260101T000001Z
first="20260101T000001Z-$(sha_of 1 | cut -c1-12)"
check "a valid archive is accepted (exit 0)" test "$status" = 0
check "… and says which release is live" test "$output" = "live: $first"
check "current is a relative link to releases/<timestamp>-<sha12>" \
  test "$(readlink "$root/current")" = "releases/$first"
check "the live release contains index.html" test -f "$root/current/index.html"
check "the live release is readable by others" \
  test "$(stat -c %a "$root/releases/$first/assets/index-abc123.js")" = 644
check "no current.tmp is left" test ! -e "$root/current.tmp" -a ! -L "$root/current.tmp"
check "no .incoming-* folder is left" no_incoming

# --- Seven deploys keep the newest five -------------------------------------

for n in 2 3 4 5 6 7; do
  receive "deploy $(sha_of "$n")" "$work/good.tar.gz" "20260101T00000${n}Z"
  [[ $status == 0 ]] || bad "deploy $n is accepted: $output"
done
expected=$(for n in 3 4 5 6 7; do echo "20260101T00000${n}Z-$(sha_of "$n" | cut -c1-12)"; done)
check "seven deploys leave exactly the five newest releases" test "$(releases)" = "$expected"
check "… and current is the newest" \
  test "$(readlink "$root/current")" = "releases/$(tail -n 1 <<<"$expected")"

# A clock stepped backwards: the new release sorts as the oldest, and stays.
receive "deploy $(sha_of 8)" "$work/good.tar.gz" 20251231T235959Z
behind="20251231T235959Z-$(sha_of 8 | cut -c1-12)"
check "a release made with the clock behind goes live" \
  test "$status" = 0 -a "$(readlink "$root/current")" = "releases/$behind"
check "… and is not pruned as the oldest" test -d "$root/releases/$behind"

# --- Refusals: nothing changes ----------------------------------------------

before=$(state)
refused() { # description, expected status, command, archive
  receive "$3" "$4" 20260102T000000Z
  check "$1: refused with exit $2" test "$status" = "$2"
  check "$1: nothing changed, current untouched" test "$(state)" = "$before"
  check "$1: no .incoming-* folder left" no_incoming
}

sha=$(sha_of 9)
refused "an empty command" 2 "" "$work/good.tar.gz"
refused "ls /" 2 "ls /" "$work/good.tar.gz"
refused "deploy without a SHA" 2 "deploy" "$work/good.tar.gz"
refused "deploy with a short SHA" 2 "deploy ${sha:0:7}" "$work/good.tar.gz"
refused "deploy with a 41-character SHA" 2 "deploy ${sha}0" "$work/good.tar.gz"
refused "deploy with a non-hex SHA" 2 "deploy ${sha:0:39}g" "$work/good.tar.gz"
refused "deploy with an upper-case SHA" 2 "deploy $(tr a-f A-F <<<"$sha")" "$work/good.tar.gz"
refused "deploy <sha> extra" 2 "deploy $sha extra" "$work/good.tar.gz"
refused "deploy <sha> and a second line" 2 "deploy $sha"$'\n'"ls /" "$work/good.tar.gz"
refused "deploy with a leading space" 2 " deploy $sha" "$work/good.tar.gz"

no_index="$work/no-index"
mkdir -p "$no_index"
echo '{}' >"$no_index/config.json"
pack "$no_index" "$work/no-index.tar.gz"
refused "an archive without index.html" 3 "deploy $sha" "$work/no-index.tar.gz"
check "… says so" grep -q "no index.html" <<<"$output"

empty="$work/empty"
mkdir -p "$empty"
pack "$empty" "$work/empty.tar.gz"
refused "an empty archive" 3 "deploy $sha" "$work/empty.tar.gz"
check "… says there is no index.html" grep -q "no index.html" <<<"$output"

no_config="$work/no-config"
mkdir -p "$no_config"
echo '<!doctype html>' >"$no_config/index.html"
pack "$no_config" "$work/no-config.tar.gz"
refused "an archive without config.json" 3 "deploy $sha" "$work/no-config.tar.gz"

with_link="$work/with-link"
cp -R "$site" "$with_link"
ln -s /etc/passwd "$with_link/assets/passwd.js"
pack "$with_link" "$work/with-link.tar.gz"
refused "an archive containing a symlink" 3 "deploy $sha" "$work/with-link.tar.gz"
check "… says so" grep -q "symlinks" <<<"$output"

head -c 4096 /dev/urandom >"$work/corrupt.tar.gz"
refused "a corrupt archive" 3 "deploy $sha" "$work/corrupt.tar.gz"
head -c 200 "$work/good.tar.gz" >"$work/truncated.tar.gz"
refused "a truncated archive" 3 "deploy $sha" "$work/truncated.tar.gz"
refused "no archive at all" 3 "deploy $sha" /dev/null

echo
echo "oap-receive: $passed passed, $failed failed"
((failed == 0))

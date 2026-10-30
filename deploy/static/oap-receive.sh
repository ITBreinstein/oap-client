#!/usr/bin/env bash
# oap-receive: receives a web app release from GitHub Actions and puts it live.
# See "Automatic deploys" in README.md.
#
# Install on the server, owned by root so the CI user cannot change it:
#   sudo install -o root -g root -m 755 oap-receive.sh /usr/local/bin/oap-receive
#
# The CI key in ~oap-ci/.ssh/authorized_keys is locked to this script with a
# "forced command", so that key can do nothing except run it:
#   - the command the workflow asks for ("deploy <git-sha>") arrives in
#     $SSH_ORIGINAL_COMMAND instead of being executed;
#   - the release itself arrives on stdin as a .tar.gz archive.
#
# The release layout matches deploy/static/deploy.sh and activate.sh, so
# deploy.sh keeps working as a fallback:
#   /srv/oap-web/releases/<timestamp>-<sha12>/   one folder per release
#   /srv/oap-web/current -> releases/<id>        what Caddy serves
#
# Exit codes: 2 the command is refused, 3 the archive is refused. Either way,
# nothing has changed.

set -euo pipefail # stop on any error, unset variable, or failed pipe
# sshd passes the client's LANG and LC_* on: the checks below must not depend
# on a locale the caller chose.
export LC_ALL=C

WEB_ROOT=/srv/oap-web
RELEASES="$WEB_ROOT/releases"
KEEP=5 # how many releases to keep for rollback

# The requested command must be exactly "deploy <sha>": matched as a whole, so
# a second line, a second word or leading spaces are refused too. It is only
# ever compared, never run, so a leaked key cannot be used to run anything.
cmd=${SSH_ORIGINAL_COMMAND:-}
if [[ $cmd != deploy && $cmd != "deploy "* ]]; then
  echo "refused: only 'deploy <sha>' is allowed" >&2
  exit 2
fi
if [[ ! $cmd =~ ^deploy\ [0-9a-f]{40}$ ]]; then
  echo "refused: expected exactly one full 40-character git SHA" >&2
  exit 2
fi
sha=${cmd#deploy }

# Release name: UTC timestamp + the 12-character short SHA deploy.sh uses.
# Because the timestamp comes first, sorting the names alphabetically also
# sorts them by age.
id="$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}"
incoming="$RELEASES/.incoming-$id"

# If anything below fails, remove the half-unpacked folder on exit.
trap 'if [[ -d "$incoming" ]]; then rm -rf -- "$incoming"; fi' EXIT

mkdir -- "$incoming"

# Unpack the archive from stdin into the hidden "incoming" folder.
# --no-same-owner: files belong to the CI user, whatever the archive says.
# GNU tar already refuses absolute paths and ".." in archive members.
if ! tar -xzf - -C "$incoming" --no-same-owner; then
  echo "refused: the archive could not be unpacked" >&2
  exit 3
fi

# Sanity checks before anything goes live: what activate.sh checks, and more.
for required in index.html config.json; do
  if [[ ! -f "$incoming/$required" ]]; then
    echo "refused: release has no $required" >&2
    exit 3
  fi
done
# A Vite build never contains symlinks; one could point Caddy at files
# outside the release folder, so refuse them.
if [[ -n "$(find "$incoming" -type l -print -quit)" ]]; then
  echo "refused: release contains symlinks" >&2
  exit 3
fi

# Readable by the web server whatever this user's umask, as activate.sh does.
chmod -R u=rwX,go=rX -- "$incoming"

# Give the release its final name (it is complete now, but not live yet).
# -T: fail, rather than move it inside, if a folder of that name exists.
mv -T -- "$incoming" "$RELEASES/$id"

# Atomic switch: create the new link next to the old one, then rename it over
# the old one in a single step. Visitors see either the old or the new release,
# never a mix. The link is relative so it also works if paths are mounted
# elsewhere (for example in a container).
ln -sfn "releases/$id" "$WEB_ROOT/current.tmp"
mv -Tf -- "$WEB_ROOT/current.tmp" "$WEB_ROOT/current"
echo "live: $id"

# Keep the newest $KEEP releases and delete the rest, but never the live one:
# after a clock step backwards the new release sorts as the oldest.
# -name '2*' matches the timestamped folders and skips hidden .incoming ones.
# "head -n -N" prints everything except the last N lines (the newest ones).
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '2*' -printf '%f\n' |
  sort |
  head -n "-$KEEP" |
  while read -r old; do
    [[ $old == "$id" ]] && continue
    rm -rf -- "${RELEASES:?}/$old" # :? stops the script if RELEASES is empty
  done

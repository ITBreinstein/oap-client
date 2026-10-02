#!/usr/bin/env bash
# Runs on the server, fed over ssh by deploy.sh:
#
#   ssh "$OAP_DEPLOY_HOST" bash -s -- <web root> <release id> <releases to keep> < activate.sh
#
# Checks the uploaded release, makes it world-readable for the web server,
# points `current` at it atomically, and removes the oldest releases beyond
# the number to keep — never the one `current` points to. Needs GNU coreutils
# (`mv -T`), as on any Linux server.
set -euo pipefail

root=$1
id=$2
keep=$3

cd "$root"
release="releases/$id"
if [[ ! -f "$release/index.html" || ! -f "$release/config.json" ]]; then
  echo "activate: $release is incomplete; current is unchanged" >&2
  exit 1
fi
chmod -R u=rwX,go=rX "$release"

previous=$(readlink current 2>/dev/null || true)
# A relative link, made beside `current` and renamed over it: rename(2) is
# atomic, so a request sees the old release or the new one, never neither.
ln -sfn "$release" current.tmp
mv -Tf current.tmp current
echo "activate: current -> $release (was: ${previous:-nothing})"

active=$(basename "$(readlink current)")
mapfile -t releases < <(find releases -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
excess=$((${#releases[@]} - keep))
for ((i = 0; i < excess; i++)); do
  old=${releases[i]}
  [[ $old == "$active" ]] && continue
  rm -rf -- "releases/$old"
  echo "activate: removed releases/$old"
done

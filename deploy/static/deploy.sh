#!/usr/bin/env bash
# Build the static web client from the current commit and publish it as a new
# release on the host in OAP_DEPLOY_HOST. See README.md.
#
#   OAP_DEPLOY_HOST=deploy@server deploy/static/deploy.sh [--dry-run]
#
# OAP_WEB_ROOT overrides the web root (default /srv/oap-web). Nothing about
# the host lives in this repository.
set -euo pipefail

usage() {
  echo "usage: OAP_DEPLOY_HOST=user@host $0 [--dry-run]"
}

die() {
  echo "deploy: $*" >&2
  exit 1
}

dry_run=0
for arg in "$@"; do
  case $arg in
    --dry-run) dry_run=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

host=${OAP_DEPLOY_HOST:-}
web_root=${OAP_WEB_ROOT:-/srv/oap-web}
keep=5
[[ -n $host ]] || die "set OAP_DEPLOY_HOST, for example deploy@server"
# Both end up in a remote command line: allow nothing a shell would read.
[[ $host =~ ^[A-Za-z0-9._@:-]+$ ]] || die "OAP_DEPLOY_HOST has unexpected characters"
[[ $web_root =~ ^/[A-Za-z0-9._/-]+$ ]] || die "OAP_WEB_ROOT must be an absolute plain path"

repo=$(git rev-parse --show-toplevel)
cd "$repo"
[[ -z $(git status --porcelain) ]] || die "the working tree is not clean: commit or stash first"

sha=$(git rev-parse --short=12 HEAD)
# Timestamp first, so releases sort by age.
id="$(date -u +%Y%m%dT%H%M%SZ)-$sha"

# Built in a detached worktree of HEAD, so nothing uncommitted or ignored — a
# developer's own apps/web/public/config.json, say — can reach the release.
work=$(mktemp -d "${TMPDIR:-/tmp}/oap-web-deploy.XXXXXX")
cleanup() {
  git -C "$repo" worktree remove --force "$work/src" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "deploy: building $sha"
git worktree add --detach --quiet "$work/src" HEAD
(
  cd "$work/src"
  pnpm install --frozen-lockfile --reporter=silent
  pnpm --filter @breinstein/web build >/dev/null
)
dist="$work/src/apps/web/dist"
cp "$work/src/deploy/static/config.json" "$dist/config.json"

# What must never reach the server.
[[ -f $dist/index.html ]] || die "the build has no index.html"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$dist/config.json" ||
  die "deploy/static/config.json is not JSON"
[[ -z $(find "$dist" -name '*.map') ]] || die "the build contains source maps"
if grep -rq -E 'localhost:50[89][01]' "$dist"; then
  die "the build contains development addresses"
fi

target="$host:$web_root/releases/$id/"
echo "deploy: release $id ($(du -sh "$dist" | cut -f1))"

if ((dry_run)); then
  echo "deploy: dry run — nothing is sent. These would run:"
  echo "  ssh $host readlink $web_root/current"
  echo "  rsync -rlt $dist/ $target"
  echo "  ssh $host bash -s -- $web_root $id $keep < deploy/static/activate.sh"
  echo "      which checks the release, then:"
  echo "      cd $web_root && ln -sfn releases/$id current.tmp && mv -Tf current.tmp current"
  echo "      and keeps the newest $keep releases"
  exit 0
fi

# shellcheck disable=SC2029 # expanded here on purpose; checked to be a plain path above
previous=$(ssh "$host" readlink "$web_root/current" || true)
rsync -rlt "$dist/" "$target"
ssh "$host" bash -s -- "$web_root" "$id" "$keep" <"$repo/deploy/static/activate.sh"

echo "deploy: done. Check it with:"
echo "  OAP_HOSTNAME=<hostname> deploy/static/smoke.sh"
if [[ -n $previous ]]; then
  echo "deploy: to roll back to the previous release:"
  echo "  ssh $host 'cd $web_root && ln -sfn $previous current.tmp && mv -Tf current.tmp current'"
fi

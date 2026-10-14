#!/usr/bin/env bash
# Build the relay's image from the current commit, ship it to the host in
# OAP_DEPLOY_HOST with deploy/relay/relay.json, and replace the running relay
# with it. See README.md.
#
#   OAP_DEPLOY_HOST=deploy@server deploy/relay/deploy.sh [--dry-run]
#   OAP_DEPLOY_HOST=deploy@server deploy/relay/deploy.sh --activate <tag>    # roll back
#
# OAP_RELAY_ROOT overrides the relay's directory on the host (default
# /srv/oap-relay). OAP_RELAY_CADDY says how Caddy runs there: `service`
# (default; the relay's port is published on 127.0.0.1) or `container` (no
# published port; Caddy joins the relay's network). OAP_RELAY_PLATFORM
# overrides the image platform, which is otherwise read from the host. Nothing
# about the host lives in this repository.
set -euo pipefail

usage() {
  echo "usage: OAP_DEPLOY_HOST=user@host $0 [--dry-run | --activate <tag>]"
}

die() {
  echo "deploy: $*" >&2
  exit 1
}

dry_run=0
activate_only=
while (($# > 0)); do
  case $1 in
    --dry-run) dry_run=1 ;;
    --activate)
      shift
      [[ $# -gt 0 ]] || {
        usage >&2
        exit 2
      }
      activate_only=$1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

host=${OAP_DEPLOY_HOST:-}
relay_root=${OAP_RELAY_ROOT:-/srv/oap-relay}
mode=${OAP_RELAY_CADDY:-service}
keep=5
[[ -n $host ]] || die "set OAP_DEPLOY_HOST, for example deploy@server"
# All of these end up in a remote command line: allow nothing a shell would read.
[[ $host =~ ^[A-Za-z0-9._@:-]+$ ]] || die "OAP_DEPLOY_HOST has unexpected characters"
[[ $relay_root =~ ^/[A-Za-z0-9._/-]+$ ]] || die "OAP_RELAY_ROOT must be an absolute plain path"
[[ $mode == service || $mode == container ]] || die "OAP_RELAY_CADDY must be service or container"

repo=$(git rev-parse --show-toplevel)
cd "$repo"
# shellcheck source-path=SCRIPTDIR source=run-flags.sh
source "$repo/deploy/relay/run-flags.sh"

remote_activate() { # tag
  # shellcheck disable=SC2029 # expanded here on purpose; each value is checked above
  cat "$repo/deploy/relay/run-flags.sh" "$repo/deploy/relay/activate.sh" |
    ssh "$host" bash -s -- "$relay_root" "$1" "$mode" "$keep"
}

if [[ -n $activate_only ]]; then
  [[ $activate_only =~ ^[0-9a-f]{12}$ ]] || die "--activate takes a 12-character commit tag"
  ((dry_run)) && die "--activate has no dry run: it only starts an image already on the host"
  remote_activate "$activate_only"
  exit 0
fi

[[ -z $(git status --porcelain) ]] || die "the working tree is not clean: commit or stash first"
sha=$(git rev-parse --short=12 HEAD)
image="oap-relay:$sha"

# The trusted proxy is decided by how Caddy runs, never by hand.
trusted=$([[ $mode == service ]] && echo "$RELAY_GATEWAY" || echo "$RELAY_CADDY_ADDRESS")

# The image is built for the host's CPU: an Apple-silicon Mac builds arm64 by
# default, and an x86 server cannot run that.
platform=${OAP_RELAY_PLATFORM:-}
if [[ -z $platform ]]; then
  if ((dry_run)); then
    platform=linux/amd64
    echo "deploy: dry run — not asking the host for its CPU; assuming $platform (set OAP_RELAY_PLATFORM)"
  else
    case $(ssh "$host" uname -m) in
      x86_64 | amd64) platform=linux/amd64 ;;
      aarch64 | arm64) platform=linux/arm64 ;;
      *) die "the host's CPU is not one this script builds for; set OAP_RELAY_PLATFORM" ;;
    esac
  fi
fi
[[ $platform == linux/amd64 || $platform == linux/arm64 ]] ||
  die "OAP_RELAY_PLATFORM must be linux/amd64 or linux/arm64"

# Built in a detached worktree of HEAD, so nothing uncommitted or ignored can
# reach the image or the config.
tmp=${TMPDIR:-/tmp}
work=$(mktemp -d "${tmp%/}/oap-relay-deploy.XXXXXX")
cleanup() {
  git -C "$repo" worktree remove --force "$work/src" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
git worktree add --detach --quiet "$work/src" HEAD

# The config, checked by the relay's own parser — as the container will read
# it, without the private-address allowance — and then against what a public
# deployment must be.
echo "deploy: checking deploy/relay/relay.json"
(
  cd "$work/src"
  pnpm install --frozen-lockfile --reporter=silent
  pnpm --silent --filter @breinstein/relay build >/dev/null
)
node --input-type=module - "$work/src/apps/relay/.tsbuild/src/config.js" \
  "$work/src/deploy/relay/relay.json" "$trusted" <<'EOF' || die "deploy/relay/relay.json is not fit to deploy"
const [parser, file, trusted] = process.argv.slice(2);
const { parseConfig } = await import(parser);
const { readFileSync } = await import("node:fs");
const raw = JSON.parse(readFileSync(file, "utf8"));
const config = parseConfig(raw);
const problems = [];
if (config.endpoints.length === 0) problems.push("it lists no endpoints");
for (const endpoint of config.endpoints) {
  if (!endpoint.baseUrl.startsWith("https://")) problems.push(`${endpoint.key} is not https:`);
  if (endpoint.callbacks) problems.push(`${endpoint.key} turns callbacks on (finding 0047)`);
}
if (config.publicUrl !== undefined) problems.push("it sets publicUrl, which only callbacks need");
if (JSON.stringify(raw.allowedOrigins ?? []) !== "[]") problems.push("allowedOrigins is not []");
if (JSON.stringify(raw.trustedProxies) !== JSON.stringify([trusted])) {
  problems.push(`trustedProxies must be exactly ["${trusted}"] for this Caddy mode`);
}
for (const problem of problems) console.error(`deploy: relay.json: ${problem}`);
process.exit(problems.length === 0 ? 0 : 1);
EOF

echo "deploy: building $image for $platform"
docker buildx build --quiet --platform "$platform" --load \
  -f "$work/src/apps/relay/Dockerfile" -t "$image" "$work/src" >/dev/null

if ((dry_run)); then
  echo "deploy: dry run — nothing is sent. These would run:"
  echo "  docker save $image | gzip | ssh $host 'gunzip | docker load'"
  echo "  ssh $host mkdir -p $relay_root/configs"
  echo "  ssh $host 'cat > $relay_root/configs/$sha.json' < deploy/relay/relay.json"
  echo "  cat run-flags.sh activate.sh | ssh $host bash -s -- $relay_root $sha $mode $keep"
  echo "      which creates network $RELAY_NETWORK ($RELAY_SUBNET) if it is missing and overlaps nothing,"
  echo "      replaces container $RELAY_CONTAINER with $image, waits for healthy,"
  echo "      starts the previous image again if it is not, and keeps the newest $keep images"
  exit 0
fi

echo "deploy: sending $image ($(docker image inspect -f '{{.Size}}' "$image" | awk '{ printf "%.0f MB", $1 / 1e6 }'))"
docker save "$image" | gzip | ssh "$host" 'gunzip | docker load' >/dev/null
# shellcheck disable=SC2029 # expanded here on purpose; checked to be plain above
ssh "$host" mkdir -p "$relay_root/configs"
# shellcheck disable=SC2029
ssh "$host" "cat > $relay_root/configs/$sha.json" <"$work/src/deploy/relay/relay.json"
remote_activate "$sha"

# shellcheck disable=SC2029
previous=$(ssh "$host" cat "$relay_root/previous" 2>/dev/null || true)
echo "deploy: done. Check it with:"
echo "  OAP_HOSTNAME=<hostname> deploy/static/smoke.sh"
if [[ -n $previous && $previous != "$sha" ]]; then
  echo "deploy: to roll back to the relay that ran before:"
  echo "  OAP_DEPLOY_HOST=$host OAP_RELAY_CADDY=$mode deploy/relay/deploy.sh --activate $previous"
fi

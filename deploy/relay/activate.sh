#!/usr/bin/env bash
# shellcheck disable=SC2154 # the RELAY_* names come from run-flags.sh, sent ahead of this file
# Runs on the server, fed over ssh by deploy.sh after run-flags.sh:
#
#   cat run-flags.sh activate.sh | ssh "$OAP_DEPLOY_HOST" bash -s -- <root> <tag> <caddy mode> <keep>
#
# Makes sure the relay's network exists as run-flags.sh describes it, then
# replaces the relay container with the image `oap-relay:<tag>` and the config
# `<root>/configs/<tag>.json`, both already on the server. If the new container
# does not report healthy, the one it replaced is started again and this exits
# non-zero. Finally removes the oldest images and configs beyond the number to
# keep, never the active or the previous one. Needs bash, docker and `ip`.
set -euo pipefail

root=$1
tag=$2
mode=$3
keep=$4

die() {
  echo "activate: $*" >&2
  exit 1
}

image="oap-relay:$tag"
config="$root/configs/$tag.json"
docker image inspect "$image" >/dev/null 2>&1 || die "$image is not on this server"
[[ -f $config ]] || die "$config is not on this server"

# --- The network ------------------------------------------------------------

ip_to_int() {
  local a b c d
  IFS=. read -r a b c d <<<"$1"
  echo $(((a << 24) + (b << 16) + (c << 8) + d))
}

# True when two IPv4 CIDR ranges share any address.
overlaps() {
  local a_net=${1%/*} a_len=${1#*/} b_net=${2%/*} b_len=${2#*/}
  [[ $1 == */* ]] || a_len=32
  [[ $2 == */* ]] || b_len=32
  local len=$((a_len < b_len ? a_len : b_len))
  local mask=$(((0xffffffff << (32 - len)) & 0xffffffff))
  (($(($(ip_to_int "$a_net") & mask)) == $(($(ip_to_int "$b_net") & mask))))
}

if docker network inspect "$RELAY_NETWORK" >/dev/null 2>&1; then
  actual=$(docker network inspect "$RELAY_NETWORK" \
    -f '{{range .IPAM.Config}}{{.Subnet}} {{.IPRange}} {{.Gateway}}{{end}}')
  expected="$RELAY_SUBNET $RELAY_IP_RANGE $RELAY_GATEWAY"
  [[ $actual == "$expected" ]] ||
    die "network $RELAY_NETWORK exists as '$actual', not '$expected'; remove it or fix run-flags.sh"
else
  # Every other Docker network, and every route the host has: none may share
  # an address with the relay's subnet.
  while read -r subnet; do
    [[ $subnet =~ ^[0-9.]+/[0-9]+$ ]] || continue
    overlaps "$subnet" "$RELAY_SUBNET" && die "$RELAY_SUBNET overlaps the Docker network subnet $subnet"
  done < <(docker network ls -q | xargs docker network inspect \
    -f '{{range .IPAM.Config}}{{println .Subnet}}{{end}}')
  while read -r destination _; do
    [[ $destination =~ ^[0-9.]+(/[0-9]+)?$ ]] || continue
    overlaps "$destination" "$RELAY_SUBNET" && die "$RELAY_SUBNET overlaps the host route to $destination"
  done < <(ip -4 route show)
  docker network create --driver bridge --subnet "$RELAY_SUBNET" --ip-range "$RELAY_IP_RANGE" \
    --gateway "$RELAY_GATEWAY" "$RELAY_NETWORK" >/dev/null
  echo "activate: created network $RELAY_NETWORK ($RELAY_SUBNET)"
fi

# --- The container ------------------------------------------------------------

publish=()
if [[ $mode == service ]]; then
  publish=("${RELAY_PUBLISH[@]}")
elif [[ $mode != container ]]; then
  die "caddy mode must be service or container, not '$mode'"
fi

previous=$(docker inspect -f '{{.Config.Image}}' "$RELAY_CONTAINER" 2>/dev/null || true)
previous_tag=${previous#oap-relay:}

run() { # tag
  docker run -d --name "$RELAY_CONTAINER" "${RELAY_RUN_FLAGS[@]}" "${publish[@]}" \
    -v "$root/configs/$1.json:/config.json:ro" "oap-relay:$1" >/dev/null
}

healthy() {
  local status=starting
  for _ in $(seq 1 60); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$RELAY_CONTAINER" 2>/dev/null || echo missing)
    [[ $status == healthy ]] && return 0
    [[ $status == unhealthy || $status == missing ]] && break
    sleep 1
  done
  echo "activate: the relay is $status" >&2
  return 1
}

docker rm -f "$RELAY_CONTAINER" >/dev/null 2>&1 || true
run "$tag"
if ! healthy; then
  docker logs --tail 20 "$RELAY_CONTAINER" >&2 || true
  docker rm -f "$RELAY_CONTAINER" >/dev/null
  if [[ -n $previous_tag && $previous_tag != "$tag" && -f $root/configs/$previous_tag.json ]]; then
    run "$previous_tag"
    healthy || die "$image did not become healthy, and neither did $previous on the way back"
    die "$image did not become healthy; $previous is running again"
  fi
  die "$image did not become healthy, and there was nothing to go back to: the relay is down"
fi
echo "activate: $RELAY_CONTAINER runs $image (was: ${previous:-nothing})"
if [[ -n $previous_tag && $previous_tag != "$tag" ]]; then
  echo "$previous_tag" >"$root/previous"
fi

if [[ $mode == container ]]; then
  holder=$(docker network inspect "$RELAY_NETWORK" \
    -f "{{range .Containers}}{{if eq .IPv4Address \"$RELAY_CADDY_ADDRESS/24\"}}{{.Name}}{{end}}{{end}}")
  if [[ -z $holder ]]; then
    echo "activate: WARNING nothing holds $RELAY_CADDY_ADDRESS on $RELAY_NETWORK: attach Caddy (README.md)" >&2
  else
    echo "activate: $holder holds $RELAY_CADDY_ADDRESS on $RELAY_NETWORK"
  fi
fi

# --- Old releases ---------------------------------------------------------------

kept=$(cat "$root/previous" 2>/dev/null || true)
mapfile -t tags < <(docker image ls oap-relay --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | cut -f2)
count=0
for old in "${tags[@]}"; do
  count=$((count + 1))
  ((count > keep)) || continue
  [[ $old == "$tag" || $old == "$kept" ]] && continue
  docker image rm "oap-relay:$old" >/dev/null && echo "activate: removed oap-relay:$old"
  rm -f -- "$root/configs/$old.json"
done

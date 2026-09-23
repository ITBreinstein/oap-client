#!/usr/bin/env bash
# The ZOO-Project reference deployment: a second server implementation to test
# the client against, pinned so a finding recorded in August is reproducible in
# October. Read infra/zoo/README.md before changing anything here.
#
#   ./infra/zoo/zoo.sh up       clone at the pinned SHA, build, start on :5090
#   ./infra/zoo/zoo.sh refresh  restart zoofpm: a fresh pool of async workers
#   ./infra/zoo/zoo.sh down     stop and remove
#   ./infra/zoo/zoo.sh ps       what is running
#   ./infra/zoo/zoo.sh logs     follow zookernel
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pinned.env
set -a && . "$here/pinned.env" && set +a

checkout="$here/.checkout"
override="$here/../compose/zoo.yml"
project=oap-zoo

compose() {
  docker compose -p "$project" -f "$checkout/docker-compose.yml" -f "$override" "$@"
}

# The checkout is a build input, not a working copy: fetch exactly one commit
# and detach onto it. A dirty checkout means the image no longer matches the
# tag it carries, so refuse rather than build something unrepeatable.
sync_checkout() {
  if [ ! -d "$checkout/.git" ]; then
    echo "==> cloning ${ZOO_FORK_REPO} at ${ZOO_FORK_SHA:0:7}"
    rm -rf "$checkout"
    git init -q "$checkout"
    git -C "$checkout" remote add origin "$ZOO_FORK_REPO"
  fi
  if [ "$(git -C "$checkout" rev-parse HEAD 2>/dev/null || true)" != "$ZOO_FORK_SHA" ]; then
    git -C "$checkout" fetch -q --depth 1 origin "$ZOO_FORK_SHA"
    git -C "$checkout" checkout -q --detach FETCH_HEAD
  fi
  if [ -n "$(git -C "$checkout" status --porcelain)" ]; then
    echo "!! $checkout is dirty; the image would not match ${ZOO_IMAGE}." >&2
    echo "!! Fix the deployment in infra/, or record a finding. Do not patch the checkout." >&2
    exit 1
  fi
  # Upstream README's step, and the fork keeps only a .gitignore here.
  mkdir -p "$checkout/docker/tmp" && chmod 777 "$checkout/docker/tmp"
}

# docker/zookernel-local.Dockerfile builds `FROM zooproject/zoo-project:latest`,
# which is a moving tag. Resolve `latest` to the commit-tagged image first, so
# the build is pinned on both ends without editing the checkout.
pin_base_image() {
  echo "==> pinning base to ${ZOO_BASE_IMAGE##*:}"
  # ZOO publishes amd64 only. Without --platform, Docker on Apple Silicon
  # refuses the manifest rather than falling back, and the compose services
  # already declare `platform: linux/amd64` for the same reason.
  docker pull -q --platform linux/amd64 "$ZOO_BASE_IMAGE"
  docker tag "$ZOO_BASE_IMAGE" zooproject/zoo-project:latest
}

# ZOO builds every advertised href from a *configured* root URL and never looks
# at the request, so a kernel serving on :5090 hands out links to :80 unless it
# is told otherwise. Rendered from the checkout's own configuration rather than
# copied, so the delta stays one sed and cannot go stale when the pin moves.
# See finding 0008 — the deployment is configured correctly here, and the
# behaviour that makes this necessary is recorded rather than hidden.
render_conf() { # render_conf <port>
  local port="$1" dir="$here/.conf"
  mkdir -p "$dir"
  sed -e "s|http://localhost/|http://localhost:${port}/|g" \
      -e "s|^rootHost=http://localhost$|rootHost=http://localhost:${port}|" \
      "$checkout/docker/oas.cfg" > "$dir/oas-${port}.cfg"
  sed -e "s|http://localhost/|http://localhost:${port}/|g" \
      "$checkout/docker/main.cfg" > "$dir/main-${port}.cfg"
}

# Apache answers 503 while the kernel behind it is still coming up — and stays
# there indefinitely for a container resumed with `docker start` instead of
# recreated, which is why `up` is the only supported way back in. A completed
# 503 is still a completed HTTP response, so waiting for "the port is open"
# would hand the test lane a half-started server. Wait for a usable landing
# page, recreate once if it never arrives, and fail loudly if it still does not.
serving_json() { # serving_json <port>
  local code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code} %{content_type}' \
    -H 'Accept: application/json' "http://localhost:$1/ogc-api/" || true)
  case "$code" in 200\ application/json*) return 0 ;; *) return 1 ;; esac
}

wait_ready() { # wait_ready <port> <service>
  local port="$1" service="$2" attempt
  for attempt in $(seq 1 30); do
    if serving_json "$port"; then return 0; fi
    sleep 2
  done
  echo "==> :$port still not serving JSON; recreating $service"
  compose up -d --force-recreate "$service"
  for attempt in $(seq 1 30); do
    if serving_json "$port"; then return 0; fi
    sleep 2
  done
  echo "!! :$port never served a landing page. \`$0 logs\`, or \`$0 down\` and start over." >&2
  return 1
}

# A ZOO deployment's asynchronous capacity decays with every job it runs and
# does not recover. The count of `zoo_loader_fpm` workers falls at about one
# per job — sequential or concurrent, it makes no difference — starting from
# `[server] async_worker`, which is 20. At zero, jobs are still accepted and
# then orphaned in `running` for ever. Measured, with numbers, in finding 0044;
# reproduce with `infra/zoo/characterise-pool.mjs`. The process-level cause is
# an open question, so do not repeat any mechanism you may have heard.
#
# So the interop lane restarts the worker container before it runs. This is a
# workaround and it is worth being blunt about what it does not do: it does not
# fix the defect, it resets the counter. A real deployment cannot restart
# between users, which is exactly why the finding exists and why this is a lane
# pretask rather than something buried in a test helper.
#
# Only zoofpm is restarted. zookernel, the database and the broker keep their
# state, so job history survives and the lane stays comparable run to run.
#
# Tolerant on purpose. The interop lane never blocks a release and skips itself
# when nothing is answering, so a laptop with Docker stopped must reach the
# skip rather than fail here on the way to it.
refresh_workers() {
  if ! docker info >/dev/null 2>&1; then
    echo "==> Docker is not running; leaving ZOO alone (the interop lane will skip)"
    return 0
  fi
  if [ -z "$(compose ps -q zoofpm 2>/dev/null)" ]; then
    echo "==> zoofpm is not up; leaving ZOO alone (run \`$0 up\` first)"
    return 0
  fi
  echo "==> restarting zoofpm for a fresh pool of async workers (finding 0044)"
  compose restart zoofpm
  wait_ready 5090 zookernel
}

case "${1:-up}" in
  up)
    sync_checkout
    render_conf 5090
    pin_base_image
    # zookernel and zoofpm only: their depends_on pulls in pg, pgbouncer, redis
    # and rabbitmq, while websocketd stays down — it is a second source build we
    # have no use for, and the client polls rather than subscribing.
    compose up -d --build zookernel zoofpm
    wait_ready 5090 zookernel
    echo "==> http://localhost:5090/ogc-api/"
    ;;
  refresh)
    refresh_workers
    ;;
  down) compose down -v --remove-orphans ;;
  ps) compose ps ;;
  logs) compose logs -f zookernel ;;
  *) echo "usage: $0 {up|refresh|down|ps|logs}" >&2; exit 2 ;;
esac

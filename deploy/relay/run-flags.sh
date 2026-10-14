# shellcheck shell=bash disable=SC2034 # every name here is read by whoever sources it
# How the relay container runs in production, in one place. Sourced by
# deploy.sh, and by the relay-image job in CI, so the image is tested exactly
# as it is deployed. Not run on its own. See README.md.

# The relay's own user-defined network, created by deploy.sh with this fixed
# subnet. Fixed, so the one address the relay trusts X-Forwarded-For from is
# known before the first deploy: the gateway when Caddy is a system service,
# or Caddy's own address on this network when Caddy runs in a container.
#
# Docker hands out a network's addresses from .2 upward, so without a range
# of its own the relay itself would take Caddy's address. Automatic addresses
# come from the upper half only; the lower half is for fixed ones.
RELAY_NETWORK=oap-relay
RELAY_SUBNET=172.31.87.0/24
RELAY_IP_RANGE=172.31.87.128/25
RELAY_GATEWAY=172.31.87.1
RELAY_CADDY_ADDRESS=172.31.87.2

RELAY_CONTAINER=oap-relay

# Every container the relay runs as. Never RELAY_ALLOW_PRIVATE_ADDRESSES.
RELAY_RUN_FLAGS=(
  --restart unless-stopped
  --network "$RELAY_NETWORK"
  # Nothing in the image writes to disk; it starts without a tmpfs.
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --memory 256m
  # The default json-file driver never rotates.
  --log-opt max-size=10m
  --log-opt max-file=5
  -e RELAY_CONFIG=/config.json
)

# Only when Caddy is a system service on the host. Never without 127.0.0.1:
# Docker writes its own firewall rules, which bypass UFW, so a bare
# `-p 8787:8787` would be public.
RELAY_PUBLISH=(-p 127.0.0.1:8787:8787)

# The relay, as a container. Build from the repository root, because the
# lockfile and workspace manifest live there:
#
#   docker build -f apps/relay/Dockerfile -t oap-relay .
#   docker run -p 8787:8787 -v "$PWD/relay.json:/config.json:ro" \
#     -e RELAY_CONFIG=/config.json oap-relay
#
# relay.json is your own config; start from infra/relay/demo.example.json.
#
# The runtime image holds production dependencies and the compiled relay, and
# nothing else: no sources, no tests, no toolchain.
#
# Both stages use one base image, pinned by digest so a rebuild cannot pick up
# a different Node. It is the multi-platform index of node:24-alpine as of
# 2026-10-02 (Node 24.21.0); refresh it with `docker buildx imagetools inspect node:24-alpine`.

ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${NODE_IMAGE} AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/relay/package.json apps/relay/
RUN pnpm install --frozen-lockfile --filter "@breinstein/relay..." --filter "breinstein-oap-client"
COPY apps/relay apps/relay
RUN pnpm --filter @breinstein/relay build \
 && pnpm --filter @breinstein/relay deploy --prod --legacy /out \
 && cp -r apps/relay/.tsbuild/src /out/dist

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 8787
# Shell form, so a PORT set at `docker run` is the one checked.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=1s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "dist/server.js"]

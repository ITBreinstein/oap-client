# The relay, as a container. Build from the repository root, because the
# lockfile and workspace manifest live there:
#
#   docker build -f apps/relay/Dockerfile -t oap-relay .
#   docker run -p 8787:8787 -v "$PWD/infra/relay/local.json:/config.json:ro" \
#     -e RELAY_CONFIG=/config.json oap-relay
#
# The runtime image holds production dependencies and the compiled relay, and
# nothing else: no sources, no tests, no toolchain.

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/relay/package.json apps/relay/
RUN pnpm install --frozen-lockfile --filter "@breinstein/relay..." --filter "breinstein-oap-client"
COPY apps/relay apps/relay
RUN pnpm --filter @breinstein/relay build \
 && pnpm --filter @breinstein/relay deploy --prod --legacy /out \
 && cp -r apps/relay/.tsbuild/src /out/dist

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "dist/server.js"]

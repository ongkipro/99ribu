# syntax=docker/dockerfile:1
# S84 production image. One image serves both Coolify Applications (web, worker) and the S85 backup
# task; only the start command differs. Topology, volumes and env names: RELEASE.md "Container
# topology (S84)". Base images are pinned by digest; bump tag and digest together.

# PostgreSQL 18 client source: same pinned image as compose.yaml, so the backup client matches the server.
FROM postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c AS pgdg

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# package.json pins npm (engines + engine-strict); the base image ships an older npm.
RUN npm install --global --ignore-scripts npm@12.2.0
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
# The build reads only the committed non-secret .env.example profile (npm run build); no runtime secret
# is needed or baked in. Dev dependencies are pruned before the runtime stage copies node_modules.
RUN npm run build && npm prune --omit=dev && rm -rf .next/cache

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
COPY --from=pgdg /usr/local/share/keyrings/postgres.gpg.asc /usr/local/share/keyrings/postgres.gpg.asc
COPY --from=pgdg /etc/apt/sources.list.d/pgdg.list /etc/apt/sources.list.d/pgdg.list
RUN apt-get update \
  && apt-get install --yes --no-install-recommends postgresql-client-18=18.6-1.pgdg12+2 libpq5=18.6-1.pgdg12+2 tini=0.19.0-1+b3 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 app \
  && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 PATH=/usr/lib/postgresql/18/bin:$PATH
# Runtime files only, owned by root and read-only to the app user. Not copied: tests, docs (except the
# one JSON the shipping module imports), design, public/prototypes, .env*, .local, .delivery.
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/data/catalog/berlapak ./data/catalog/berlapak
COPY --from=build /app/docs/spec/fixtures/shipping-local.json ./docs/spec/fixtures/shipping-local.json
# .local is the persistent volume mount point (catalog-media + artifacts). A fresh named volume copies
# this owner and the 0700 modes that privateDirectory() requires. .next/cache is the only writable build path.
RUN install -d -o 10001 -g 10001 -m 0700 .local .local/catalog-media .local/artifacts \
  && install -d -o 10001 -g 10001 -m 0700 .next/cache
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
# tini is PID 1: it forwards SIGTERM to the app process and reaps orphaned children (no reliance on the
# platform's --init option).
ENTRYPOINT ["/usr/bin/tini", "--"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=3 CMD ["node", "scripts/healthcheck.ts"]
# Web (default): advisory-locked migration (S83), then serve on 0.0.0.0:$PORT (S82 production profile).
# A failed migration exits non-zero, so the container never turns healthy and Coolify keeps the previous
# one. The long-running server never holds the owner password (env -u). Worker: override the command
# with `node scripts/worker.ts production` and give the worker no owner password.
CMD ["sh", "-c", "node scripts/migrate.ts production && exec env -u DATABASE_OWNER_PASSWORD node scripts/run-local.ts start"]

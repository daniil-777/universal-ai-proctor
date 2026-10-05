# syntax=docker/dockerfile:1.7
# Build with guidance-app as the context. All provider credentials are runtime-only.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates tini gosu \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
ENV CI=1
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --prefix backend \
    && npm ci --include=dev --prefix frontend
COPY package.json ./
COPY scripts/ ./scripts/
COPY deployment/media-manifest.json ./deployment/media-manifest.json
COPY backend/src/ ./backend/src/
COPY backend/scripts/ ./backend/scripts/
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY frontend/ ./frontend/
COPY guidance-library/ ./guidance-library/
COPY evaluation/assets/ ./evaluation/assets/
COPY evaluation/results/ ./evaluation/results/
# Download immutable, SHA256-verified release media into its original application paths.
# This fails the build on missing, corrupt or inaccessible media rather than hiding samples.
RUN node scripts/download-assets.mjs \
    && npm run build \
    && npm prune --omit=dev --prefix backend

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8101 \
    MOCK=0 \
    ACCOUNT_COOKIE_SECURE=true \
    DATA_DIR=/data/accounts \
    UPLOAD_ROOT=/data/uploads \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    FFMPEG_CONCURRENCY=1
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./package.json
COPY --from=build /app/backend/node_modules/ ./node_modules/
COPY --from=build /app/backend/dist/ ./dist/
COPY --from=build /app/frontend/dist/ /app/frontend/dist/
COPY --from=build /app/guidance-library/ /app/guidance-library/
COPY --from=build /app/sample-videos/ /app/sample-videos/
COPY --from=build /app/evaluation/assets/ /app/evaluation/assets/
COPY --from=build /app/evaluation/results/ /app/evaluation/results/
# A newly attached host disk can be root-owned. Bootstrap only the private data
# directories, then run Node and its FFmpeg/report children as the node user.
RUN <<'SHELL'
set -eu
mkdir -p /data/accounts /data/uploads
chown node:node /data/accounts /data/uploads
cat > /usr/local/bin/process-guide-entrypoint <<'ENTRYPOINT'
#!/bin/sh
set -eu
umask 077
if [ "${NODE_ENV:-production}" = "production" ] && [ -z "${ACCOUNT_PUBLIC_ORIGIN:-}" ]; then
  echo 'Set ACCOUNT_PUBLIC_ORIGIN to the exact external HTTPS origin before starting production.' >&2
  exit 1
fi
mkdir -p "$DATA_DIR" "$UPLOAD_ROOT"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" "$UPLOAD_ROOT"
  chmod 700 "$DATA_DIR" "$UPLOAD_ROOT"
  exec gosu node "$@"
fi
exec "$@"
ENTRYPOINT
chmod 755 /usr/local/bin/process-guide-entrypoint
SHELL
EXPOSE 8101
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8101) + '/api/health', {signal: AbortSignal.timeout(4000)}).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/process-guide-entrypoint"]
CMD ["node", "dist/server.js"]

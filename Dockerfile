# Production image: Next.js standalone server + the migration runner.
# Docker Hub and npm may be unreachable from Iranian servers: build this image somewhere that can
# reach them and push it to your registry, or point the build args at local mirrors.
ARG NODE_IMAGE=node:20-alpine

FROM ${NODE_IMAGE} AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry="$NPM_REGISTRY" --no-audit --no-fund

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
 && npx esbuild scripts/migrate.ts --bundle --platform=node --target=node20 --format=cjs --outfile=dist/migrate.cjs

FROM ${NODE_IMAGE} AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    TZ=Asia/Tehran FILE_STORE_DIR=/data/storage
RUN apk add --no-cache tzdata \
 && addgroup -S app && adduser -S app -G app \
 && mkdir -p /data/storage && chown app:app /data/storage
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/dist/migrate.cjs ./migrate.cjs
COPY --from=build --chown=app:app /app/db/migrations ./db/migrations
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

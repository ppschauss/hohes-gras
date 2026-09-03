# syntax=docker/dockerfile:1
# Mehrstufig: die Mini-App wird gebaut und als statische Dateien in das
# API-Image gelegt. Ein Container, ein Origin — kein CORS im Betrieb.

FROM node:22-alpine AS build
WORKDIR /src

# better-sqlite3 wird nativ kompiliert; Alpine braucht dafür Toolchain.
RUN apk add --no-cache python3 make g++

COPY app/package.json app/package-lock.json* ./
COPY app/packages/shared/package.json  packages/shared/
COPY app/packages/content/package.json packages/content/
COPY app/packages/engine/package.json  packages/engine/
COPY app/packages/hub/package.json     packages/hub/
COPY app/packages/api/package.json     packages/api/
COPY app/packages/web/package.json     packages/web/
RUN npm ci --no-audit --no-fund

COPY app/ ./
RUN npm run build -w @game/shared \
 && npm run build -w @game/content \
 && npm run build -w @game/engine \
 && npm run build -w @game/api \
 && npm run build -w @game/web

# Nur Laufzeit-Abhängigkeiten ins finale Image.
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Berlin

RUN apk add --no-cache tini curl \
 && addgroup -g 1001 -S poke \
 && adduser -u 1001 -S poke -G poke

COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/packages/shared/dist   ./packages/shared/dist
COPY --from=build /src/packages/shared/package.json ./packages/shared/
COPY --from=build /src/packages/content/dist  ./packages/content/dist
COPY --from=build /src/packages/content/package.json ./packages/content/
COPY --from=build /src/packages/engine/dist   ./packages/engine/dist
COPY --from=build /src/packages/engine/package.json ./packages/engine/
COPY --from=build /src/packages/hub/dist      ./packages/hub/dist
COPY --from=build /src/packages/hub/package.json ./packages/hub/
COPY --from=build /src/packages/api/dist      ./packages/api/dist
COPY --from=build /src/packages/api/migrations ./packages/api/migrations
COPY --from=build /src/packages/api/public    ./packages/api/public
COPY --from=build /src/packages/api/package.json ./packages/api/

# Die selbst gezeichneten Bilder. Sie gehoeren zum Programm, nicht zu den
# Daten: `data/` ist pro Instanz und nicht im Git, diese hier sind ueberall
# gleich und muessen mit jedem Image mitkommen.
COPY --from=build /src/assets ./assets

USER poke
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3010}/api/health || exit 1

# tini als PID 1: sonst erreicht SIGTERM den Node-Prozess nicht sauber und
# `docker stop` wartet jedes Mal die vollen 10 Sekunden ab.
ENTRYPOINT ["/sbin/tini", "--"]
# Welcher Git-Stand hier drinsteckt.
#
# Beim Bauen hineingereicht (`manage.sh` nimmt `git rev-parse`). Ohne das
# wuesste der laufende Container nicht, was er ist — und der Abgleich mit dem
# Verbund waere Raten statt Vergleichen.
ARG GIT_SHA=unbekannt
ENV GIT_SHA=$GIT_SHA

CMD ["node", "packages/api/dist/index.js"]

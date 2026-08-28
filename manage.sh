#!/bin/bash
# telegram-pokemon Verwaltung (Docker-Run-Fallback, da Unraid-Host kein compose-Plugin hat).
set -e
cd "$(dirname "$0")"

IMAGE=telegram-pokemon:latest
NAME=telegram-pokemon
PORT=3010

case "$1" in
  build)
    docker build -t "$IMAGE" ./build
    ;;
  up)
    [ -f ./secrets.env ] || { echo "secrets.env fehlt (Vorlage: secrets.env.example)"; exit 1; }
    mkdir -p ./data/packs ./data/media ./data/backups
    # Der Container laeuft als uid 1001, nicht als root — ohne das kann
    # SQLite die Datenbank im Bind-Mount nicht anlegen.
    chown -R 1001:1001 ./data
    docker rm -f "$NAME" 2>/dev/null || true
    docker run -d --name "$NAME" --restart unless-stopped \
      --env-file ./secrets.env \
      -e TZ=Europe/Berlin \
      -e DATA_DIR=/data \
      -p "${PORT}:${PORT}" \
      -v "$(pwd)/data:/data" \
      "$IMAGE"
    echo "gestartet auf Port ${PORT}."
    ;;
  rebuild)
    "$0" build && "$0" up
    ;;
  down)
    docker rm -f "$NAME"
    ;;
  restart)
    docker restart "$NAME"
    ;;
  logs)
    docker logs -f --tail 100 "$NAME"
    ;;
  health)
    echo "--- Container:"
    docker ps --filter "name=^${NAME}$" --format '{{.Names}}  {{.Status}}'
    echo "--- API:"
    curl -fsS "http://127.0.0.1:${PORT}/api/health" && echo
    ;;
  shell)
    docker exec -it "$NAME" sh
    ;;
  backup)
    ts=$(date +%Y%m%d-%H%M%S)
    cp ./data/game.db "./data/backups/game-manual-${ts}.db"
    echo "Sicherung: ./data/backups/game-manual-${ts}.db"
    ;;
  *)
    echo "Nutzung: $0 {build|up|rebuild|down|restart|logs|health|shell|backup}"
    exit 1
    ;;
esac

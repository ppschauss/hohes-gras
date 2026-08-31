#!/bin/bash
# telegram-pokemon Verwaltung (Docker-Run-Fallback, da Unraid-Host kein compose-Plugin hat).
set -e
cd "$(dirname "$0")"

IMAGE=telegram-pokemon:latest
NAME=telegram-pokemon
PORT=3010

case "$1" in
  build)
    # Den Git-Stand mitgeben: der laufende Container soll sagen koennen, was
    # er ist. Ohne Repository (heruntergeladenes Archiv) bleibt es "unbekannt",
    # und der Abgleich mit dem Verbund haelt sich dann einfach heraus.
    sha=$(git rev-parse --short HEAD 2>/dev/null || echo unbekannt)
    docker build --build-arg "GIT_SHA=$sha" -t "$IMAGE" ./build
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
  update)
    # Den neuen Stand holen und neu bauen — mit Rueckweg.
    #
    # Der Container ruft das nicht selbst auf. Er legt nur eine Marke in
    # data/ ab; hier laeuft, was Rechte auf dem Wirt braucht. Ein Container,
    # der sich selbst neu bauen darf, braucht den Docker-Socket — und damit
    # Zugriff auf alles, was auf der Maschine laeuft.
    set -e
    vorher=$(git rev-parse --short HEAD 2>/dev/null || echo unbekannt)
    if [ "$vorher" = unbekannt ]; then
      echo "Kein Git-Repository — Update von Hand." >&2
      exit 1
    fi

    echo "== Sicherung"
    ts=$(date +%Y%m%d-%H%M%S)
    cp ./data/game.db "./data/backups/game-vor-update-${ts}.db"
    echo "   ./data/backups/game-vor-update-${ts}.db"

    echo "== Holen"
    git pull --ff-only || { echo "git pull fehlgeschlagen — nichts veraendert." >&2; exit 1; }
    nachher=$(git rev-parse --short HEAD)
    if [ "$vorher" = "$nachher" ]; then
      echo "   schon aktuell ($vorher)"
      exit 0
    fi
    echo "   $vorher -> $nachher"

    echo "== Bauen und starten"
    if "$0" rebuild; then
      # Antwortet der Dienst? Ein Update, das den Bot stumm zurueck laesst,
      # ist schlimmer als keins.
      gesund=0
      for i in $(seq 1 20); do
        sleep 3
        if docker exec "$NAME" wget -qO- http://127.0.0.1:3010/api/health >/dev/null 2>&1; then
          gesund=1; break
        fi
      done
    else
      gesund=0
    fi

    if [ "$gesund" = 1 ]; then
      echo "== Fertig: $nachher laeuft."
    else
      echo "== Fehlgeschlagen — zurueck auf $vorher" >&2
      git reset --hard "$vorher" >/dev/null
      "$0" rebuild
      cp "./data/backups/game-vor-update-${ts}.db" ./data/game.db
      echo "   Alter Stand wiederhergestellt, Datenbank zurueckgespielt." >&2
      exit 1
    fi
    ;;

  watch)
    # Der Waechter.
    #
    # Sieht alle 30 Sekunden nach, ob im Spiel jemand auf "Aktualisieren"
    # gedrueckt hat, und fuehrt dann `update` aus. Laeuft auf dem Wirt, nicht
    # im Container — das ist der ganze Punkt.
    #
    # Starten:  nohup ./manage.sh watch >> ./data/update.log 2>&1 &
    echo "Waechter laeuft. Marke: ./data/update-requested"
    while true; do
      if [ -f ./data/update-requested ]; then
        echo "[$(date '+%F %T')] Update angefordert."
        rm -f ./data/update-requested
        "$0" update || echo "[$(date '+%F %T')] Update fehlgeschlagen."
      fi
      sleep 30
    done
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

#!/bin/bash
# Screenshot der Mini-App.
#
# Ohne iframe und mindestens 520px breit — beides erzwungen von
# headless-chromium: es klemmt die Layout-Breite auf 520 und malt
# verschachtelte iframes nur bis zu einer begrenzten Hoehe aus. Fuer echte
# Telefonbreiten ist deshalb ./tools/layout-check.sh zustaendig; das misst,
# statt zu malen.
#
# Nutzung: ./tools/preview.sh <ausgabe.png> [hoehe] [pfad-in-der-app]
set -e
cd "$(dirname "$0")/.."

OUT="${1:?Ausgabedatei angeben}"
HEIGHT="${2:-900}"
PATH_IN_APP="${3:-/__preview.html}"
HOST="${PREVIEW_HOST:-172.17.0.1:3010}"

mkdir -p "$(dirname "$OUT")"
OUTDIR=$(cd "$(dirname "$OUT")" && pwd)

docker run --rm --network bridge -v "$OUTDIR:/out" \
  --entrypoint /usr/bin/chromium-browser poke-shot:latest \
  --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=520,"$HEIGHT" \
  --screenshot="/out/$(basename "$OUT")" --virtual-time-budget=6000 \
  "http://${HOST}${PATH_IN_APP}" 2>/dev/null || true

echo "Screenshot: $OUT (520x${HEIGHT} CSS)"

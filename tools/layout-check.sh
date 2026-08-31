#!/bin/bash
# Prueft das Layout bei echten Telefonbreiten — durch Messen, nicht durch
# Ansehen. Meldet horizontalen Ueberlauf und Elemente, die ueber den Rand
# ragen.
#
# Eine Breite je Browserlauf. Vorher liefen vier Fenster gleichzeitig hinter
# einem einzigen Wecker von drei Sekunden; drei davon waren dann noch leer,
# gemessen wurde eine weisse Seite und gemeldet "ok". Jedes Ergebnis unter 430
# Punkten war dadurch wertlos — so ist eine zu breite Ressourcenzeile
# durchgerutscht, die auf dem Telefon die halbe Seite abschnitt.
#
# Nutzung: ./tools/layout-check.sh [pfad-in-der-app]
set -e
cd "$(dirname "$0")/.."

PATH_IN_APP="${1:-/__preview.html}"
HOST="${PREVIEW_HOST:-172.17.0.1:3010}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

for W in 320 360 390 430; do
cat > "$TMP/check.html" <<EOF
<!doctype html><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block}</style>
<iframe id="f" width="$W" height="844" src="http://${HOST}${PATH_IN_APP}"></iframe>
<script>
const f = document.getElementById('f')
setTimeout(() => {
  let zeile
  try {
    const d = f.contentDocument
    const de = d.documentElement
    const shell = d.querySelector('.shell')
    const bar = d.querySelector('.tabbar, .rail')
    const wide = []
    /*
     * Was in einem Kasten steckt, der selbst rollt, ragt nicht ueber die
     * Seite — es ist dort beschnitten und erreichbar. Der Seitenroller
     * \`.viewport\` zaehlt ausdruecklich nicht dazu: was *dort* herausragt,
     * macht die ganze Seite schiebbar, und genau das ist der Fehler.
     * \`overflow: hidden\` gilt auch nicht als Entschuldigung — dann ist der
     * Inhalt dauerhaft unerreichbar.
     */
    const schmueckend = (el) => {
      for (let p = el; p; p = p.parentElement) if (p.getAttribute && p.getAttribute('aria-hidden') === 'true') return true
      return false
    }
    const beschnitten = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p === de || p === d.body || p.classList.contains('viewport')) return false
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll') return true
        // Hart beschnitten ist nur dann in Ordnung, wenn der Inhalt Schmuck
        // ist: die Gartenszene darf am Rand auslaufen, eine Schaltflaeche
        // nicht. Was aria-hidden traegt, sagt selbst, dass es nichts bedeutet.
        if (ox === 'hidden' && schmueckend(el)) return true
      }
      return false
    }
    d.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect()
      if (r.right > de.clientWidth + 0.5 && !beschnitten(el)) {
        wide.push(el.tagName + '.' + (el.className || '?'))
      }
    })
    const geladen = Boolean(bar)
    zeile = [
      'BREITE $W',
      'ueberlaufX=' + (de.scrollWidth - de.clientWidth),
      'shellH=' + (shell ? Math.round(shell.getBoundingClientRect().height) : '-'),
      'tabbarUnten=' + (bar ? Math.round(bar.getBoundingClientRect().bottom) : 'FEHLT'),
      !geladen ? 'NICHT_GELADEN' : wide.length ? 'ZU_BREIT[' + wide.slice(0,5).join(',') + ']' : 'ok',
    ].join(' ')
  } catch (e) { zeile = 'BREITE $W unlesbar: ' + e.message }
  document.title = 'CHECK ' + zeile
}, 7000)
</script>
EOF
docker cp "$TMP/check.html" telegram-pokemon:/app/packages/api/public/__check.html >/dev/null
docker run --rm --network bridge --entrypoint /usr/bin/chromium-browser poke-shot:latest \
  --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --window-size=900,900 --virtual-time-budget=20000 --dump-dom \
  "http://${HOST}/__check.html" 2>/dev/null \
  | grep -o '<title>[^<]*</title>' | sed 's/<\/\?title>//g; s/^CHECK //'
done
docker exec -u root telegram-pokemon rm -f /app/packages/api/public/__check.html 2>/dev/null || true

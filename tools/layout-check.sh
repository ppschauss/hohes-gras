#!/bin/bash
# Prueft das Layout bei echten Telefonbreiten — durch Messen, nicht durch
# Ansehen. Meldet horizontalen Ueberlauf und Elemente, die unter die
# Bildschirmkante rutschen.
#
# Nutzung: ./tools/layout-check.sh [pfad-in-der-app]
set -e
cd "$(dirname "$0")/.."

PATH_IN_APP="${1:-/__preview.html}"
HOST="${PREVIEW_HOST:-172.17.0.1:3010}"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/check.html" <<EOF
<!doctype html><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block}</style>
<div id="frames"></div>
<script>
const WIDTHS = [360, 390, 430]
const HEIGHT = 844
const box = document.getElementById('frames')
WIDTHS.forEach(w => {
  const f = document.createElement('iframe')
  f.width = w; f.height = HEIGHT; f.dataset.w = w
  f.src = 'http://${HOST}${PATH_IN_APP}'
  box.appendChild(f)
})
setTimeout(() => {
  const out = []
  document.querySelectorAll('iframe').forEach(f => {
    const w = f.dataset.w
    try {
      const d = f.contentDocument
      const de = d.documentElement
      const overflowX = de.scrollWidth - de.clientWidth
      const shell = d.querySelector('.shell')
      const bar = d.querySelector('.tabbar')
      const wide = []
      d.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect()
        // journey__sun ragt absichtlich heraus und wird vom Container beschnitten.
        if (r.right > de.clientWidth + 0.5 && !el.className.toString().includes('__sun')) {
          wide.push(el.tagName + '.' + (el.className || '?'))
        }
      })
      out.push([
        'BREITE ' + w,
        'ueberlaufX=' + overflowX,
        'shellH=' + (shell ? Math.round(shell.getBoundingClientRect().height) : '-'),
        'tabbarUnten=' + (bar ? Math.round(bar.getBoundingClientRect().bottom) : 'FEHLT'),
        'viewportH=' + de.clientHeight,
        wide.length ? 'ZU_BREIT[' + wide.slice(0,5).join(',') + ']' : 'ok'
      ].join(' '))
    } catch (e) { out.push('BREITE ' + w + ' unlesbar: ' + e.message) }
  })
  document.title = 'CHECK :: ' + out.join(' :: ')
}, 3000)
</script>
EOF

docker cp "$TMP/check.html" telegram-pokemon:/app/packages/api/public/__check.html >/dev/null
docker run --rm --network bridge --entrypoint /usr/bin/chromium-browser poke-shot:latest \
  --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --window-size=1400,1000 --virtual-time-budget=7000 --dump-dom \
  "http://${HOST}/__check.html" 2>/dev/null \
  | grep -o '<title>[^<]*</title>' | sed 's/<\/\?title>//g' | tr ':' '\n' | grep -v '^$' | sed 's/^ //'

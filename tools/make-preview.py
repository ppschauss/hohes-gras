#!/usr/bin/env python3
"""Erzeugt __preview.html: die echte Mini-App mit gestubbter Telegram-Bruecke.

Der Stub meldet viewportStableHeight dynamisch als window.innerHeight. Eine
feste Zahl waere hier falsch: headless-chromium zieht von --window-size die
Fensterrahmenhoehe ab, und die App wuerde dann hoeher layouten als gemalt wird.
"""
import json, os, re, sys

APP = '/mnt/cache/appdata/telegram-pokemon/build/app/packages/api/public'
init = sys.argv[1] if len(sys.argv) > 1 else ''
# NIEMALS in den Quellbaum schreiben: die Datei enthaelt ein gueltig
# signiertes initData und wuerde als offene Hintertuer ins Image wandern.
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/__preview.html'

# Die Seite muss aus dem *laufenden* Container kommen.
#
# Im Quellbaum liegt das Ergebnis des letzten Host-Builds; der Container baut
# sein eigenes und vergibt andere Hashnamen. Wer die Datei vom Host nimmt,
# verweist auf Dateien, die es unter dieser Adresse nicht gibt — und bekommt
# eine weisse Seite ohne jede Fehlermeldung.
HOST = os.environ.get('PREVIEW_HOST', '172.17.0.1:3010')
try:
    import urllib.request
    idx = urllib.request.urlopen(f'http://{HOST}/', timeout=5).read().decode()
except Exception:
    idx = open(os.path.join(APP, 'index.html')).read()
tags = "".join(re.findall(
    r'<(?:script|link)[^>]*(?:src|href)="/assets/[^"]+"[^>]*>(?:</script>)?', idx
)).replace('crossorigin', '')

html = f"""<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vorschau</title>
<script>
window.Telegram = {{ WebApp: {{
  initData: {json.dumps(init)},
  initDataUnsafe: {{ user: {{ id: 424242, first_name: 'Patrick' }} }},
  version: '7.0', platform: 'android', colorScheme: 'dark', themeParams: {{}},
  isExpanded: true,
  get viewportStableHeight() {{ return window.innerHeight }},
  ready() {{}}, expand() {{}}, close() {{}}, disableVerticalSwipes() {{}},
  onEvent(name, fn) {{ if (name === 'viewportChanged') addEventListener('resize', fn) }},
  HapticFeedback: {{ impactOccurred() {{}}, notificationOccurred() {{}}, selectionChanged() {{}} }}
}}}}
</script>
{tags}
</head><body><div id="root"></div></body></html>"""
open(out, 'w').write(html)
print(f'__preview.html erzeugt ({len(tags)} Bytes Asset-Tags)')

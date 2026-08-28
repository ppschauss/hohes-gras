#!/usr/bin/env python3
"""Prueft, ob jeder im Code verwendete Uebersetzungsschluessel im Katalog steht.

Statische Aufrufe werden exakt geprueft, dynamische (`t(`weather.${x}`)`) nur
auf Praefix-Abdeckung — mehr geht ohne Ausfuehrung des Codes nicht, und ein
Praefix ohne einen einzigen Eintrag ist der Fehler, der wirklich vorkommt.
"""
import json, os, re, sys

SRC = '/mnt/cache/appdata/telegram-pokemon/build/app/packages/web/src'
catalog = json.load(open(os.path.join(SRC, 'i18n/de.json')))

static = re.compile(r"""\bt\(\s*['"]([^'"]+)['"]""")
template = re.compile(r"\bt\(\s*`([^`]*)`")

used, prefixes = set(), set()
for root, _, files in os.walk(SRC):
    for name in files:
        if not name.endswith(('.ts', '.tsx')):
            continue
        src = open(os.path.join(root, name)).read()
        used.update(static.findall(src))
        for literal in template.findall(src):
            (prefixes if '${' in literal else used).add(
                literal.split('${')[0] if '${' in literal else literal)

# Jeder Grund, den der Server nennt, braucht einen Text.
#
# Der Server schickt `invalid_state` plus einen `reason`; die App sucht erst
# `error.invalid_state.<grund>`, dann `error.<grund>`. Findet sie keinen von
# beiden, liest der Spieler "Das geht gerade nicht" — genau das ist mehrfach
# gemeldet worden. Diese Pruefung faengt den naechsten neuen Grund ab.
API = '/mnt/cache/appdata/telegram-pokemon/build/app/packages/api/src'
INTERN = {'bad_signature', 'missing_hash', 'malformed', 'unknown', 'no_user'}
reasons = set()
for root, _, files in os.walk(API):
    for name in files:
        if name.endswith('.ts') and not name.endswith('.d.ts'):
            reasons.update(re.findall(r"reason: '([a-z_]+)'", open(os.path.join(root, name)).read()))
speechless = sorted(
    r for r in reasons - INTERN
    if f'error.{r}' not in catalog and not any(k.endswith(f'.{r}') and k.startswith('error.') for k in catalog)
)

missing = sorted(k for k in used if k not in catalog)
gaps = sorted(p for p in prefixes if p and not any(k.startswith(p) for k in catalog))

print(f'Katalog: {len(catalog)} Schluessel · verwendet: {len(used)} · dynamisch: {len(prefixes)} '
      f'· Fehlergruende: {len(reasons)}')
for key in missing:
    print(f'  FEHLT: {key}')
for gap in gaps:
    print(f'  PRAEFIX OHNE EINTRAG: {gap}')
for reason in speechless:
    print(f'  GRUND OHNE TEXT: {reason}')
if not missing and not gaps and not speechless:
    print('✓ Vollstaendig')
sys.exit(1 if missing or gaps or speechless else 0)

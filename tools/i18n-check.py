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
# Derselbe Aufruf, aber mit dem Argument dahinter — fuer die Platzhalterpruefung.
with_vars = re.compile(r"""\bt\(\s*['"]([^'"]+)['"]\s*,\s*\{([^{}]*)\}""")
template = re.compile(r"\bt\(\s*`([^`]*)`")

def arg_names(args: str):
    """Welche Platzhalter ein `t`-Aufruf uebergibt.

    Beide Schreibweisen zaehlen: `{ n: 3 }` und die Kurzform `{ time }` — die
    erste Fassung kannte nur die lange und meldete jeden verkuerzten Aufruf
    faelschlich als Fehler.

    Bei einem Spread (`{ ...vars }`) laesst sich nichts sagen; solche Aufrufe
    werden uebersprungen statt geraten.
    """
    if '...' in args:
        return None
    namen = set()
    for teil in args.split(','):
        teil = teil.strip()
        if not teil:
            continue
        kopf = teil.split(':', 1)[0].strip()
        if re.fullmatch(r'\w+', kopf):
            namen.add(kopf)
    return namen


used, prefixes = set(), set()
# Aufrufstelle -> uebergebene Platzhalternamen.
calls: list[tuple[str, set[str], str]] = []
for root, _, files in os.walk(SRC):
    for name in files:
        if not name.endswith(('.ts', '.tsx')):
            continue
        src = open(os.path.join(root, name)).read()
        used.update(static.findall(src))
        for key, args in with_vars.findall(src):
            namen = arg_names(args)
            if namen is not None:
                calls.append((key, namen, name))
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

# Jede Kapitelbedingung braucht einen Text.
#
# Die Bedingungen stehen als Aufzaehlung im Schema; die Oberflaeche schlaegt
# sie unter `story.req.<art>` nach. Fehlt einer, steht im Spiel der Schluessel
# selbst — genau so gemeldet: "story.req.regionDexCaught".
schema = open('/mnt/cache/appdata/telegram-pokemon/build/app/packages/content/src/schema.ts').read()
block = re.search(r"ChapterConditionSchema = z\.object\(\{.*?kind: z\.enum\(\[(.*?)\]\)", schema, re.S)
condition_kinds = re.findall(r"'([a-zA-Z]+)'", block.group(1)) if block else []
speechless_reqs = sorted(k for k in condition_kinds if f'story.req.{k}' not in catalog)

# Passen die Platzhalter zum Text?
#
# Der Fehler, den das faengt: ein vorhandener Schluessel wird mit anderer
# Bedeutung ueberschrieben. `expedition.slots` hiess "{n} unterwegs" und wurde
# zu "Plaetze: {have}/{max}" — die alte Aufrufstelle uebergab weiter `n`, und
# im Spiel stand woertlich "Plaetze: {have}/{max}". Genau so gemeldet.
platzhalter = []
for key, namen, datei in calls:
    text = catalog.get(key)
    if text is None:
        continue  # fehlender Schluessel wird schon anderswo gemeldet
    erwartet = set(re.findall(r'\{(\w+)\}', text))
    fehlend = erwartet - namen
    if fehlend:
        platzhalter.append((key, sorted(fehlend), datei))

missing = sorted(k for k in used if k not in catalog)
gaps = sorted(p for p in prefixes if p and not any(k.startswith(p) for k in catalog))

print(f'Katalog: {len(catalog)} Schluessel · verwendet: {len(used)} · dynamisch: {len(prefixes)} '
      f'· Fehlergruende: {len(reasons)} · Kapitelbedingungen: {len(condition_kinds)}')
for key in missing:
    print(f'  FEHLT: {key}')
for gap in gaps:
    print(f'  PRAEFIX OHNE EINTRAG: {gap}')
for reason in speechless:
    print(f'  GRUND OHNE TEXT: {reason}')
for kind in speechless_reqs:
    print(f'  KAPITELBEDINGUNG OHNE TEXT: {kind}')
for key, fehlend, datei in platzhalter:
    print(f'  PLATZHALTER FEHLT: {key} braucht {{{"}, {".join(fehlend)}}} — {datei}')
if not missing and not gaps and not speechless and not speechless_reqs and not platzhalter:
    print('✓ Vollstaendig')
sys.exit(1 if missing or gaps or speechless or speechless_reqs or platzhalter else 0)

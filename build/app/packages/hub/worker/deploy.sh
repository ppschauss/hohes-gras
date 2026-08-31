#!/bin/bash
# Den Verbund-Dienst auf Cloudflare ausrollen.
#
# Einmalig. Danach genuegt `npm run hub:deploy -w @game/hub` fuer neue Staende.
#
# Voraussetzung: ein Cloudflare-API-Token mit den Rechten
#   Account · Workers Scripts · Edit
#   Account · D1 · Edit
# als CLOUDFLARE_API_TOKEN in der Umgebung. Das Token wird nirgends abgelegt.
#
# Was hier passiert, steht Schritt fuer Schritt in docs/VERBUND.md.
set -euo pipefail
cd "$(dirname "$0")/.."          # -> packages/hub
DB=hohes-gras-verbund
CFG=worker/wrangler.toml
INSTANCE="${HUB_INSTANCE_ID:-isekai}"
SECRETS="$(cd ../../../.. && pwd)/secrets.env"   # <appdata>/telegram-pokemon/secrets.env

# Das Token darf nirgends auf einer Kommandozeile stehen — die landet im
# Verlauf und in `ps`. Es kommt deshalb aus `secrets.env` (chmod 600,
# gitignored), oder aus der Umgebung, wenn es dort schon steht.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$SECRETS" ]; then
  # `|| true`: findet grep nichts, ist das kein Fehler, sondern der Normalfall
  # vor der Einrichtung. Ohne das bricht `set -e` hier ab — und zwar *bevor*
  # die Meldung erscheint, die erklaert, was zu tun ist.
  CLOUDFLARE_API_TOKEN=$(grep -E '^CLOUDFLARE_API_TOKEN=' "$SECRETS" | head -1 | cut -d= -f2- || true)
  export CLOUDFLARE_API_TOKEN
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN fehlt." >&2
  echo "Trag es in secrets.env ein:  CLOUDFLARE_API_TOKEN=dein_token" >&2
  echo "Nötige Rechte: Account · Workers Scripts · Edit  und  Account · D1 · Edit" >&2
  exit 1
fi
wrangler() { npx --yes wrangler "$@"; }

# --- 1. Datenbank ----------------------------------------------------------
# Idempotent: gibt es sie schon, wird die vorhandene Id genommen. Ein zweiter
# Lauf darf niemals eine zweite, leere Datenbank danebenstellen.
echo "== D1"
# Die Id aus der Liste holen und nicht aus `d1 info`: die Liste hat ueber die
# Wrangler-Versionen dieselbe Form, `info` nicht.
db_id() {
  wrangler d1 list --json 2>/dev/null | node -e '
    let s = ""
    process.stdin.on("data", (d) => s += d).on("end", () => {
      let rows = []
      try { rows = JSON.parse(s) } catch { process.exit(0) }
      if (!Array.isArray(rows)) rows = rows.result ?? []
      const hit = rows.find((r) => r.name === process.argv[1])
      if (hit) console.log(hit.uuid ?? hit.database_id ?? "")
    })' "$DB"
}
# `|| true` an jeder Zuweisung: eine leere Datenbankliste ist kein Fehler,
# sondern der Normalfall beim ersten Lauf. Ohne das bricht `set -o pipefail`
# zusammen mit `set -e` genau hier ab — und zwar wortlos.
DB_ID=$(db_id || true)
if [ -n "$DB_ID" ]; then
  echo "   vorhanden"
else
  wrangler d1 create "$DB" >/dev/null
  DB_ID=$(db_id || true)
  echo "   angelegt"
fi
[ -n "$DB_ID" ] || { echo "Keine database_id ermittelt — 'npx wrangler d1 list' von Hand pruefen." >&2; exit 1; }
# In die Konfiguration eintragen, damit `hub:deploy` spaeter ohne Umweg geht.
node -e '
  const fs = require("fs"), p = process.argv[1], id = process.argv[2]
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/database_id = "[^"]*"/, `database_id = "${id}"`))
' "$CFG" "$DB_ID"
echo "   database_id eingetragen"

# --- 2. Schema -------------------------------------------------------------
# CREATE TABLE IF NOT EXISTS: ein zweiter Lauf aendert nichts.
echo "== Schema"
wrangler d1 execute "$DB" --remote --file worker/schema.sql -c "$CFG" --yes >/dev/null
echo "   angewandt"

# --- 3. Geheimnisse --------------------------------------------------------
# ID_SALT darf sich nie aendern: es steckt in jeder globalen Trainer-Id. Neu
# gesetzt bekaemen alle Spieler neue Ids und die Rangliste faenge bei null an.
echo "== Geheimnisse"
gen() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
if wrangler secret list -c "$CFG" 2>/dev/null | grep -q ID_SALT 2>/dev/null; then
  echo "   ID_SALT steht schon — bleibt unangetastet"
else
  gen | wrangler secret put ID_SALT -c "$CFG" >/dev/null
  echo "   ID_SALT gesetzt"
fi
ADMIN_SECRET=$(gen)
printf '%s' "$ADMIN_SECRET" | wrangler secret put ADMIN_SECRET -c "$CFG" >/dev/null
echo "   ADMIN_SECRET gesetzt"

# --- 4. Worker -------------------------------------------------------------
echo "== Worker"
URL=$(wrangler deploy -c "$CFG" 2>&1 | tee /dev/stderr | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1 || true)
[ -n "$URL" ] || { echo "Keine Worker-URL in der Ausgabe gefunden." >&2; exit 1; }

# --- 5. Was wir schon wissen, sofort sichern ---------------------------------
# Vor der Anmeldung und nicht danach: das ADMIN_SECRET existiert ab jetzt nur
# noch auf dem Worker und in dieser Variablen. Bricht der naechste Schritt ab
# — und er bricht ab, solange das Zertifikat der frischen workers.dev-Subdomain
# fehlt —, waere es sonst verloren und muesste neu gesetzt werden.
setenv() {
  node -e '
    const fs = require("fs")
    const [p, k, v] = process.argv.slice(1)
    let s = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
    const re = new RegExp(`^${k}=.*$`, "m")
    s = re.test(s) ? s.replace(re, `${k}=${v}`) : s.replace(/\s*$/, `\n${k}=${v}\n`)
    fs.writeFileSync(p, s)
  ' "$SECRETS" "$1" "$2"
}
setenv HUB_URL "$URL"
setenv HUB_INSTANCE_ID "$INSTANCE"
setenv HUB_ADMIN_SECRET "$ADMIN_SECRET"
chmod 600 "$SECRETS"
echo "== Gesichert"
echo "   HUB_URL, HUB_INSTANCE_ID und HUB_ADMIN_SECRET stehen in secrets.env"

# --- 6. Diese Instanz anmelden ----------------------------------------------
# Mit Geduld: eine neu angelegte workers.dev-Subdomain bekommt ihr Zertifikat
# erst nach ein paar Minuten. Bis dahin scheitert schon der TLS-Handschlag.
echo "== Instanz anmelden"
RESP=""
for versuch in $(seq 1 30); do
  RESP=$(curl -sS -X POST "$URL/instances" -H 'content-type: application/json' \
    -H "x-hub-admin: $ADMIN_SECRET" \
    -d "{\"id\":\"$INSTANCE\",\"name\":\"Hohes Gras\"}" 2>/dev/null || true)
  case "$RESP" in
    *'"secret"'*) break ;;
    *'already_registered'*)
      echo "   Instanz gibt es schon. Das Geheimnis wird nur einmal ausgegeben —" >&2
      echo "   entweder steht es noch in secrets.env, oder waehle eine andere" >&2
      echo "   HUB_INSTANCE_ID und starte neu." >&2
      exit 1 ;;
  esac
  [ "$versuch" = 1 ] && echo "   noch nicht erreichbar (Zertifikat), warte..."
  sleep 20
done

HUB_SECRET=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j; try { j = JSON.parse(s) } catch { console.error("Keine Antwort vom Verbund."); process.exit(1) }
  if (!j.secret) { console.error("Anmeldung fehlgeschlagen:", JSON.stringify(j)); process.exit(1) }
  console.log(j.secret)})' <<<"$RESP")

setenv HUB_SECRET "$HUB_SECRET"
chmod 600 "$SECRETS"

echo
echo "Fertig. Verbund laeuft unter $URL"
echo "HUB_URL, HUB_INSTANCE_ID und HUB_SECRET stehen in secrets.env."
echo "Jetzt noch:  ./manage.sh up      (nicht restart — das liest die env-file nicht neu)"

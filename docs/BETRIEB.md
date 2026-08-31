# Betrieb

Läuft als ein Container auf Unraid, nach den Konventionen des Hauses:
`manage.sh` statt compose-Plugin, Secrets in einer gitignorierten Datei,
Appdata-Ordner je Dienst.

## Erste Einrichtung

```bash
cp secrets.env.example secrets.env
chmod 600 secrets.env
$EDITOR secrets.env            # BOT_TOKEN und SESSION_SECRET eintragen
./manage.sh rebuild
```

`SESSION_SECRET` erzeugen:

```bash
head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 64
```

Content-Pack einmalig importieren (braucht Netz, dauert Minuten):

```bash
cd build/app && npm ci && npm run import:full     # Dex 1–386, alle drei Regionen
```

## Tägliche Handgriffe

```bash
./manage.sh rebuild    # bauen und neu starten
./manage.sh logs       # mitlesen
./manage.sh health     # Container + API prüfen
./manage.sh backup     # Datenbank nach data/backups/
./manage.sh shell      # in den Container
```

Der Scheduler im Container sichert die Datenbank ohnehin nächtlich nach
`data/backups/`.

## Öffentlich erreichbar

Cloudflare-Tunnel auf `poke.otakupulse.de` → `http://172.17.0.1:3010`.

Der Bot selbst läuft im **Long-Polling** und braucht keinen eingehenden Port.
Nur die Mini-App muss über HTTPS erreichbar sein — Telegram akzeptiert nichts
anderes.

Details und die BotFather-Schritte stehen in `SETUP-EXTERN.md`.

## Cache-Header — ein Fallstrick, der einmal zugeschlagen hat

`index.html` wird mit `no-cache` ausgeliefert, alles unter `/assets/` mit einem
Jahr und `immutable`.

Das ist keine Feinjustierung, sondern der Unterschied zwischen „Deploy sichtbar"
und „Deploy unsichtbar". Die Dateien unter `/assets/` tragen einen Inhalts-Hash
im Namen; ändert sich der Inhalt, ändert sich der Name. `index.html` trägt
keinen — sie ist die Datei, die auf die aktuellen Hashes zeigt. Mit einer
Stunde Cache darauf lud Telegrams WebView nach einem Deploy weiter die alte
App und fand die darin genannten Dateien teilweise gar nicht mehr.

## Nach einem Deploy

Telegram cacht hartnäckig. Wenn eine Änderung nicht ankommt: **App komplett
schließen und neu öffnen.**

## Datenbank

SQLite mit WAL unter `data/game.db`. Migrationen laufen beim Start.

Direkt hineinsehen:

```bash
docker exec telegram-pokemon node -e "
  const D=require('better-sqlite3'); const db=new D('/data/game.db',{readonly:true});
  console.log(db.prepare('SELECT display_name, gold, energy FROM trainers').all());
"
```

**Vor schreibenden Eingriffen `./manage.sh backup`.** Die Datenbank enthält
Spielstände von echten Menschen, nicht nur eigene.

## Zugang

Offen: wer den Bot findet, spielt. Früher stand hier eine
Einladungsschranke — sie ist raus, weil sie genau den Kreis klein gehalten hat,
den sie schützen sollte, und die Arbeit bei dem lag, der einladen wollte.

Admin bleibt geregelt: der allererste Trainer wird es automatisch, dazu wer in
`secrets.env` als `ADMIN_TELEGRAM_ID` steht.

Wer den Zugang wirklich beschränken will, tut das eine Ebene tiefer — der
Cloudflare-Tunnel steht davor.

## Bot-Befehle

Für alle:

| Befehl | Wirkung |
|---|---|
| `/spielen` | öffnet die Mini-App |
| `/karte` | teilt die Trainerkarte |
| `/code` | zeigt den eigenen Trainer-Code |
| `/browser` | Einmalcode für die Anmeldung im Browser (5 Minuten gültig) |
| `/hilfe` | Übersicht; zeigt Admins zusätzlich ihre Befehle |
| `/gilde` | verbindet einen Gruppenchat mit der eigenen Gilde |
| `/raid` | zeigt laufende Raids in diesem Chat |

Nur für Admins:

| Befehl | Wirkung |
|---|---|
| `/event <Trainer-Code> [Art]` | Ereignis-Wesen vergeben |
| `/gegenstand <Trainer-Code> <Gegenstand-Id> [Anzahl]` | Gegenstände vergeben |

Beispiel: `/gegenstand ABCD1234 lure-legendary 250`. Der erste Trainer wird
automatisch Admin.

## Prüfen vor dem Ausrollen

```bash
cd build/app
npm test                                  # Engine + API, 965 Tests
npx tsc --noEmit -p packages/api
npm run build -w @game/web                # deckt die Mini-App ab; `tsc -b` tut es nicht
cd .. && python3 tools/i18n-check.py      # keine fehlenden Übersetzungen
npm run simulate -- --days 400            # Balancing-Kurven
```

Für die Oberfläche:

```bash
./tools/layout-check.sh /__preview.html#garden   # misst auf 360/390/430
./tools/preview.sh /tmp/shot.png 900 /__preview.html
```

`tools/make-preview.py` erzeugt dafür eine Seite mit **gültig signiertem
initData**. Diese Datei gehört niemals in den Quellbaum oder ins Image — sie
wird nach `/tmp` geschrieben, per `docker cp` eingeschleust und nach dem Test
wieder gelöscht. Wer sie liegen lässt, hat eine offene Hintertür ins Konto
veröffentlicht.


## Verbund einschalten (optional)

Standardmäßig aus. Solange `HUB_URL`, `HUB_INSTANCE_ID` und `HUB_SECRET` in
`secrets.env` leer sind, verhält sich die Instanz exakt wie ohne Verbund —
keine Anfrage geht hinaus.

Zum Einschalten den Dienst ausrollen und die Instanz anmelden; beides steht
Schritt für Schritt in [VERBUND.md](VERBUND.md) unter „Den Dienst ausrollen".
Danach die drei Werte eintragen und `./manage.sh restart`. Der Job `hub-sync`
läuft alle zehn Minuten und meldet sich im Log:

```
./manage.sh logs | grep Verbund
[job] Verbund: 4 angemeldet, 4 Profile, 4 in der Rangliste
```

Bleibt es still, ist der Verbund nicht erreichbar — das ist kein Fehler des
Spiels, und es bricht auch nichts. `[hub] ... nicht erreichbar` im Log sagt,
woran es lag.

**Ausschalten** heißt: die drei Werte wieder leeren und neu starten. Die
Tabellen `hub_links` und `hub_cache` können bleiben oder gelöscht werden; das
Spiel hängt an keiner von beiden.


## Aktualisieren

Ohne Verbund von Hand:

```bash
./manage.sh update
```

Das sichert die Datenbank, holt den neuen Stand, baut neu und prüft danach, ob
der Dienst antwortet — sonst kehrt es zum alten Stand zurück und spielt die
Datenbank ein.

**Mit Verbund** kommt eine Telegram-Nachricht, sobald ein neuer Stand
veröffentlicht wurde, und in der App steht unter *Einstellungen → Konto & Daten* ein
Knopf. Damit der etwas bewirkt, muss auf dem Wirt der Wächter laufen:

```bash
nohup ./manage.sh watch >> ./data/update.log 2>&1 &
```

Auf Unraid gehört das in ein User-Script mit „At Startup of Array".

Der Knopf in der App baut **nichts** — er legt nur `data/update-requested` ab.
Das ist Absicht: ein Container, der sich selbst neu bauen darf, braucht den
Docker-Socket und damit Zugriff auf alles auf der Maschine. Läuft kein Wächter,
passiert nichts, und man aktualisiert wie oben von Hand.


## Sicherheitsprüfung

Zuletzt geprüft am 31.08.2026, gegen die laufende Installation.

**Gefunden und behoben**

- **`@fastify/static` 8.3.0** hatte vier bekannte Lücken, darunter
  Path-Traversal und die Umgehung von Routen-Schutz — ausgerechnet das Paket,
  das die Mini-App ausliefert. Auf 10.1.3 gehoben. Der Sprung ändert die
  Signatur von `setHeaders`: dort kommt jetzt die Fastify-Antwort statt der
  rohen Node-Antwort, also `header()` statt `setHeader()`. Beide Cache-Regeln
  danach nachgemessen.
- **`trustProxy: true`** glaubte `X-Forwarded-For` von *jedem*. Port 3010 liegt
  im LAN offen, also hätte dort jeder eine beliebige Adresse behaupten und die
  Ratenbegrenzung umgehen können. Jetzt gilt das Vertrauen nur den privaten
  Netzen, durch die Tunnel und Proxy tatsächlich sprechen.
- **Zwei Admin-Routen ohne Prüfung** (`/api/admin/release`, `/api/admin/update`)
  — beim Bau des Updaters entstanden, vor der Auslieferung geschlossen. Jeder
  Spieler hätte die Installation neu bauen lassen können.

**Geprüft, ohne Befund**

| Bereich | Ergebnis |
|---|---|
| SQL-Injektion | Alle eingesetzten Bezeichner stammen aus festen Literallisten |
| Fremdzugriff | 11 Angriffe über zwei echte Konten, alle abgewehrt (403/404) |
| Admin-Wege | Alle fünf prüfen über `requireAdmin` im Dienst |
| `initData` | HMAC-SHA256, zeitkonstanter Vergleich, 24-h-Fenster, 18 Tests |
| Sitzungen | 32 Zufallsbytes, nur gehasht gespeichert (HMAC) |
| Verbund | Alle sechs Endpunkte ohne Berechtigung: 401 |
| Geheimnisse | Weder in Antworten noch in Protokollen |
| XSS | Kein `dangerouslySetInnerHTML`, kein `eval` |
| Container | Läuft als `poke` (uid 1001), nicht als root |
| Path-Traversal | Sieben Varianten; die zwei mit 200 liefern die SPA-Rückfallseite |
| Abhängigkeiten | `npm audit --omit=dev`: 0 Lücken |

**Bewusst offen**

- **Port 3010 liegt auf dem LAN offen.** Die Anmeldung schützt die API, aber
  die Angriffsfläche ist größer als nötig. Wer das enger will, bindet den Port
  an `127.0.0.1` und lässt Tunnel und Proxy über das Docker-Netz sprechen.
- **Offene Registrierung.** Seit die Einladungscodes weg sind, darf jeder
  mitspielen, der den Bot findet — das ist Absicht. Eine Flut ist damit
  trotzdem nicht möglich: jede Anmeldung braucht ein von Telegram signiertes
  `initData`, also ein echtes Telegram-Konto.
- **Der Verbund kann Instanzen zum Update *drängen***, indem er einen Stand als
  aktuell nennt. Auslösen kann er nichts: es braucht immer einen Admin-Klick,
  und was geholt wird, bestimmt das Git-Remote der Instanz.

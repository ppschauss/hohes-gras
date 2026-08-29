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
cd build/app && npm ci && npm run import -- --dex 1-251
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

Einladungsbasiert. Der allererste Trainer wird automatisch Admin; danach
erzeugt der Admin Codes per Bot-Kommando `/einladen`. Ohne Code kein Konto.

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
| `/einladen [n]` | Einladungscode, bis 50 Nutzungen, 30 Tage gültig |
| `/codes` | offene Einladungen |
| `/event <Trainer-Code> [Art]` | Ereignis-Wesen vergeben |
| `/gegenstand <Trainer-Code> <Gegenstand-Id> [Anzahl]` | Gegenstände vergeben |

Beispiel: `/gegenstand ABCD1234 lure-legendary 250`. Der erste Trainer wird
automatisch Admin.

## Prüfen vor dem Ausrollen

```bash
cd build/app
npm test                                  # Engine + API, 861 Tests
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

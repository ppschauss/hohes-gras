<p align="center">
  <img src="brand/bot-avatar.png" width="120" alt="">
</p>

<h1 align="center">Hohes Gras</h1>

<p align="center">
  Ein Kreaturen-Sammelspiel als Telegram Mini-App.<br>
  Deutschsprachig, einladungsbasiert, selbst gehostet.
</p>

---

Fang Gefährten, zieh sie in deinem Garten groß und schick sie auf Expedition,
während du weg bist. **Drei Regionen, 38 Gebiete, 387 Arten**, echte
Rundenkämpfe mit Typentabelle, 26 Arenaorden, Top Vier je Region, Gilden-Raids
im Gruppenchat, Marktplatz und Tausch unter Freunden.

**Keine Tageslimits.** Was du an einem Tag schaffst, entscheidest du über deine
Energie — und die füllt sich, auch wenn du nicht da bist.

## Schnellstart

```bash
cp secrets.env.example secrets.env && chmod 600 secrets.env
$EDITOR secrets.env          # BOT_TOKEN von @BotFather, SESSION_SECRET
./manage.sh rebuild
./manage.sh health
```

Content-Pack einmalig importieren:

```bash
cd build/app && npm ci && npm run import -- --dex 1-251
```

Ausführlich in **[docs/BETRIEB.md](docs/BETRIEB.md)**, öffentlich erreichbar
machen in **[SETUP-EXTERN.md](SETUP-EXTERN.md)**.

## Was drin ist

| Bereich | Inhalt |
|---|---|
| **Garten** | Team bis 5, vier Pflegeaktionen, EP + Freundschaft + Ausdauer, Box, Pokédex, Hintergründe |
| **Teams** | Bis zu 8 gespeicherte Aufstellungen, eine davon aktiv |
| **Attacken** | Vier Plätze je Pokémon, frei wählbar; die Automatik füllt nur leere Plätze |
| **Energie** | Statt Tageslimits: 2 Punkte/Minute, für Gold nachkaufbar, Vorrat bis 510 ausbaubar; über 1.000 wird sie zu Gold |
| **Box** | 900 Plätze, mit dem Depot in 25 Stufen auf 2.150; Verwerten einzeln oder bis zu 50 auf einmal |
| **Seelenfragmente** | Je Typ des verwerteten Pokémon eines; 15 → Ei, 85 → schillerndes Ei, 5 schillernde Fragmente → schillerndes Ei |
| **Welt** | 3 Regionen, 38 Gebiete inkl. Nachliga, freie Startregion mit eigenen Startern, Wetter und Tageszeit steuern Spawns |
| **Freischaltung** | Gebiete über Pokédex-Einträge, Regionen über Top Vier und Champion der vorherigen |
| **Skalierung** | Ganze Regionen treffen den Teammedian — nach oben wie nach unten, abschaltbar |
| **Reisegrenze** | Level 100 zum Start, +50 je bezwungener Region, absolutes Ende bei 500 |
| **Safari** | Ball- und Beerenwahl, Schwächen/Beruhigen, Fangserie für Shiny-Jagd |
| **Kampf** | Typentabelle, Status, Stat-Stufen, Mehrfachtreffer, KI in vier Stufen, 26 Orden, Top Vier je Region |
| **Ereignisse** | Überfälle beim Erkunden: Gold, Gegenstände, Sagenbeeren, selten ein Pokémon mit makellosen Werten |
| **Legendäre** | 0,1 % Fundchance nach vollständig bezwungener Region; gefangen nur mit Sagenbeeren |
| **Lockdüfte** | Ein Duft je Typ, 50 Gold für 5 Erkundungen; vervierfacht das Gewicht des gesuchten Typs |
| **Fundstücke** | Jeder achte Fang bringt einen Werkstoff — das Bindeglied zwischen Erkunden und Werkbank |
| **Arena** | Trainingsmodus: 4 Kämpfe in Folge gegen den Typ des Tages, drei Stufen (−5/−3/−1 Level), 10 % Heilung zwischen den Kämpfen |
| **Poké-Center** | Alle 15 Minuten kostenlose Vollheilung, gelegentlich mit Fund, Geschenk oder Tauschangebot |
| **Poké-Beet** | Beeren, Bonbons oder Gold eingraben; Pflege oder ein Pflanzen-Pokémon heben den Ertrag |
| **Idle** | Expeditionen (4 Arten × 3 Dauern, bis 6 Pokémon), Ei-Zucht mit IV-Vererbung, 3 Brutplätze (ausbaubar auf 8) |
| **Sozial** | Freunde über Trainer-Code, teilbare Trainerkarte, Marktplatz, Direkttausch, Rangliste |
| **Koop** | Gilden mit Wochenziel, Raid-Bosse als Karte im Telegram-Gruppenchat, asynchrones PvP mit Elo, Wochenturnier |
| **Progression** | Entwicklungen, 10 Ausbauten, 19 Rezepte, Erfolgsketten, 12 Story-Kapitel |
| **Saison** | Eine Woche, 25 Stufen, 13 davon mit Gegenstand; die letzte bringt ein Schillerndes Seelenfragment |
| **Anmeldung** | 28 Tage mit unterschiedlichen Gaben; jede volle Woche zahlt Schillernde Seelenfragmente (1 · 2 · 3 · 5) |
| **Anmeldung** | Telegram-`initData`; für den Browser ein Einmalcode aus dem Chat, verbundene Geräte einzeln kündbar |
| **Designs** | 13 kaufbare Farbwelten plus Tag-/Nacht-Modus, der der Weltuhr folgt |
| **Fairness** | Taktkontrolle gegen Automatik-Klicker (Fenster, Mindestabstand, Rhythmuserkennung) und Tagesregeln je Gegner |
| **Konto** | Telegram-Erinnerungen (max. 1/Tag), DSGVO-Export und -Löschung, Admin-Panel |

## Aufbau

```
manage.sh              build|up|rebuild|down|restart|logs|health|shell|backup
docker-compose.yml     Spiegel von manage.sh (für Hosts mit compose-Plugin)
secrets.env            gitignored, chmod 600
brand/                 Bot-Avatar
docs/                  Architektur, Inhalt, Betrieb, Balance
build/Dockerfile       mehrstufig: Mini-App bauen, ins API-Image legen
build/app/             npm-Workspace-Monorepo
  packages/shared      Typen + zod-Schemas, von API und Web geteilt
  packages/content     Pack-Schema, Loader mit Querprüfung, Registry
  packages/engine      Spiellogik — rein, ohne I/O, mit injiziertem RNG
  packages/api         Fastify + SQLite + grammY-Bot + Scheduler
  packages/web         React/Vite Mini-App
  tools/               Import, Weltaufbau, Balancing-Simulation
data/                  game.db, packs/, media/, backups/   (gitignored)
tools/                 Screenshot, Layout-Prüfung, i18n-Prüfung
```

## Entwickeln

```bash
cd build/app
npm ci
npm test                                  # 861 Tests, Engine und API
npm run build -w @game/web                # Typprüfung der Mini-App (tsc -b deckt sie nicht ab)
npx tsc --noEmit -p packages/api
npm run world                             # Welt neu erzeugen, ohne Netz
npm run simulate -- --days 400            # Balancing-Kurven
```

Die Engine ist frei von I/O: das komplette Spiel lässt sich ohne Datenbank und
ohne Telegram durchrechnen. Warum das so gebaut ist, steht in
**[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)**.

## Dokumentation

- **[docs/FUNKTIONEN.md](docs/FUNKTIONEN.md)** — alle Funktionen ausführlich, mit Zahlen
- **[docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)** — wie die Teile geschnitten sind und warum
- **[docs/INHALT.md](docs/INHALT.md)** — Content-Pack, Pipeline, Rechtslage
- **[docs/BETRIEB.md](docs/BETRIEB.md)** — Einrichtung, Deploy, Datenbank, Fallstricke
- **[docs/BALANCE.md](docs/BALANCE.md)** — alle Stellschrauben mit Begründung
- **[SETUP-EXTERN.md](SETUP-EXTERN.md)** — Cloudflare-Tunnel und BotFather

## Rechtliches

Der Code steht unter keiner Lizenz zur Weiterverwendung — es ist ein privates
Projekt.

**Das Content-Pack ist nicht Teil dieses Repositorys.** Arten, Attacken,
Sprites und Regionen stammen aus dem Pokémon-Universum und sind geistiges
Eigentum von Nintendo / Game Freak / The Pokémon Company. Die Engine selbst
kennt keine Pokémon: sie lädt austauschbare Content-Packs. Betrieben wird
privat und nur mit Einladungscode. Details in
[docs/INHALT.md](docs/INHALT.md#rechtslage--zuerst-weil-es-den-rest-erklärt).

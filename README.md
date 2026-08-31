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
während du weg bist. **Drei Regionen, 38 Gebiete, 390 Arten**, echte
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

Content-Pack einmalig importieren — der Bereich muss zu den drei Regionen
passen, ein kleinerer Lauf überschreibt das Pack und nimmt Regionen mit:

```bash
cd build/app && npm ci && npm run import:full     # Dex 1–386, alle drei Regionen
```

Ausführlich in **[docs/BETRIEB.md](docs/BETRIEB.md)**, öffentlich erreichbar
machen in **[SETUP-EXTERN.md](SETUP-EXTERN.md)**.

## Was drin ist

| Bereich | Inhalt |
|---|---|
| **Garten** | Team bis 5, vier Pflegeaktionen, EP + Freundschaft + Ausdauer, Box, Pokédex, Hintergründe |
| **Teams** | Bis zu 8 gespeicherte Aufstellungen, eine davon aktiv; Reihenfolge per Doppeltipp |
| **Attacken** | Vier Plätze je Pokémon, frei wählbar; die Automatik füllt nur leere Plätze. Lernsätze aus **allen** Spielversionen zusammen (Ø 18,6 je Art), mit Hinweis auf die nächste Attacke |
| **Energie** | Statt Tageslimits: 2 Punkte/Minute, für Gold nachkaufbar, Vorrat bis 510 ausbaubar; über 1.000 wird sie zu Gold |
| **Box** | 900 Plätze, mit dem Depot in 25 Stufen auf 2.150; sortierbar nach Nummer, Name, Level, Typ oder schillernd; Verwerten einzeln oder bis zu 50 auf einmal. Eingelagerte erholen sich dreimal so schnell |
| **Seelenfragmente** | Je Typ des verwerteten Pokémon eines; 15 → Ei, 85 → schillerndes Ei, 5 schillernde Fragmente → schillerndes Ei |
| **Welt** | 3 Regionen, 38 Gebiete inkl. Nachliga, freie Startregion mit eigenen Startern, Wetter und Tageszeit steuern Spawns |
| **Freischaltung** | Gebiete über Pokédex-Einträge, Regionen über Top Vier und Champion der vorherigen |
| **Skalierung** | Eine Region empfängt einen **immer** auf dem eigenen Niveau — sonst wären die späteren gar nicht betretbar. Der Schalter regelt nur, ob die Gebiete danach mitwachsen |
| **Reisegrenze** | Level 100 zum Start, +50 je bezwungener Region, absolutes Ende bei 500 |
| **Safari** | Ball- und Beerenwahl, Schwächen/Beruhigen, Fangserie für Shiny-Jagd |
| **Kampf** | Typentabelle, Status, Stat-Stufen, Mehrfachtreffer, KI in vier Stufen, 26 Orden, Top Vier je Region |
| **Ereignisse** | Beim Erkunden: **Überfälle** (4 %) mit Gold, Sagenbeeren und selten einem Pokémon mit makellosen Werten, **Streuner** (3 %) mit höchstens zwei Pokémon, **Fundstücke** (3 %) |
| **Legendäre** | 0,1 % Fundchance nach vollständig bezwungener Region; gefangen nur mit Sagenbeeren |
| **Lockdüfte** | Ein Duft je Typ, 50 Gold für 5 Erkundungen; vervierfacht das Gewicht des gesuchten Typs |
| **Fundstücke** | Jeder achte Fang bringt einen Werkstoff. Dazu Funde beim Erkunden: Ware nach Region gestaffelt, Beutel voll Münzen (55–789 Gold), gelegentlich Seelenfragmente. Der **Metalldetektor** (100 Gold) erzwingt einen Fund |
| **Arena** | Trainingsmodus: 4 Kämpfe in Folge gegen den Typ des Tages, drei Stufen (−5/−3/−1 Level), 25 % Heilung zwischen den Kämpfen. **6 Energie für den ganzen Durchlauf**, nicht je Kampf |
| **Poké-Center** | Alle 15 Minuten kostenlose Vollheilung, gelegentlich mit Fund, Geschenk oder Tauschangebot |
| **Poké-Beet** | Beeren, Bonbons oder Gold eingraben; Pflege oder ein Pflanzen-Pokémon heben den Ertrag |
| **Brut-Beet** | Dieselbe Pflege am Ei: bis zu −25 % Brutzeit, +3 auf jeden Wert und die anderthalbfache Shiny-Chance — von Hand oder durch ein abgestelltes Pokémon |
| **Labor** | 15 Forschungsprojekte über 26 Stufen: Rezepte freischalten und sieben Dauerboni heben (Fundchance, Werkstoffe, Expeditionsbeute, Kampf-EP und -Gold, Fangchance, Shiny). Jedes bindet ein Pokémon und gibt ihm die Erfahrung |
| **Fleißpunkte** | Training im Labor: +32 auf einen frei gewählten Wert je Durchlauf, Grenzen wie im Vorbild (252 je Wert, 510 gesamt) |
| **Pension** | Bis zu 5 Pokémon für 24 Stunden, zehn Level je vollem Aufenthalt. Früher abholen kostet Energie, aber nie den Fortschritt |
| **Idle** | Expeditionen (4 Arten × 3 Dauern, bis 6 Pokémon), Ei-Zucht mit IV-Vererbung, 3 Brutplätze (ausbaubar auf 8) |
| **Sozial** | Freunde über Trainer-Code, tägliche Geschenke (Trank, Beeren, Bälle, gelegentlich ein Ei), teilbare Trainerkarte, Marktplatz, Direkttausch |
| **Koop** | Gilden mit Wochenziel — **12 Ziele im Wechsel, das Soll zählt je Mitglied** —, Raid-Bosse als Karte im Telegram-Gruppenchat, asynchrones PvP mit Elo, Wochenturnier |
| **Progression** | Entwicklungen, 10 Ausbauten, 23 Rezepte, Erfolgsketten, 21 Story-Kapitel mit sichtbarer Belohnung |
| **Pokédex** | 390 Arten; jede gesehene lässt sich antippen und zeigt, **wo sie lebt** — nach Häufigkeit, mit Levelband und Bedingungen |
| **Aufgaben** | Drei am Tag und drei in der Woche, aus 12 bzw. 10 im Wechsel — für alle Spieler dieselben. Die Wochenaufgaben zählen **jeden** Sieg, auch den wiederholten: dafür lohnt sich der Weg zurück in ein altes Gebiet |
| **Saison** | Eine Woche, 25 Stufen, 13 davon mit Gegenstand; die letzte bringt ein Schillerndes Seelenfragment |
| **Anmeldung** | 28 Tage mit unterschiedlichen Gaben; jede volle Woche zahlt Schillernde Seelenfragmente (1 · 2 · 3 · 5) |
| **Zugang** | Telegram-`initData`; für den Browser ein Einmalcode aus dem Chat, verbundene Geräte einzeln kündbar |
| **Designs** | 13 kaufbare Farbwelten plus Tag-/Nacht-Modus, der der Weltuhr folgt |
| **Fairness** | Taktkontrolle gegen Automatik-Klicker (Fenster, Mindestabstand, Rhythmuserkennung). Der volle Siegbetrag fällt einmal am Tag je Gegner — darüber hinaus bleibt das **Antrittsgeld**, damit kein Kampf leer ausgeht |
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
npm test                                  # 965 Tests, Engine und API
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
- **[docs/VERBUND.md](docs/VERBUND.md)** — Entwurf: mehrere Instanzen, eine Spielerwelt
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

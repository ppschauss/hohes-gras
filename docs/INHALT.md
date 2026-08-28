# Inhalt: Pack, Pipeline, Rechtslage

## Rechtslage — zuerst, weil es den Rest erklärt

Arten, Attacken, Sprites, Regionen und Trainernamen stammen aus dem
Pokémon-Universum. Das ist geistiges Eigentum von **Nintendo / Game Freak /
The Pokémon Company**.

Deshalb:

- **Das Content-Pack liegt nicht im Repository.** `data/` ist gitignored. Was
  hier steht, ist der Code, der ein Pack lädt — nicht das Pack.
- **Die Engine kennt keine Pokémon.** Sie rechnet mit dem, was ein Pack
  mitbringt.
- **Betrieb ist privat und einladungsbasiert.** Ohne Code kein Zugang.

Wer das Projekt öffentlich betreiben will, tauscht das Pack gegen eigene
Kreaturen aus. Das ist eine Datei, keine Umschreibung.

## Aufbau eines Packs

```
data/packs/<id>/
  pack.json          Kennung, Name, Version, Starter, Startgebiet
  types.json         Typen mit Farbe
  type-chart.json    Effektivitätstabelle
  species.json       Arten: Basiswerte, Lernliste, Entwicklungen, Sprites
  moves.json         Attacken
  items.json         Gegenstände
  areas.json         Gebiete: Spawns, Freischaltbedingungen, Trainer
  regions.json       Regionen
  trainers.json      Trainer, Arenaleiter, Top Vier, Meister, Ereignis-Gegner
  badges.json        Orden
  chapters.json      Story-Kapitel
```

Beim Start prüft `packages/content/src/loader.ts` nicht nur die Form, sondern
auch die Querbezüge: existiert jede Art in jeder Spawn-Tabelle, jeder Typ in
der Effektivitätstabelle, jeder Orden, den ein Gebiet verlangt? Und die Regel,
die am meisten gerettet hat: **ist jedes Gebiet überhaupt erreichbar?** Eine
Freischaltbedingung, die mehr Fänge verlangt, als im Vorgängergebiet
unabhängig von Tageszeit und Wetter vorkommen, ist eine verschlossene Tür ohne
Schlüssel. Beim ersten Lauf hat diese Prüfung 15 solcher Türen gefunden.

## Pipeline

Zwei Werkzeuge, mit klarer Arbeitsteilung:

### `tools/import-pokeapi.ts` — der volle Import

```bash
npm run import -- --dex 1-251
```

Holt Arten, Attacken und Sprites von der PokéAPI, spiegelt die Bilder lokal
nach `data/media/` und schreibt das komplette Pack. Dauert Minuten und macht
tausende Anfragen an eine fremde API. **Nur nötig, wenn sich der Dex-Bereich
ändert.**

### `tools/rebuild-world.ts` — die Welt allein

```bash
npm run world
```

Erzeugt Gebiete, Regionen, Trainer, Orden, Kapitel und Gegenstände aus den
kuratierten Dateien neu — **ohne Netz**, in unter einer Sekunde. Für alles,
was Weltgestaltung ist: eine Spawn-Tabelle ändern, ein Gebiet ergänzen, einen
Trainer einhängen.

Beide wenden dieselben Reparaturen an: unbekannte Arten fliegen aus
Spawn-Tabellen, Trainer ohne verfügbares Team fallen weg, und
Freischaltbedingungen werden auf das geklemmt, was tatsächlich erreichbar ist.
Die kuratierten Zahlen sagen, was ein Gebiet *idealerweise* verlangen soll; die
Erreichbarkeit garantiert die Pipeline.

## Kuratierte Quellen

```
tools/curated-kanto.ts    Kanto: Regionen, Orden, Trainer, 15 Gebiete
tools/curated-johto.ts    Johto: dasselbe, 10 Gebiete
tools/curated-items.ts    Gegenstände (AUTHORED) + abgeleitete Steine
tools/curated-story.ts    Story-Kapitel
```

Das sind Handarbeit, keine Importdaten. Levelkurven, Spawn-Gewichte,
Freischaltbedingungen und Dialoge stehen hier — und nur hier.

### Eine neue Region hinzufügen

1. Datei nach dem Muster von `curated-johto.ts` anlegen.
2. In `rebuild-world.ts` und `import-pokeapi.ts` importieren und an die Listen
   anhängen.
3. `npm run world`, dann Server neu starten. Der Loader meldet jeden Bruch.

Wichtig: **Gebiete hinten anhängen, nicht in die Kette einschieben.** Eine
Umnummerierung verschiebt jede Freischaltbedingung dahinter, und wer schon
mittendrin steckt, steht plötzlich vor einer neuen Tür. Die Nachliga-Gebiete
sind genau deshalb hinten und hinter der Regionskrone.

## Sprites

Werden beim Import lokal gespiegelt und aus `/media/` ausgeliefert. Kein
Hotlinking: die Mini-App soll ohne fremde Hosts funktionieren, und die
Cloudflare-Kante kann sie mit unveränderlichen Dateinamen ewig cachen.

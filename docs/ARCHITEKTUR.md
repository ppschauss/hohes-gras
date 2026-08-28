# Architektur

Warum die Teile so geschnitten sind — nicht was sie tun, das steht im Code.

## Die eine Entscheidung, aus der der Rest folgt

**Die Engine kennt kein Pokémon.**

`@game/engine` enthält Kampf, Fang, Zucht, Wirtschaft, Levelkurven, Skalierung,
Designs — und keine einzige Art, Attacke oder Region. Alles Inhaltliche kommt
aus einem Content-Pack, das zur Laufzeit geladen und gegen ein Schema geprüft
wird.

Das hat drei Konsequenzen, die den ganzen Aufbau prägen:

1. **Testbarkeit.** Das komplette Spiel lässt sich ohne Datenbank und ohne
   Telegram durchrechnen. `tools/simulate.ts` spielt 400 Spieltage von 40
   Trainern in Sekunden durch und meldet, wenn Gold explodiert oder niemand
   mehr vorankommt.
2. **Determinismus.** Jede Zufallsentscheidung bekommt einen injizierten RNG
   mit Seed. Gleicher Seed, gleiche Eingabe, gleiches Ergebnis — deshalb sind
   Kämpfe als Replay abspielbar und Expeditionen beim Einsammeln schon
   feststehend.
3. **Austauschbarkeit.** Ein anderes Kreaturen-Universum ist eine Datei, keine
   Code-Änderung.

## Pakete

```
packages/shared    Typen und zod-Schemas, von API und Web geteilt
packages/content   Pack-Schema, Loader mit Querprüfung, Registry
packages/engine    Spiellogik — rein, ohne I/O, mit injiziertem RNG
packages/api       Fastify + SQLite + grammY-Bot + Scheduler
packages/web       React/Vite Mini-App
```

Die Abhängigkeiten laufen nur nach links: `web` und `api` kennen `engine` und
`shared`, `engine` kennt `content` und `shared`, `shared` kennt nichts.

### Warum `shared` existiert

API und Client müssen sich über jede Antwortform einig sein. Statt die Typen
zweimal zu schreiben und auseinanderlaufen zu lassen, steht jedes Schema einmal
in `shared` — als zod-Schema, aus dem der TypeScript-Typ abgeleitet wird. Der
Server validiert damit Eingaben, der Client leitet daraus seine Typen ab.

## Schichten in der API

```
routes/     dünn: Schema prüfen, Dienst rufen, Ergebnis zurückgeben
services/   Spielregeln, Transaktionen, alles was AppContext braucht
repos/      SQL. Eine Datei je Tabellenbereich, keine Regeln
```

Die Regel dahinter: **eine Route enthält keine Spiellogik, ein Repository keine
Entscheidung.** Wer wissen will, was beim Fangen passiert, liest genau eine
Datei.

### Transaktionen

`better-sqlite3` ist synchron, und das ist Absicht. „Zustand lesen,
entscheiden, Ergebnis schreiben" ist damit atomar, ohne dass ein `await`
mittendrin eine Race Condition versteckt. `tx(db, fn)` umschließt eine
Arbeitseinheit; verschachtelte Aufrufe werden zu Savepoints.

## Zustand: was gespeichert wird und was nicht

Abgeleitet statt gespeichert, wo es geht:

- **Regionsfortschritt** folgt aus Orden und besiegten Trainern.
- **Energie** wird bei jedem Zugriff aus Zeitstempel und Rate nachgerechnet,
  nicht von einem Hintergrundprozess hochgezählt.
- **Designs** sind vier Parameter, aus denen die Palette gerechnet wird.

Gespeichert wird nur, was sich nicht ableiten lässt: Besitz, Fortschritt,
Zeitpunkte. Eine zweite Wahrheit wird beim nächsten Content-Wechsel falsch.

## Migrationen

Nummerierte SQL-Dateien in `packages/api/migrations/`, beim Start einmalig und
in eigener Transaktion angewandt. Der Dateiname *ist* die Version. Ein halb
ausgerollter Deploy lässt sich fortsetzen, indem man den Server neu startet.

Tabellen sind `STRICT`. Das hat schon einen echten Fehler gefunden: ein
gebrochener Zeitstempel aus einer Division ließ sich nicht in eine
INTEGER-Spalte schreiben, statt still gerundet zu werden.

## Client

Ein einziger Zustandsspeicher (`store.ts`) für das, was die Hülle braucht —
Anmeldung, aktueller Bildschirm, Startzustand. Jeder Bildschirm holt seine
eigenen Daten, wenn er geöffnet wird. Bewusst kein Query-Cache: jede Mutation
gibt den neuen Zustand zurück, und eine Cache-Schicht würde nur
Invalidierungsfehler hinzufügen.

Zwei kleine Nebenspeicher, beide mit Grund:

- `lib/energyStore` — Gold und Energie für die Kopfzeile. `lib/api` schreibt
  hinein, sobald irgendeine Antwort sie enthält. Läge das im Hauptspeicher,
  entstünde ein Importzyklus, weil der Hauptspeicher `lib/api` benutzt.
- `lib/theme` — schreibt die Palette als CSS-Variablen auf `:root`. Jede
  Stilregel liest ohnehin nur Variablen, also muss sonst nichts davon wissen.

## Auth

Telegram `initData` wird per HMAC-SHA256 gegen den Bot-Token geprüft, danach
gibt es ein eigenes Session-Token mit 24 Stunden Gültigkeit.

**Fallstrick, der hier einmal zugeschlagen hat:** Telegram beschreibt zwei
Verfahren. Das Ed25519-Verfahren für Dritte schließt `hash` *und* `signature*
aus der Prüfsumme aus — das HMAC-Verfahren nur `hash`. Wer die Ausnahme
überträgt, sperrt jeden modernen Client aus, während selbstsignierte Testdaten
weiter durchgehen. Genau das ist passiert, und genau deshalb signiert der
Testhelfer heute *mit* `signature`.

### Browser: Einmalcode statt zweitem Anmeldesystem

Eine normale Webseite bekommt kein `initData` — die Quelle der Identität fehlt
dort. Statt Passwörter einzuführen (und damit einen zweiten Weg, ein Konto zu
verlieren), leiht sich der Browser die Identität einmalig aus dem Chat, der
ohnehin schon authentifiziert ist:

1. `/browser` im Privatchat oder ein Knopf in der App erzeugt einen Code —
   acht Zeichen, fünf Minuten gültig, einmal verwendbar.
2. Der Browser tauscht ihn gegen eine Sitzung. Nur der **Hash** des Codes steht
   in der Datenbank, wie beim Sitzungstoken.
3. Jede Sitzung ist in der App sichtbar und einzeln widerrufbar.

Details, die dabei zählen:

- **Das Alphabet lässt O/0 und I/1 weg.** Der Code wird abgetippt, oft vom
  Handy auf den Rechner; jedes verwechselbare Zeichen ist ein Fehlversuch, der
  wie ein Angriff aussieht.
- **Ein neuer Code entwertet den alten.** Wer dreimal tippt, weil nichts zu
  passieren scheint, hinterlässt sonst drei offene Türen.
- **Unbekannt, abgelaufen und verbraucht sind dieselbe Antwort.** Zu erklären,
  *warum* ein Code nicht geht, hilft nur beim Raten.
- **Nur im Privatchat.** In einer Gruppe wäre der Code für alle lesbar und
  damit ein Konto zum Mitnehmen.
- **Eigener, enger Rate-Limit-Eimer** (10/Minute): das Einlösen ist der einzige
  Endpunkt, an dem sich ohne Anmeldung etwas raten lässt.
- **Browsersitzungen laufen 30 Tage und gleiten mit.** Ein Tag wie bei Telegram
  hieße: täglich einen Code holen. Die längere Laufzeit kostet keine Kontrolle,
  weil jede Sitzung sichtbar und einzeln kündbar ist.

### Eine Sitzung je Gerät, nicht je App-Start

Die Mini-App meldet sich bei jedem Öffnen neu an — richtig so, aber der alte
Token wurde dabei nur weggeworfen, nicht gelöscht. Gemessen: **304 Sitzungen
bei 4 Geräten**. Eine Geräteliste wäre damit unlesbar gewesen. Beim Ausstellen
einer Telegram-Sitzung fliegt deshalb die vorherige mit gleichem User-Agent
raus.

Bewusst **nur** für Telegram: dort ist der alte Token in derselben Sekunde
wertlos. Zwei Browser können dieselbe User-Agent-Zeichenkette haben und
trotzdem auf verschiedenen Rechnern stehen — dort wäre Zusammenfassen ein
Rauswurf.

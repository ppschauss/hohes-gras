# Funktionen

Was das Spiel kann, Bereich für Bereich, mit den Zahlen dahinter. Wo eine Zahl
eine Entscheidung war, steht die Begründung in **[BALANCE.md](BALANCE.md)**;
wie die Teile geschnitten sind, in **[ARCHITEKTUR.md](ARCHITEKTUR.md)**.

Stand: 3 Regionen · 38 Gebiete · 390 Arten · 533 Attacken · 85 Gegenstände ·
57 Trainer · 26 Orden · 21 Story-Kapitel · 24 Rezepte · 16 Forschungsprojekte ·
965 Tests.

## Wo was liegt

Die Oberfläche hat fünf Ziele auf der unteren Leiste (Start, Garten, Karte,
Team, Freunde) und darüber hinaus einen Startbildschirm, der seine Kacheln in
Gruppen zeigt: **Spielen · Dein Team · Basis & Vorrat · Welt · Du.** Drei
dieser Kacheln fassen jeweils mehrere Bereiche zusammen:

| Ort | Reiter | Beantwortet |
|---|---|---|
| **Fortschritt** | Reise · Entwicklung · Pension | Wo geht meine Reise weiter? |
| **Basis** | Ausbau · Forschung · Handwerk | Was baue und betreibe ich? |
| **Erfolge** | Erfolge · Saison · Rangliste | Wie weit bin ich, wie steh ich da? |

Die Basis ist dabei keine Sammelstelle, sondern eine Kette: der Ausbau schaltet
Forschung frei, die Forschung schaltet Rezepte frei, die Werkstatt stellt sie
her. Export und Löschung des Spielstands stehen bei den Einstellungen unter
„Konto & Daten".

---

## 1. Zugang

### Anmeldung in Telegram

Die Mini-App bekommt von Telegram ein signiertes `initData`-Paket. Der Server
prüft es per HMAC-SHA256 gegen den Bot-Token und stellt daraufhin ein eigenes
Sitzungs-Token aus. Ohne gültige Signatur kein Zugang — auch nicht mit
kopierten Daten, denn die Signatur hängt am Bot-Token, der nur auf dem Server
liegt.

### Anmeldung im Browser

`/browser` im Bot-Chat erzeugt einen **Einmalcode**, gültig fünf Minuten. Damit
meldet man sich unter derselben Adresse im Browser an. Jede Sitzung steht
danach im Konto: Gerät, erste Anmeldung, letzte Aktivität — einzeln kündbar,
oder alle anderen auf einmal.

Der Code-Endpunkt ist der einzige, an dem sich ohne Anmeldung etwas raten
lässt; er ist deshalb auf **10 Versuche je Minute und Adresse** begrenzt. Bei
32⁸ möglichen Codes und fünf Minuten Gültigkeit ist Raten aussichtslos.

### Zugang

Offen: wer den Bot startet, wählt einen Starter und spielt. Eine
Einladungsschranke gab es einmal; sie ist raus, weil sie den Kreis klein
gehalten hat, den sie schützen sollte.

Der **erste** Trainer auf einem frischen Server wird automatisch Admin, ebenso
wer in `secrets.env` als `ADMIN_TELEGRAM_ID` steht.

---

## 2. Trainer und Konto

| Was | Details |
|---|---|
| **Trainer-Code** | Acht Zeichen in der Form `ABCD-1234`, Freundschafts- und Geschenkadresse |
| **Trainerkarte** | Teilbare Übersicht: Team, Orden, Wertung, Erfolge — auch inline im Chat |
| **Designs** | 14 Farbwelten (eine gratis, 13 für 3.000 bis 40.000 Gold), dazu Tag-/Nacht-Modus, der der Weltuhr folgen kann |
| **Erinnerungen** | Höchstens **eine stille Telegram-Nachricht am Tag**, abschaltbar |
| **Datenschutz** | Vollständiger Export als JSON, endgültige Löschung des Kontos |
| **Admin** | Bannen, Rollen vergeben, Laufzeit und Zahlen einsehen |

---

## 3. Energie — statt Tageslimits

Es gibt kein „Du hast heute genug gespielt". Stattdessen kostet jede Handlung
Energie, und Energie füllt sich von allein: **2 Punkte je Minute**, auch im
Schlaf.

| Kosten | | Erträge | |
|---|---|---|---|
| Pflege, Erkundung | 1 | Erster Sieg über einen Gegner | +4 |
| Kampf, Raid-Angriff | 2 | Gewonnenes Duell | +2 (Einsatz 3) |
| Duell, Expedition | 3 (2–6) | Entwicklung (max. 10/Tag) | +15 |
| | | Raid-Boss besiegt | +20 |
| | | Neuer Orden | +60 |
| | | Gebiet vollständig | +120 |

**Vorrat:** 150 Punkte zu Beginn, in 12 Stufen à 25 dauerhaft ausbaubar, plus
bis zu 60 aus dem Gewächshaus — Ende bei 510.

**Kaufen:** 10 Energie für 130 Gold, 50 für 575, 200 für 2.000 (13 / 11,5 / 10
Gold je Punkt).

**Über 1.000 Energie** wird jeder weitere gutgeschriebene Punkt zu **1 Gold**.
Vorher stapelte sich Energie gegen eine harte Grenze und war darüber schlicht
weg. Der Kurs ist bewusst schlecht — er ist eine Quittung, keine Anlage. Im
Laden steht vor dem Kauf, welcher Teil einer Packung sofort zurückflösse.

---

## 4. Garten und Pflege

Bis zu **fünf** Pokémon stehen im Garten. Vier Pflegeaktionen — **Füttern,
Spielen, Waschen, Ausruhen** — geben Erfahrung, Freundschaft und Ausdauer, je
1 Energie.

Die Erfahrung ist **an das Level gekoppelt**: eine Pflegeaktion gibt einen
Anteil dessen, was das nächste Level kostet, nicht eine feste Zahl. Vorher
gaben 25 EP auf Level 5 spürbar viel und auf Level 40 gar nichts mehr.

Der Hintergrund der Gartenszene ist wählbar (6 Motive im Laden).

---

### Wer gerade gebunden ist

Ein Pokémon auf Expedition, im Labor, in der Pension oder auf einem Ei bleibt
im Team — es **kämpft nur nicht mit**. Das stand nirgends, und ein Kampf, in
dem zwei statt fünf antreten, sieht aus wie ein Fehler; genau so wurde es
gemeldet („bei jedem Fight kämpfen nur 2 Pokémon"). Jetzt trägt die Karte einen
Hinweis mit dem Grund, und über dem Team steht, wie viele in den Kampf gehen.

### Teams und Reihenfolge

Bis zu **acht gespeicherte Aufstellungen**, eine davon aktiv; sie steht im
Garten und kämpft. Die **Reihenfolge** ändert man im Bearbeiten-Modus mit zwei
Tippern: erst ein Feld antippen, dann ein zweites — die beiden tauschen. Ziehen
wäre die naheliegende Geste und in dieser WebView die falsche, weil der
Bildschirm mitscrollt und ein Fehlgriff verschiebt statt zu blättern.

---

## 5. Box, Verwerten, Seelenfragmente

**900 Plätze** im Grundstock, mit dem **Depot** in 25 Stufen um je 50 erweiterbar
(5.000 Gold je Stufe, Ende bei 2.150). Die Grenze gilt für Box *und* Team; sie
steht im Kopf der Box und in jeder Absage, die sie auslöst.

**Verwerten** macht aus einem Pokémon **je ein Seelenfragment pro Typ** — ein
Zwei-Typen-Pokémon gibt also zwei verschiedene. Drei Sperren: nicht im Kampf,
nicht auf Expedition, und nie das letzte Pokémon.

- **15 Fragmente einer Sorte** → ein Ei dieses Typs (zufällige Grundform)
- **85 Fragmente einer Sorte** → ein schillerndes Ei
- **5 Schillernde Seelenfragmente** → ein schillerndes Ei, Typ frei wählbar

**Sammelverwerten:** „Mehrere auswählen" setzt Häkchen an die Zeilen, bis zu
**50 auf einmal**, alles in einer Transaktion — entweder gehen sie zusammen
oder keines.

**Suchen** über Spitzname, Art und Typ — bei über zweitausend Plätzen findet
Sortieren allein kein bestimmtes Pokémon.

**Sortieren** nach Nummer, Name, Level, Typ oder „schillernd zuerst", mit
Richtungsumschalter. Bei Gleichstand entscheidet immer Nummer, dann Name —
ohne festen Ausgleich springen Zeilen bei jedem Neuladen. Die Wahl überlebt den
Besuch.

**Eingelagerte erholen sich in einer Stunde vollständig** (100 statt 6
Ausdauerpunkte je Stunde). Die Box ist damit der Ruheplatz: wer ein Pokémon
einlagert, findet es eine Stunde später einsatzbereit vor. Im Team bleibt es
bewusst siebzehnmal langsamer — dort *arbeitet* das Pokémon, und darin liegt
der Unterschied zwischen den beiden Orten.

### Die Uhr der Erholung

Jeder Trainer hat zwei eigene Uhren, eine fürs Team und eine für die Box, und
sie rücken **nur um die tatsächlich gewährten Punkte** vor — nicht bis „jetzt".

Das ist kein Detail, sondern der Kern. Vorher hing die Erholung an
`last_seen_at`, also an dem Zeitstempel, den *jede* Anfrage neu setzt. Lag der
Abstand unter zehn Minuten, stieg die Rechnung aus — und die verstrichene Zeit
war trotzdem verloren, weil der Zeitstempel schon weitergerückt war. Wer alle
fünf Minuten in die App sah, bekam damit **nie etwas**:

| Rhythmus | kam an (bei 18/h) |
|---|---|
| alle 3 min | 0/h |
| alle 5 min | 0/h |
| alle 9 min | 0/h |
| alle 20 min | 18/h |

Gemessen an einem echten Spielstand: von 100 eingelagerten Pokémon standen 40
auf exakt demselben Wert, drei auf 1 und neun auf 4 — seit Tagen unverändert.

Mit den eigenen Uhren ist der Rhythmus gleichgültig: hundert kleine Schritte
ergeben dasselbe wie ein großer. Nachgeprüft am echten Spielstand — zwölf
Blicke im Zwei-Minuten-Takt hoben das Minimum der Box von 1 auf 41, also genau
die 100 je Stunde.

Nachgezogen wird die Erholung im Garten, in der Expeditionsübersicht und beim
Start einer Expedition. Nicht in der Auth-Schicht, obwohl das lückenlos wäre:
eine ausgebaute Box fasst über tausend Kreaturen, und bei 100/h wäre fast jede
Anfrage ein Massen-Update.

---

### Attacken wählen

Vier Plätze je Pokémon, frei belegbar aus allem, was die Art auf ihrem Level
kann — plus dem, was sie schon hat. Der Zusatz ist kein Schlupfloch, sondern
die Entwicklung: ein Safcon trägt Attacken aus seiner Zeit als Hornliu, die
Safcons eigenes Lernset nicht kennt.

Unter der Liste steht, **welche Attacke als Nächstes kommt und ab wann**. Ohne
diese Zeile sieht ein Pokémon, das gerade nichts Neues lernen kann, aus wie
eines, das nie wieder etwas lernt.

Die Lernsätze stammen aus **allen Spielversionen zusammen**, je Attacke das
niedrigste Level — im Schnitt 18,6 Attacken je Art. Details in
[INHALT.md](INHALT.md).

---

## 6. Welt, Reise, Skalierung

**Drei Regionen, 38 Gebiete** inklusive Nachliga-Gebieten. Die **Startregion ist
frei wählbar** und bringt eigene Starter mit.

- **Freischaltung** über **Pokédex-Einträge**, nicht über Fänge im Gebiet: was
  man einmal gefangen hat, zählt überall. (Vorher musste man dasselbe Taubsi
  auf jeder Route neu fangen.)
- **Weitere Regionen** öffnen sich erst, wenn die vorherige durch Sieg über
  Top Vier und Champion abgeschlossen ist.
- **Reisegrenze:** Level 100 zu Beginn, **+50 je bezwungener Region**,
  absolutes Ende bei 500. EP über der Grenze verfallen, statt sich anzustauen.
- **Skalierung:** Eine Region **empfängt einen immer auf dem eigenen Niveau**
  — auf dem Median des Teams, beim **Betreten eingefroren**. Das ist keine
  Einstellung, sondern die Bedingung dafür, dass es drei Startregionen gibt:
  die entworfenen Bänder sind eine Kette (Kanto 2–78, Johto 58–100, Hoenn
  96–150). Der **Schalter** regelt nur, ob die einzelnen Gebiete danach
  mitwachsen — aus heißt „du wächst in die Region hinein und lässt sie hinter
  dir".
- **Wetter wechselt alle zwei Stunden**, nicht alle sechs, und die Verteilung
  ist flach: kein Wetter liegt unter einem Zehntel. Vorher kam Sandsturm im
  Schnitt alle **hundert Stunden** und dann sechs Stunden lang — wer die
  letzten Arten einer Region brauchte, wartete auf einen Würfel, der zweimal
  die Woche fällt. Jetzt ist das seltenste Wetter alle **18 Stunden** da, bei
  zwölf Blöcken am Tag statt vier.
- **Wetter und Tageszeit** steuern, welche Arten überhaupt erscheinen. Beide
  stehen auf dem **Startbildschirm**, im Kopf der **Weltkarte** und über der
  Artenliste im **Gebiet** — dort zusätzlich mit dem Zeitpunkt der nächsten
  Änderung („Nacht in 34 Min · Wetter wechselt in 12 Min zu Sturm"). Beides
  ist berechenbar und für alle Spieler gleich.
- **Ein Spieltag dauert fünf Stunden**, nicht vierundzwanzig: Morgengrauen 40
  Minuten, Tag 120, Abenddämmerung 40, Nacht 100. Vorher lief die Uhr in
  Echtzeit, und damit lag die Nacht — an der zwei Drittel aller
  zeitgebundenen Vorkommen hängen — für die meisten im Schlaf. Die fünf sind
  bewusst kein Teiler von vierundzwanzig: sonst sähe jemand, der immer um
  sieben spielt, jeden Abend dieselbe Tageszeit. So verschiebt sich der Zyklus
  täglich und führt über eine Woche jede Tageszeit an jede Uhrzeit.
- Gerechnet wird aus der **absoluten Zeit**, nicht aus der Ortszeit: die
  Sommerzeit lässt den Zyklus damit nicht springen. Nur die **Tagesgrenze**
  für Aufgaben, Geschenke und Anmeldebelohnung hängt weiter am Kalender in
  Europe/Berlin.

---

## 7. Safari — Erkunden und Fangen

Eine Erkundung kostet **1 Energie** und endet in einer wilden Begegnung, einem
Überfall, einem Streuner, einem Fundstück, einem Legendären oder nichts.

### Fangen

Ball und Beere sind frei wählbar, dazu **Schwächen** und **Beruhigen** (je
zweimal je Begegnung). Die Fangchance steht als Balken über den Knöpfen.

**Jeder achte Fang (12,5 %)** bringt zusätzlich einen Werkstoff: Seidenfaden,
Feinsand, Tautropfen, Eisensplitter, selten Sternenstaub — das Bindeglied
zwischen Erkunden und Werkbank.

### Wer hier lebt

Im Gebiet steht, welche Arten hier vorkommen — **alle**, mit Anteil an den
Begegnungen, Levelband und Haken für Gefangenes. Was man hier noch nicht
gesehen hat, steht ohne Namen und Bild als **???** in der Liste, aber mit
seiner Bedingung: „nur nachts", „nur bei Regen oder Sturm".

Zuerst standen dort nur die gesehenen Arten, damit das Entdecken nicht
vorweggenommen wird. Das war zu streng: wer nicht weiß, dass da noch etwas ist
und *wann* es erscheint, sucht nicht danach — er hört auf.

Die Anteile gelten für **jetzt**. Was gerade nicht erscheinen kann, steht
ausgegraut mit „—" statt mit einer Chance, die es in diesem Moment nicht gibt.

### Fangserie und Schillernde

Wer dieselbe Art hintereinander fängt, baut eine **Serie** auf. Die Anzeige
nennt die aktuelle Chance und den nächsten Meilenstein.

| Serie | Chance auf ein Schillerndes |
|---|---|
| 0 | 0,20 % |
| 1–9 | steigt gleichmäßig auf 10 % |
| **10 bis 48** | **10 %** |
| 49 | der 50. Fang ist garantiert schillernd |

Die Kurve stieg vorher spät und dann steil (1,8 % bei zehn Fängen, 28 % bei
dreißig). Das war als Ziel gedacht und in der Praxis eine Durststrecke: die
ersten dreißig Fänge fühlten sich an wie gar keine Serie.

**Nach einem Treffer fällt die Serie auf 20 zurück**, also auf die
Zehn-Prozent-Marke. Vorher fiel sie gar nicht: wer einmal bei 49 stand, fing ab
da *jedes* Exemplar dieser Art schillernd — die Jagd war nach dem ersten
Treffer vorbei und das Besondere zur Regel geworden. Auf null zurückzusetzen
wäre das andere Extrem; so bleibt die Arbeit belohnt, nur nicht ewig.

### Lockdüfte

Ein Duft je Typ, **50 Gold für 5 Anwendungen**, vervierfacht das Gewicht des
gesuchten Typs in der Spawn-Tabelle. Verbraucht wird vor dem Wurf und
unabhängig vom Ergebnis — sonst wäre er ein Wunschautomat.

Dazu der **Legendäre Lockduft**: ein Prüfgegenstand ohne Preis, den nur ein
Admin vergibt. Er überspringt beides, was ein Legendäres sonst verlangt.

### Die Prisma-Linie

Neben dem Prisma-Abra, das man nur geschenkt bekommt, gibt es eine Linie zum
**Finden**: **Prisma-Glumanda → Prisma-Glutexo → Prisma-Glurak**, mit eigenen
Bildern und den Entwicklungsstufen des Vorbilds (16 und 36).

Sie erscheint mit **2 % im zehnten Gebiet jeder Region** — dieselbe Stelle
überall, damit niemand die Welt absuchen muss. Ihre Werte haben eine
Untergrenze von **20 von 31** je Wert: spürbar besser als der Durchschnitt,
aber nicht makellos. Ein makelloser Fund wäre das Ende der Suche und nicht ihr
Anfang.

Anders als das Abra zählt sie in den Pokédex: was man finden kann, gehört auch
in die Summe.

**Züchten geht nicht.** Die Linie erbte ihre Ei-Gruppen vom Vorbild und ließ
sich damit nachziehen — aus einem Fund mit zwei Prozent auf einer einzigen
Route wäre eine Produktion geworden. Sie hat jetzt wie die Legendären gar keine
Ei-Gruppe und erscheint erst gar nicht in der Zuchtauswahl.

**Eigene Attacken.** Die Linie erbt ihr Lernset aus zwei Vorbildern — Werte und
Typen vom eigenen, die Zeitpunkte vom Glumanda —, lernt also durchgehend im
früheren Takt: Feuerzahn ab 25 statt 28. Dazu vier Signaturattacken nach dem
Thema statt nach Stärke, denn ein Prisma bricht Licht: **Metallklaue (13),
Juwelenkraft (22), Feuerodem (31), Lichtkanone (40)**, für die späteren Stufen
Drachenklaue (36) und Antik-Kraft (48). Sie liegen in den Lücken der Vorlage —
bei 13, 22 und 31 passierte vorher nichts. 15, 16 und 22 Attacken je Stufe,
keine Lücke größer als sechs Level.

### Legendäre

**0,1 % je Erkundung**, und nur in einer Region, die vollständig bezwungen ist.
Fangbar ausschließlich mit **Sagenbeeren** (höchstens drei je Begegnung), die
es nur bei Überfällen gibt.

### Überfälle

**4 % je Erkundung** taucht eine Bande auf. Beute: Gold, Gegenstände, mit 50 %
eine Sagenbeere und mit 70 % zwei bis fünf verschiedene Lockdüfte. Der
**Störsender** (10.000 Gold) erzwingt die nächsten fünf Überfälle.

### Streuner

**3 % je Erkundung** schneidet einem ein gewöhnlicher Trainer der Region den
Weg ab — einer mit **höchstens zwei Pokémon**, kein Arenaleiter. Er wird nicht
erfunden, sondern aus dem Pack genommen, damit auch für ihn die Tagesregel
gilt: der volle Siegbetrag einmal am Tag, danach das Antrittsgeld. Wie beim
Überfall verdrängt er die Begegnung — zwei offene Dinge gleichzeitig gibt es
hier nicht.

### Wo eine Art lebt

Im Pokédex lässt sich jede **schon gesehene** Art antippen: dahinter stehen
alle Gebiete, in denen sie vorkommt — nach Häufigkeit sortiert, mit Levelband,
Region und den Bedingungen (Tageszeit, Wetter), falls es welche gibt. Gebiete,
in denen man noch nie war, sind als solche gekennzeichnet.

Nicht gesehene Arten verraten nichts. Ein Pokédex, der die Fundorte von allem
ausplaudert, nimmt dem Entdecken den Sinn.

### Fundstücke

**3 % je Erkundung** liegt etwas im Unterholz. Es wandert sofort in Beutel oder
Kasse; einen Knopf zum Aufheben gibt es nicht.

| Was | Anteil zufällig | mit Detektor |
|---|---|---|
| Ware aus der Region | 60 % | 72 % |
| Beutel voll Münzen (55–789 Gold) | 28 % | 10 % |
| Seelenfragment (1–2) | 12 % | 18 % |

**Was findbar ist, hängt an der Region** — und zwar am Verkaufspreis, dem
einzigen Wertmaß, das jeder Gegenstand trägt: 50 in Kanto, 150 in Johto, 450 in
Hoenn. Das sind 9, 20 und 23 verschiedene Fundstücke. Eine vierte Region
braucht dafür keine Zeile Code, und ein neuer Werkstoff im Pack ist automatisch
findbar. Von billigen Sachen liegt ein kleiner Haufen da (bis zu drei), von
teuren genau eines.

Der **Metalldetektor** (500 Gold, 10 Anwendungen) ersetzt den Wurf: solange
Ladungen übrig sind, endet jede Erkundung in einem Fund. Er gräbt dafür anderes
aus als der Zufall — Schrott und Fragmente statt Geldbeutel.

## 8. Kampf

Rundenkampf mit vollständiger **Typentabelle**, Statusveränderungen,
Stat-Stufen, Mehrfachtreffern, Wechseln und **Gegenständen mitten im Kampf**.
Die KI kennt vier Stufen; Arenaleiter und Top Vier spielen die stärkste.

- **26 Orden** über drei Regionen, je Region eine **Top Vier mit Champion**.
- **Jeder bekommt ein Starterpaket** mit Bällen, Beeren und Medizin.
- **Wer besiegt wird, verliert seinen Zug.** Vorher führte der Nachrückende
  den Angriff des Gefallenen aus — ein geschenkter Schlag, für beide Seiten.
- **Ein Wechsel kostet die Runde**, der Gegner greift also das
  hereinkommende Pokémon an. Das ist die Regel der Vorlage und kein Fehler:
  ein freier Wechsel wäre der stärkste Zug im Spiel.
- Ein Kampf **wartet geduldig** — aber nach **zwei Stunden** ohne Zug gilt er
  als verlassen und schließt ohne Sieger. (Vorher blockierte ein vergessener
  Kampf stundenlang Heilen und Überfälle.)

### Belohnungen und ihre Grenzen

| | Erster Sieg über diesen Gegner | Wiederholung |
|---|---|---|
| Gold | voll **+ Antrittsgeld** | nur das **Antrittsgeld** |
| EP | voll | halb |
| Energie | +4 | — |
| Saisonpunkte | 60 (Arena) / 10 | erst am nächsten Tag wieder |

**Antrittsgeld:** 10 Gold je aufgewendeter Energie, also 20 für einen
Trainerkampf. Es gibt ihn auch bei einer Niederlage — die Energie ist so oder
so weg —, nur beim Aufgeben nicht. Damit geht kein ausgefochtener Kampf leer
aus, ohne dass Wiederholen zur besten Goldquelle wird.

**Die Zahl der gegnerischen Pokémon zählt bei den EP mit**, ein Viertel je
zusätzlichem Gegner: 1,25 bei zweien, gut das Dreifache bei sechs. Vorher war
ein Kampf gegen sechs exakt so viel wert wie einer gegen eines — in die
Rechnung gingen das höchste Level und der Durchschnitt der Arten ein, aber nie
die Menge.

Der Grund steht in BALANCE.md: eine Arena zahlte 60 Punkte je Sieg und ließ
sich beliebig oft herausfordern — 30 Punkte je Energie, während ein Fang 4
gibt.

---

### Die Liga

Die Top Vier werden **der Reihe nach** bestritten, der Champion **zuletzt** —
er lässt sich erst herausfordern, wenn alle vier gefallen sind. Sonst wäre die
Reihenfolge Dekoration: man liefe an vier Prüfungen vorbei und direkt zum
Meister, und die vierte ist nur dann die schwerste, wenn die ersten drei davor
liegen.

Die Regel selbst gab es lange (`engine/league.ts`, geprüft beim Kampfstart).
Was fehlte, war die **Anzeige**: die Top Vier standen zwischen den Streunern
der Route, unter der Überschrift „Training", und alle vier trugen denselben
aktiven Knopf. Man erfuhr von der Sperre erst durch eine Fehlermeldung nach dem
Antippen — vier Knöpfe, die gleich aussehen und von denen drei scheitern, sind
keine Liste, sondern ein Ratespiel.

Jetzt hat die Liga ihren eigenen Abschnitt mit eigener Überschrift, der
Champion sitzt abgesetzt darunter, und an jedem gesperrten Gegner steht, worauf
er wartet („Erst Anton besiegen", „Noch 3 aus den Top Vier offen").

---

## 8b. Kampfzone

Eine Serie gegen **wilde Pokémon** einer Region, ohne festes Ende: man kämpft,
solange man steht. Die Arena ist der Ort zum *Üben* — bekannter Typ, vier
Runden. Die Kampfzone ist der Ort zum **Farmen**, und zwar für die Werkstoffe
der jeweiligen Region.

| | |
|---|---|
| Gegner | **eines** je Kampf, auf dem eigenen Durchschnittslevel |
| Steigerung | +1 Level je 10 Siege, Werte von 8 auf 31 über die Serie |
| Erfahrung | **2,5×** |
| Energie | **10 für den ganzen Lauf**, nicht je Kampf |
| Heilung | 8 % nach jedem Sieg, **vollständig an jeder Stufe** |
| Ende | eine Niederlage — oder freiwillig aufhören |

### Die Stufen

| Serie | Gold | Werkstoffe |
|---|---|---|
| 10 | 400 | 3 |
| 15 | 700 | 4 |
| 25 | 1.500 | 7 |
| 50 | 4.000 | 15 |
| 100 | 12.000 | 35 |

Die ersten beiden liegen dicht beieinander, damit auch ein kurzer Besuch etwas
abwirft; danach zieht es sich, damit hundert eine Zahl bleibt, die man erzählt.
Jede Stufe heilt vollständig — ohne das wären fünfzig unerreichbar, mit einer
Heilung nach jedem Kampf gäbe es kein Risiko. Die Stufen sind die Rastplätze.

Dazu Gold je Sieg, mit der Serie wachsend (30 + 4 je Sieg), damit auch die
Kämpfe *zwischen* zwei Stufen etwas wert sind.

### Beute je Kampf

Nicht nur an den Stufen — **jeder** besiegte Gegner kann etwas fallen lassen.
Ohne das sind neun Siege in Folge neun Kämpfe für nichts, und die Zehn ist eine
Klippe statt eines Meilensteins.

Zwei getrennte Würfe, weil sie Verschiedenes bedeuten: **35 % ein Ball**, den
man beim Fangen wieder verbraucht, **30 % ein Werkstoff** der Region, wofür man
überhaupt herkommt. Etwa 45 % der Kämpfe gehen leer aus.

Der Ball wird mit der Serie **besser statt mehr** — ab 20 Superbälle, ab 50
Hyperbälle. Zwanzig Pokébälle mehr ändern nichts, drei Hyperbälle schon.

Gemessen, ein Lauf über 30 Kämpfe in Hoenn: 11 Pokébälle, 3 Superbälle,
7 Tautropfen, 6 Sternenstaub — zusätzlich zu den Stufen bei 10, 15 und 25.

### Die Abrechnung am Ende

Endet ein Lauf — durch Niederlage oder freiwillig —, steht da, **was insgesamt
zusammengekommen ist**: Gold, Erfahrung je Pokémon und jeder Gegenstand mit
Menge, das Häufigste zuerst. Dazu die erreichte Serie und die Bestmarke.

Ohne sie verschwindet alles stumm im Beutel, und eine Serie von dreißig fühlt
sich an wie nichts — dieselbe Lücke wie früher bei Kämpfen und Raids, nur über
eine ganze Sitzung hinweg.

### Warum regional

| Region | Werkstoffe |
|---|---|
| Kanto | Eisensplitter, Feinsand |
| Johto | Seidenfaden, Tautropfen |
| Hoenn | Tautropfen, Sternenstaub |

Wer Eisensplitter braucht, soll wissen, wohin er reist. Ein Ort, der überall
dasselbe abwirft, ist kein Ort, sondern ein Knopf. Zur Wahl stehen alle
Regionen, in denen man war oder die man bezwungen hat — auch die, in die man
gerade nicht reisen darf, weil die laufende noch offen ist.

Die **beste Serie je Region** bleibt stehen, wenn ein Lauf endet. Ohne sie
gäbe es nichts, worauf man hinarbeitet, sobald man einmal verloren hat.

Dazu zwei Aufgaben: **10 Siege am Tag** und **60 in der Woche**.

---

## 8a. Trainingsarena

Ein Ort zum Üben: **vier Kämpfe in Folge** gegen Gegner **eines einzigen Typs**,
der **jeden Tag wechselt**. Der Typ kommt aus dem Datum, nicht aus dem Zufall —
alle treffen denselben, und wer morgen wiederkommt, kann sich heute darauf
vorbereiten.

| Stufe | Gegnerlevel | Gold je Sieg | Durchlauf |
|---|---|---|---|
| Stufe | Gegnerlevel | Gegner | Werte | Gold je Sieg | Durchlauf |
|---|---|---|---|---|---|
| **Leicht** | Ø **−5** | halbes Team, Grundformen bis 330 Grundwerte | 0 | 60 | 400 Gold + 2× EP-Bonbon S |
| **Ausgeglichen** | **−3** | drei Viertel, bis 1. Entwicklung und 430 Grundwerte | 8 | 120 | 900 Gold + 1× EP-Bonbon L |
| **Schwer** | **−1** | volles Team, alles | 15 | 240 | 1.800 Gold + 1× EP-Bonbon L + 2× Sternenstaub |

Die Entwicklungsstufe allein reichte als Maß nicht: Tauros ist eine Grundform
und stand auf „leicht" neben einem Hoothoot. Deshalb zusätzlich eine Obergrenze
für die Summe der Grundwerte.

Innerhalb eines Durchlaufs steigt das Level je Runde um eins — der vierte
Gegner steht über dem ersten. Gegenstände sind erlaubt, und **zwischen den
Kämpfen bekommt das Team 25 % seiner KP zurück**: genug, um weiterzukommen, zu
wenig, um ohne Beutel durchzukommen.

Ein ganzer Durchlauf kostet **6 Energie — einmal, nicht je Kampf**. Vorher
zahlte jeder der vier Kämpfe seine zwei einzeln, und wer mit sechs anfing,
stand nach dem dritten vor einem Durchlauf, den er nicht zu Ende bringen
konnte. Reicht die Energie nicht, sagt die Arena vorher ab.

Sie zahlt **mehr EP als ein gewöhnlicher Trainerkampf**: ×1,5 auf leicht, ×2
auf ausgeglichen, ×3 auf schwer. Gemessen war ein Durchlauf vorher gut ein halbes Level je Mitglied —
für acht Energie und vier Kämpfe der falsche Tausch, zumal die Arena der Ort
zum Trainieren *ist*. Jetzt ist ein Durchlauf auf „ausgeglichen" etwa ein
Level, auf „schwer" anderthalb. Die **Durchlauf-Prämie zahlt einmal am Tag je
Stufe**; danach kann man weiter üben, nur ohne Prämie. Eine Niederlage beendet
den Durchlauf.

Legendäre und Ereignis-Arten treten nie an: die Arena ist ein Übungsplatz, kein
Abkürzungsweg.

## 9. Poké-Center

Kostenlose Vollheilung des Teams, danach **10 Minuten Abklingzeit**. Die
**Schwesternstation** senkt sie in vier Stufen um je 90 Sekunden bis auf vier
Minuten (Boden: drei Minuten). Gelegentlich gibt es beim Besuch einen Fund, ein
Geschenk oder ein Tauschangebot.

---

## 10. Poké-Beet

Beeren, Bonbons oder Gold eingraben; nach vier Stunden kommt vermehrt zurück.
**+50 % von allein, bis +100 %** mit Jäten und Wässern. Ein abgestelltes
Pflanzen-Pokémon übernimmt die Pflege — sein Level bestimmt, wie gut. Gold
lässt sich nur einmal am Tag eingraben.

---

## 11. Expeditionen

**Vier Arten** — Sammeln, Graben, Tauchen, Patrouille — **× drei Dauern**, 1 bis
6 Pokémon je Auftrag. Energie ist hier ein **Beschleuniger**: sie verkürzt die
Wartezeit, statt Voraussetzung zu sein.

### Nur passende Typen

Der Typ war früher ein Bonus (1,4× für passende), jetzt ist er die
**Eintrittskarte**: eine Expedition ist eine Aufgabe, und ein Karpador gräbt
nicht. Die vier Listen decken deshalb zusammen **alle achtzehn Typen** ab —
vorher taten sie das nicht, und eine Sperre hätte 58 der 390 Arten ausgesperrt,
darunter jeden Feuer-Starter.

| Art | Typen |
|---|---|
| **Sammeln** | Pflanze, Käfer, Boden, Gift, Fee |
| **Graben** | Boden, Gestein, Stahl, Feuer, Unlicht |
| **Tauchen** | Wasser, Eis, Flug, Drache |
| **Patrouille** | Normal, Kampf, Elektro, Psycho, Geist |

Die Auswahlliste zeigt nur, wer mitdarf; der Server prüft es noch einmal, denn
der Client ist eine Anzeige und keine Regel. `expedition.test.ts` besteht auf
der vollständigen Abdeckung — wer die Listen ändert, merkt es dort.

### Was ungefähr herauskommt

Vor dem Start steht, was die Reise einbringt: Gold, EP und die erwarteten
Gegenstände. Gerechnet aus **derselben Tabelle**, aus der auch gezogen wird
(`Züge × Anteil × Mittelwert`), damit Vorschau und Wirklichkeit nicht
auseinanderlaufen können. Angegeben ist der beste Fall — ein volles, passendes
Team.

### Wie viel es ist

Gezogen wird `baseDraws × (0,5 + Bewertung/2)`: 2 Züge kurz, 5 mittel, 10 lang.
Die Zahl steht ausdrücklich in der Dauer und wird nicht mehr aus dem
Goldfaktor abgeleitet — vorher kam bei der kurzen Reise für ein mieses und ein
perfektes Team dasselbe heraus, weil beide Werte auf 1 rundeten. Wen man
mitschickte, war also schlicht egal, und das war der Mechanik nicht anzusehen.

Die Bewertung ist bei **vier** passenden Pokémon voll, nicht erst bei sechs:
zusammen mit der Typensperre wären sechs früh im Spiel unerreichbar.

Gemessen, achtstündige Grabung mit vollem Team: **13,6 Eisensplitter** — vorher
waren es 2,5, und ein Verbindungskabel braucht sechs davon. Zwanzig Stunden
Graben für ein Kabel war der Grund für die Überarbeitung.

---

## 12. Zucht und Eier

Zwei passende Pokémon ergeben ein Ei; **IVs und Naturen werden vererbt**.
Schlüpfen kostet Zeit, die die **Brutstation** um bis zu 50 % verkürzt.

**Drei Brutplätze** im Grundstock, mit der **Brutkammer** in fünf Stufen um je
einen erweiterbar (2.500 Gold × Stufe², Ende bei acht). Die Fragmentliste
sperrt ihre Knöpfe, wenn kein Platz frei ist, und sagt warum.

### Brut-Beet

Ein Ei lag bisher da und lief ab. Jetzt gilt dieselbe Mechanik wie im
Poké-Beet: **vier Pflegeschritte** über die Brutzeit, wärmen und wenden im
Wechsel. Weil sie auf drei Dinge gleichzeitig einzahlt, auf jedes ein Stück
schwächer:

| Pflege | Brutzeit | IVs | Shiny |
|---|---|---|---|
| 0/4 | volle Zeit | +0 | ×1 |
| 2/4 | −12 % | +2 | ×1,25 |
| 4/4 | **−25 %** | **+3 auf jeden Wert** | **×1,5** |

Wer stattdessen **ein Pokémon danebenlegt**, bekommt dasselbe automatisch —
anteilig zum Level, ab 100 in voller Höhe. Es ist danach nicht mehr verfügbar,
genau wie ein Beetpfleger. Der bessere der beiden Wege zählt, nie die Summe.

Die Werte steigen **beim Schlüpfen** und nicht beim Legen: sonst stünde das
Ergebnis fest, bevor sich jemand gekümmert hat.

---

### Pension

Bis zu **fünf Pokémon für 24 Stunden**. Sie trainieren durchgehend und schaffen
in einem vollen Aufenthalt **zehn Level** — dieselben zehn für ein frisch
geschlüpftes wie für ein ausgewachsenes, weil über Level gerechnet wird und
nicht über EP.

**Früher abholen kostet 4 Energie, aber nie Fortschritt:** was bis dahin
verdient ist, wird gutgeschrieben. Nach dem Tag hört die Pension auf zu
arbeiten — wer drei Tage stehen lässt, bekommt trotzdem zehn Level.

---

## 13. Entwicklungen

Auslöser: Level, Stein, Freundschaft, Tageszeit — und **Tausch**. Die Abfrage
steht **direkt auf der Karte des Pokémon** („… jetzt zu … entwickeln? Ja /
Nein"), nicht in einem eigenen Menü.

### Entwicklung durch Tausch

Zwölf Entwicklungen bei elf Arten hängen im Vorbild am Besitzerwechsel:
Kadabra, Maschock, Georok, Alpollo, Quaputzi, Flegmon, Onix, Seemon, Sichlor,
Porygon und Perlu (das sich je nach Gegenstand in zwei Richtungen entwickelt).
Acht davon brauchen zusätzlich einen Tragegegenstand — Metallmantel,
King-Stein, Drachenhaut, Up-Grade, Abysszahn, Abyssplatte.

Es gibt zwei Wege dorthin:

**Ein echter Tausch.** Löst die Entwicklung beim *Empfänger* aus, sobald das
Pokémon ankommt — ohne Kabel. Beim Ringtausch können sich beide Seiten
gleichzeitig entwickeln. Ein nötiger Tragegegenstand muss beim Empfänger liegen
und wird verbraucht.

**Die Tausch-Station** (Basis → Tausch-Station). Ein **Verbindungskabel**
simuliert einen Tausch. Das Kabel ist nicht käuflich: es wird aus
Expeditions-Werkstoffen gebaut (6× Eisensplitter, 3× Seidenfaden, 1×
Sternenstaub, 800 Gold), und das Rezept will erst erforscht werden — Labor
Stufe 2, `res-link-cable`. Ein Kabel je Entwicklung.

Die Station zeigt bewusst **auch, was nicht geht**: dass dem Sichlor ein
Metallmantel fehlt, erfährt man sonst nirgends, und eine Entwicklung, die
niemand sehen kann, gibt es nicht.

Der **Marktkauf** löst nichts aus. Er tauscht Gold gegen Pokémon; mit einem
zweiten Konto wäre er sonst der billigste Weg an alle elf Arten. Der
Direkttausch braucht zwei Leute, die beide zustimmen.

Die ersten **zehn Entwicklungen am Tag** bringen Energie (+15) und
Saisonpunkte (+15); danach bleibt die Entwicklung erlaubt, aber ohne Ertrag.
Mit Eiern, Bonbons und einer vollen Box entwickelt man sonst zwanzig am Stück
— gemessen wurden 335 an einem Tag.

---

## 14. Basisausbau

| Gebäude | Wirkung je Stufe | Stufen | Preis |
|---|---|---|---|
| **Trainingsdojo** | +8 % EP je Pflegeaktion | 5 | 1.500 × Stufe² |
| **Brutstation** | −10 % Brutzeit | 5 | 1.200 × Stufe² |
| **Beerenfarm** | +9 % Expeditionsbeute | 5 | 1.800 × Stufe² |
| **Labor** | +5 % Fangchance | 5 | 2.400 × Stufe² |
| **Rasthaus** | +15 % Energieerholung | 5 | 1.000 × Stufe² |
| **Pflegestation** | +50 Pflegeaktionen je 15 Minuten | 5 | 2.000 × Stufe² |
| **Schwesternstation** | −90 s Center-Abklingzeit | 4 | 600 × Stufe² |
| **Gewächshaus** | +20 Energie-Obergrenze | 3 | 6.000 × Stufe² |
| **Brutkammer** | +1 Brutplatz | 5 | 2.500 × Stufe² |
| **Depot** | +50 Boxplätze | 25 | 5.000 (fest) |
| **Expeditionsbüro** | +1 gleichzeitige Expedition | 6 | 3.000 × Stufe² |

Das Depot ist der einzige mit festem Preis: Platz ist eine Ware, fünfzig Plätze
sind fünfzig Plätze. Alle anderen wirken auf alles Kommende und wachsen deshalb
quadratisch.

---

### Labor und Forschung

Fünfzehn Projekte über sechsundzwanzig Stufen. Jedes kostet Werkstoffe und
Gold, läuft über Stunden, belegt einen **Laborplatz** (einen je Laborstufe) und
braucht ein **Pokémon**, das solange nicht verfügbar ist und am Ende die
Erfahrung bekommt.

- **Sieben Rezeptprojekte** schalten Bauanleitungen frei: Hyperball,
  Sonderbonbon, die sechs Entwicklungssteine — und vier neue, die Kreisläufe
  schließen (Metalldetektor, Sternenstaub, EP-Bonbons, Störsender).
- **Sieben Bonusprojekte** wirken dauerhaft: Fundchance (3 → 6 %), Werkstoff je
  Fang (12,5 → 20 %), Expeditionsbeute (+30 %), Kampf-EP (+15 %), Kampf-Gold
  (+30 %), Fangchance (+9 %), Shiny-Grundchance (0,20 → 0,30 %).
- **Trainingslehre** schaltet das Fleißpunkte-Training frei.

Abbrechen kostet 2 Energie und gibt Material und Gold nicht zurück.

### Fleißpunkte

Die Datenbank führt sie seit dem ersten Tag und die Werteformel liest sie —
aber bis hierher hat nichts sie je erhöht. Ein Trainingsdurchlauf gibt **+32
Fleißpunkte** auf einen frei gewählten Wert, dauert 3 Stunden und ist beliebig
wiederholbar. Grenzen wie im Vorbild: 252 je Wert, 510 insgesamt.

### Was man bekommen hat

Jede Belohnung nennt jetzt auch die **Gegenstände**, nicht nur Gold und EP.
Vorher wurden sie stumm in den Beutel gelegt: nach einem Überfall lagen dort
plötzlich zwei Lockdüfte und eine Sagenbeere, ohne dass es irgendwo gestanden
hätte, und die Arena-Prämie kam in der Antwort an, aber nie auf dem Bildschirm.
Man hätte den Beutel auswendig kennen und nach jedem Kampf nachsehen müssen.

Eine Liste, überall dieselbe (`ui/LootList.tsx`): Kampf, Überfall, Arena, Raid.

---

## 15. Handwerk

**24 Rezepte.** Werkstoffe kommen aus Expeditionen, aus dem Gras (jeder achte
Fang) und aus Fundstücken beim Erkunden.

### Bälle in Chargen

Bälle lassen sich zu **10, 25 oder 50** Stück bauen, mit Mengenrabatt: 25
kosten das 2,25-Fache von 10, 50 das Vierfache statt des Fünffachen. Wer auf
Vorrat baut, bindet Material lange im Voraus und bekommt dafür etwas. Der
eigentliche Grund ist aber ein anderer — zehnmal denselben Knopf zu drücken ist
keine Entscheidung, sondern Arbeit.

Die Mengen sind fest: eine freie Zahl ließe sich zu einem eigenen Rabatt
verrechnen, also weist der Server alles ab, was in keiner Charge steht.

Der **Pokéball** ist jetzt selbst herstellbar (4 Eisensplitter + 2 Seidenfaden
+ 100 Gold je zehn). Vorher stand er nur im Laden, und damit hing die ganze
Ballkette an Gold, weil jedes andere Ballrezept Pokébälle verbraucht. Fünfzig
Stück kosten so 16 Eisensplitter statt 1.500 Gold: wer fährt, zahlt weniger als
wer nur reich ist.

Acht davon — Hyperball, Sonderbonbon und die sechs Entwicklungssteine — und
alle vier neuen müssen erst im Labor **erforscht** werden. Die Grundrezepte
bleiben offen: wer heute Bälle und Tränke baut, soll das morgen noch können.

- **Bälle:** Pokéball, Superball, Hyperball, Netzball, Finsterball, Timerball
  — alle in 10/25/50
- **Medizin:** Hypertrank, Beleber, Top-Genesung, Energydrink
- **Sonstiges:** Goldene Himmihbeere, EP-Bonbon S und L, Sonderbonbon, Sinelbeeren
- **Aus eigener Werkstatt:** Metalldetektor (fünf je Bauvorgang), Sternenstaub
  aus gewöhnlichem Material, Störsender statt 10.000 Gold im Laden
- **Entwicklungssteine:** Feuer, Wasser, Donner, Blatt, Mond, Sonne — je aus
  **8 Seelenfragmenten** der passenden Sorte + 2 Sternenstaub + 500 Gold
  (Labor Stufe 2). Im Laden kosten dieselben Steine 1.500 Gold.

Manche Rezepte verlangen ein Gebäude auf einer Mindeststufe. `npm run world`
prüft jedes Rezept gegen den Gegenstandskatalog.

---

## 16. Wirtschaft

Der Laden führt Bälle, Beeren, Medizin, EP-Bonbons, Entwicklungssteine,
Lockdüfte, Hintergründe und den Störsender. Verkaufen geht für einen Bruchteil
des Kaufpreises; Gegenstände **ohne Preis** (Sagenbeere, Seelenfragmente,
Prüfgegenstände) sind weder käuflich noch verkäuflich.

---

## 17. Sozial

- **Freunde** über den Trainer-Code, mit Anfrage und Bestätigung
- **Marktplatz:** Pokémon öffentlich anbieten, Preise zwischen 50 und 100.000
  Gold — die Grenzen verhindern Geldwäsche über Scheinverkäufe
- **Direkttausch** zwischen Freunden
- **Trainerkarte** teilen, auch inline im Gruppenchat
- **Tägliche Geschenke:** einmal am Tag je Freund, kostenlos

### Geschenke

Ein Geschenk enthält **1 Trank, 1–3 Beeren und 5–10 Pokébälle**, und in etwa
jedem zwölften liegt zusätzlich **ein Ei**. Nichts Seltenes — der Wert liegt in
der Regelmäßigkeit, nicht im einzelnen Fund.

Der Inhalt wird beim **Senden** gewürfelt und mitgeschrieben; sonst hinge er
davon ab, wann der Empfänger hineinschaut. Das **Ei** entsteht dagegen erst
beim Öffnen: welche Art schlüpft, gehört zum Empfänger, und ohne freien
Brutplatz läge es sonst tagelang fest. Ist kein Platz frei, kommt der Rest
trotzdem an, und die Meldung sagt es.

Höchstens **20 ungeöffnete Geschenke** sammeln sich an; darüber hinaus wird der
Absender abgewiesen statt still zu stapeln. Die Tagesgrenze steht als
eindeutiger Index in der Datenbank — zwei gleichzeitige Anfragen kämen sonst
beide durch.

---

## 18. Koop

- **Gilden** mit gemeinsamem Wochenziel und Kasse

### Das Wochenziel

**Zwölf Ziele im Wechsel**, eines je Woche: Fänge, Kämpfe, Pflegeaktionen,
Erkundungen, Raid-Schaden, geschlüpfte Eier, Entwicklungen, hergestellte
Gegenstände, gewonnene Duelle, neue Pokédex-Einträge, abgeschlossene
Forschungsprojekte und verschickte Geschenke.

**Drei Ziele laufen gleichzeitig**, jedes für sich abholbar. Vorher war es
eines, und das war „zu heftig" — die Antwort darauf war nicht „leichter",
sondern „mehr davon, kleiner": alle Werte auf ein Drittel, dafür drei
nebeneinander. Drei kleine Aufgaben sind eine Woche, die man planen kann; eine
große ist eine Wand.

**Das Soll zählt je Mitglied**, nicht als feste Zahl. Vorher standen dort 1000
Fänge und 800 Pflegeaktionen — Werte für eine volle Gilde. Eine Gilde aus zwei
Leuten hatte damit 400 Fänge je Kopf zu erledigen, und das Ziel war nie etwas
anderes als Deko. Jetzt sind es 60 Fänge je Mitglied, bei einer Untergrenze,
die auch die Ein-Personen-Gilde nicht an einem Nachmittag abräumt. Wer beitritt,
hebt die Latte und trägt selbst dazu bei.

Und **jedes Ziel hat nachweislich eine Quelle.** Vorher wurden nur Kämpfe und
Raid-Schaden hochgezählt: eine Woche mit dem Ziel „Fänge" oder
„Pflegeaktionen" blieb bei null stehen, egal was die Gilde tat. Jetzt meldet
dieselbe Funktion, die schon die Erfolge zählt, auch ans Wochenziel.

- **Raid-Bosse als Karte im Telegram-Gruppenchat** — Stufe 1 schafft ein
  Trainer allein, Stufe 3 zwei, Stufe 5 vier: Der Bot postet, Mitglieder
  treten per Knopf bei, ihre Teams tragen Schaden bei, die Beute verteilt sich
  nach Beitrag. `/gilde` verbindet einen Chat mit der Gilde, `/raid` zeigt
  laufende Raids.

---

## 19. PvP

**Asynchrone Duelle** gegen eine Momentaufnahme des gegnerischen Teams —
niemand muss online sein. Beide Teams treten auf die **niedrigere der beiden
Reisegrenzen** an, damit die Aufstellung entscheidet und nicht die Zahl der
bezwungenen Regionen. Das Ergebnis ist ein abspielbares Replay.

**Wertung und der volle Siegbetrag gibt es einmal am Tag je Gegner.** Der
zweite Sieg gegen dieselbe Person wird ausgetragen und aufgezeichnet, bringt
aber weder Elo noch Saisonpunkte — und beim Gold nur noch das **Antrittsgeld**,
also genau das, was eine Niederlage einbringt. Niederlagen bleiben unangetastet,
damit die Wiederholung ein Risiko bleibt statt einer risikolosen Wette.

Dazu ein **Wochenturnier** mit automatisch aufgelöstem Bracket.

---

## 19a. Tägliche Anmeldebelohnung

**Vier Wochen, 28 verschiedene Gaben.** Jeder Tag zahlt einmal; wer einen Tag
auslässt, fängt wieder bei Tag 1 an. Nach Tag 28 beginnt die Leiter von vorn,
die Serie läuft weiter.

| Woche | Thema | Prämie am 7. Tag |
|---|---|---|
| 1 | Ankommen: Gold, Pokébälle, Energie, Beeren, Bonbons, Superbälle | **1× Schillerndes Seelenfragment** |
| 2 | Ausrüsten: Gold, Himmihbeeren, Energie, Supertränke, Hyperbälle, Sternenstaub | **2×** |
| 3 | Werkeln: Gold, Tautropfen, Energie, EP-Bonbon L, Goldene Himmihbeeren, Eisensplitter | **3×** |
| 4 | Meistern: Gold, Beleber, Energie, Sonderbonbon, Mondstein, Top-Genesungen | **5×** |

Elf Fragmente je Durchlauf, dazu vier aus der Saison — in vier Wochen also
fünfzehn, gut zwei schillernde Eier. Die Prämien wachsen, damit die vierte
Woche mehr ist als die erste noch einmal.

Die Karte steht auf dem Startbildschirm und zeigt die laufende Woche als sieben
Felder; der Prämientag trägt einen Funken. `npm run world` prüft die 28 Gaben
gegen den Gegenstandskatalog.

## 19b. Tages- und Wochenaufgaben

Das Spiel hatte lange nur zwei Rhythmen: die Anmeldebelohnung (kommt von
allein) und das Gildenziel (kommt nur mit einer Gilde). Wer allein spielte,
hatte keinen Grund, heute etwas anderes zu tun als gestern.

**Drei Aufgaben am Tag, drei in der Woche**, aus zwölf bzw. zehn im Wechsel —
aus dem Datum abgeleitet und damit für alle Spieler dieselben. Belohnt wird in
Gold und Ware: täglich ~200–400 Gold plus Bälle, Tränke oder Werkstoffe,
wöchentlich das Fünf- bis Zehnfache plus Sternenstaub, EP-Bonbons oder eine
Sagenbeere.

### Warum Wiederholungen zählen

Die Wochenaufgaben zählen **jeden** Sieg, auch den fünften über denselben
Arenaleiter. Das ist der Gegenpol zur Tagesregel beim Gold, die das Wiederholen
absichtlich nicht mehr bezahlt: Wiederholen bringt kein Vermögen, aber es
bringt die Woche voran — und damit lohnt sich der Weg zurück in ein altes
Gebiet, statt nur auf dem höchsten Level zu bleiben.

Vier Kampfmetriken unterscheiden dabei, wogegen man antritt: **Arenaleiter**,
**Trainer auf Routen**, **Team Rocket** und **abgeschlossene
Arenadurchläufe**. Ein Arenagegner trägt zwar dieselbe Art wie ein
Routentrainer, steht aber auf keiner Route — er zählt als Durchlauf, nicht als
Trainer.

Gezählt wird über dieselbe Meldung, die schon Erfolge und Gildenziel füttert.
Eine neue Aufgabe braucht deshalb meist nur einen Eintrag in der Liste und
keinen Code an der Stelle, wo etwas passiert.

---

## 20. Saison-Reise

Eine Saison dauert **sieben Tage** und hat **25 Stufen**. Der Zähler oben nennt
die verbleibende Zeit.

| Stufe | 2 | 5 | 10 | 17 | 25 |
|---|---|---|---|---|---|
| Punkte gesamt | 44 | 224 | 684 | 1.664 | 3.264 |

Auf **13 der 25 Stufen** liegt ein Gegenstand, sonst Gold. Die **letzte Stufe**
wirft ein **Schillerndes Seelenfragment** ab — die einzige Quelle dafür.

**So verdienst du Punkte** (steht auch in der App):

| Handlung | Punkte | | Handlung | Punkte |
|---|---|---|---|---|
| Arena bezwingen | 60 | | Kampf gewinnen | 10 |
| Neuer Pokédex-Eintrag | 20 | | Expedition einsammeln | 8 |
| Pokémon entwickeln | 15 | | Raid angreifen | 6 |
| Duell gewinnen | 12 | | Pokémon fangen | 4 |
| Ei ausbrüten | 12 | | Pflegeaktion | 2 |

Jede Quelle ist nach oben begrenzt (siehe Abschnitt 22). Wer an einem Tag
alles macht, was das Spiel hergibt, landet bei rund 3.300 Punkten — etwa einer
Leiterlänge.

---

## 21. Erfolge und Story

**Erfolgsketten** über alle drei Regionen: Arten, Orden, Level, Fänge, Kämpfe,
Zucht.

Die **Reise** hat **je Region eine eigene Kette aus sieben Kapiteln** — 21
insgesamt, geführt vom Professor der jeweiligen Region. Alle Bedingungen zählen
nur, was *in dieser Region* erreicht wurde: ihre Orden, ihre Arten, ihre
Gebiete. Vorher war es eine einzige Kette, die Kanto → Johto → Hoenn voraussetzte
— wer in Hoenn anfing, scheiterte am zweiten Kapitel, weil es den Vertania-Wald
in Kanto verlangte.

Im Reiter steht eine Region auf einmal, wählbar über ein Auswahlfeld; noch
verschlossene Regionen stehen mit Schloss darin. Jede Region zahlt dieselben
Belohnungen — eine Staffelung nach Entwurfsreihenfolge wäre eine Prämie fürs
Anfangen im Osten.

---

## 22. Fairness und Missbrauchsschutz

| Schranke | Wirkung |
|---|---|
| **Mindestabstand** | 180 ms zwischen zwei Handlungen; für Duelle 1,5 s |
| **Duelle** | Höchstens 30 je Viertelstunde — ein Duell rechnet einen ganzen Kampf durch |
| **Fenster** | 100 Pflegeaktionen je 15 Minuten (Pflegestation hebt es) |
| **Rhythmuserkennung** | 12 Proben; liegt die Streuung unter 15 ms, folgen 30 Sekunden Zwangspause |
| **Rate-Limits** | Je Endpunkt und Trainer, 300 schreibende Anfragen je Minute |
| **Tagesregeln** | Wertung, voller Goldbetrag und Saisonpunkte einmal am Tag je Gegner — für Kämpfe wie für Duelle; darüber hinaus bleibt das Antrittsgeld; Entwicklungsertrag zehnmal am Tag |
| **Protokoll** | Jede zustandsändernde Handlung landet im `event_log` — Grundlage für Auswertung und DSGVO-Export |

Der Server ist **autoritativ**: der Client rechnet nichts aus, er schickt
Absichten und zeigt Ergebnisse. Bei PvP, Marktplatz und Rangliste ist das nicht
verhandelbar.

---

## 23. Admin-Werkzeuge

| Befehl | Wirkung |
|---|---|
| `/event <Code> [Art]` | Ereignis-Wesen vergeben — schillernd, makellose Werte |
| `/gegenstand <Code> <Id> [n]` | Beliebigen Gegenstand vergeben |

**Ereignis-Wesen** stehen in keiner Spawn-Tabelle und lassen sich nicht fangen;
der einzige Weg ins Spiel führt über `/event`. Beispiel: das **Prisma-Abra** —
schillernd, eigenes Bild, makellose Werte, kennt das gesamte Lernset der Reihe,
entwickelt sich nie und braucht die doppelte Erfahrung je Level.

Für Spieler: `/spielen`, `/karte`, `/code`, `/browser`, `/hilfe`, in Gruppen
`/gilde` und `/raid`.

---

## 24. Anhang: Schnittstelle

116 Endpunkte unter `/api`, alle hinter der Sitzungsprüfung außer
`/api/health` und der Anmeldung. Die wichtigsten Gruppen:

```
auth      /auth/session  /auth/link/code  /auth/link/redeem  /sessions
garten    /garden  /garden/care  /box  /dex  /bag  /shop  /souls  /plots
welt      /world  /world/travel  /world/scaling  /safari  /safari/explore
kampf     /battle  /battle/start  /battle/action  /battle/event  /center
idle      /expeditions  /eggs  /crafting  /buildings  /evolutions
sozial    /friends  /market  /trades  /leaderboard  /card
koop      /guild  /raids  /pvp  /pvp/duel  /tournament
meta      /season  /achievements  /story  /themes  /energy  /account  /admin
```

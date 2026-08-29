# Funktionen

Was das Spiel kann, Bereich für Bereich, mit den Zahlen dahinter. Wo eine Zahl
eine Entscheidung war, steht die Begründung in **[BALANCE.md](BALANCE.md)**;
wie die Teile geschnitten sind, in **[ARCHITEKTUR.md](ARCHITEKTUR.md)**.

Stand: 3 Regionen · 38 Gebiete · 387 Arten · 502 Attacken · 84 Gegenstände ·
57 Trainer · 26 Orden · 12 Story-Kapitel · 861 Tests.

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

### Einladungen

Kein Trainer ohne **Einladungscode**. Codes erzeugt ein Admin per `/einladen`
(bis zu 50 Nutzungen, 30 Tage gültig), offene Codes zeigt `/codes`. Der Bot
liefert wahlweise einen Deep-Link, der die App direkt mit dem Code öffnet.

---

## 2. Trainer und Konto

| Was | Details |
|---|---|
| **Trainer-Code** | Acht Zeichen in der Form `ABCD-1234`, Freundschafts- und Geschenkadresse |
| **Trainerkarte** | Teilbare Übersicht: Team, Orden, Wertung, Erfolge — auch inline im Chat |
| **Designs** | 14 Farbwelten (eine gratis, 13 für 3.000 bis 40.000 Gold), dazu Tag-/Nacht-Modus, der der Weltuhr folgen kann |
| **Erinnerungen** | Höchstens **eine stille Telegram-Nachricht am Tag**, abschaltbar |
| **Datenschutz** | Vollständiger Export als JSON, endgültige Löschung des Kontos |
| **Admin** | Bannen, Rollen vergeben, Einladungen verwalten, Laufzeit und Zahlen einsehen |

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
- **Skalierung:** Ganze Regionen treffen den Median deines Teams — nach oben
  wie nach unten. Der Versatz wird beim **Betreten eingefroren**, wächst also
  nicht mit dir mit. Abschaltbar.
- **Wetter und Tageszeit** (Europe/Berlin) steuern, welche Arten überhaupt
  erscheinen.

---

## 7. Safari — Erkunden und Fangen

Eine Erkundung kostet **1 Energie** und endet in einer wilden Begegnung, einem
Überfall, einem Legendären oder nichts.

### Fangen

Ball und Beere sind frei wählbar, dazu **Schwächen** und **Beruhigen** (je
zweimal je Begegnung). Die Fangchance steht als Balken über den Knöpfen.

**Jeder achte Fang (12,5 %)** bringt zusätzlich einen Werkstoff: Seidenfaden,
Feinsand, Tautropfen, Eisensplitter, selten Sternenstaub — das Bindeglied
zwischen Erkunden und Werkbank.

### Wer hier lebt

Im Gebiet steht, welche Arten hier vorkommen — **aber nur die, die man hier
schon gesehen hat**, mit ihrem Anteil an den Begegnungen und ihrem Levelband.
Der Rest bleibt eine Zahl („und 2, die dir hier noch nicht begegnet sind"): eine
vollständige Liste wäre kein Entdecken mehr, sondern ein Nachschlagewerk.

Die Anteile gelten für **jetzt**. Arten, die nur nachts oder bei Regen
erscheinen, stehen ausgegraut mit ihrer Bedingung statt mit einer Chance, die
es gerade nicht gibt.

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

### Legendäre

**0,1 % je Erkundung**, und nur in einer Region, die vollständig bezwungen ist.
Fangbar ausschließlich mit **Sagenbeeren** (höchstens drei je Begegnung), die
es nur bei Überfällen gibt.

### Überfälle

**4 % je Erkundung** taucht eine Bande auf. Beute: Gold, Gegenstände, mit 50 %
eine Sagenbeere und mit 70 % zwei bis fünf verschiedene Lockdüfte. Der
**Störsender** (10.000 Gold) erzwingt die nächsten fünf Überfälle.

---

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
| Gold | voll | 15 % (Arena) bzw. 50 % |
| EP | voll | halb |
| Energie | +4 | — |
| Saisonpunkte | 60 (Arena) / 10 | erst am nächsten Tag wieder |

Der Grund steht in BALANCE.md: eine Arena zahlte 60 Punkte je Sieg und ließ
sich beliebig oft herausfordern — 30 Punkte je Energie, während ein Fang 4
gibt.

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

Jeder Kampf kostet die üblichen 2 Energie und zahlt EP wie ein Trainerkampf —
das ist der eigentliche Ertrag. Die **Durchlauf-Prämie zahlt einmal am Tag je
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
6 Pokémon je Auftrag. Jede Art bevorzugt bestimmte Typen im Team. Die Beute hängt an
Art, Dauer und Eignung des Teams. Energie ist hier ein **Beschleuniger**: sie
verkürzt die Wartezeit, statt Voraussetzung zu sein.

---

## 12. Zucht und Eier

Zwei passende Pokémon ergeben ein Ei; **IVs und Naturen werden vererbt**.
Schlüpfen kostet Zeit, die die **Brutstation** um bis zu 50 % verkürzt.

**Drei Brutplätze** im Grundstock, mit der **Brutkammer** in fünf Stufen um je
einen erweiterbar (2.500 Gold × Stufe², Ende bei acht). Die Fragmentliste
sperrt ihre Knöpfe, wenn kein Platz frei ist, und sagt warum.

---

## 13. Entwicklungen

Auslöser: Level, Stein, Freundschaft, Tageszeit. Die Abfrage steht **direkt auf
der Karte des Pokémon** („… jetzt zu … entwickeln? Ja / Nein"), nicht in einem
eigenen Menü.

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

Das Depot ist der einzige mit festem Preis: Platz ist eine Ware, fünfzig Plätze
sind fünfzig Plätze. Alle anderen wirken auf alles Kommende und wachsen deshalb
quadratisch.

---

## 15. Handwerk

**19 Rezepte.** Werkstoffe kommen aus Expeditionen *und* seit neuestem aus dem
Gras (jeder achte Fang).

- **Bälle:** Superball, Hyperball, Netzball, Finsterball, Timerball
- **Medizin:** Hypertrank, Beleber, Top-Genesung, Energydrink
- **Sonstiges:** Goldene Himmihbeere, EP-Bonbon L, Sonderbonbon, Sinelbeeren
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
- **Rangliste** nach Wertung, mit Stufen von Bronze aufwärts
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
- **Raid-Bosse als Karte im Telegram-Gruppenchat**: Der Bot postet, Mitglieder
  treten per Knopf bei, ihre Teams tragen Schaden bei, die Beute verteilt sich
  nach Beitrag. `/gilde` verbindet einen Chat mit der Gilde, `/raid` zeigt
  laufende Raids.

---

## 19. PvP

**Asynchrone Duelle** gegen eine Momentaufnahme des gegnerischen Teams —
niemand muss online sein. Beide Teams treten auf die **niedrigere der beiden
Reisegrenzen** an, damit die Aufstellung entscheidet und nicht die Zahl der
bezwungenen Regionen. Das Ergebnis ist ein abspielbares Replay.

**Wertung und Gold gibt es einmal am Tag je Gegner.** Der zweite Sieg gegen
dieselbe Person wird ausgetragen und aufgezeichnet, zahlt aber nichts mehr —
weder Elo noch Gold noch Saisonpunkte. Niederlagen bleiben unangetastet, damit
die Wiederholung ein Risiko bleibt statt einer risikolosen Wette.

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
| **Mindestabstand** | 180 ms zwischen zwei Handlungen desselben Eimers |
| **Fenster** | 100 Pflegeaktionen je 15 Minuten (Pflegestation hebt es) |
| **Rhythmuserkennung** | 12 Proben; liegt die Streuung unter 15 ms, folgen 30 Sekunden Zwangspause |
| **Rate-Limits** | Je Endpunkt und Trainer, 300 schreibende Anfragen je Minute |
| **Tagesregeln** | Wertung, Gold und Saisonpunkte einmal am Tag je Gegner; Entwicklungsertrag zehnmal am Tag |
| **Protokoll** | Jede zustandsändernde Handlung landet im `event_log` — Grundlage für Auswertung und DSGVO-Export |

Der Server ist **autoritativ**: der Client rechnet nichts aus, er schickt
Absichten und zeigt Ergebnisse. Bei PvP, Marktplatz und Rangliste ist das nicht
verhandelbar.

---

## 23. Admin-Werkzeuge

| Befehl | Wirkung |
|---|---|
| `/einladen [n]` | Einladungscode erzeugen (bis 50 Nutzungen, 30 Tage) |
| `/codes` | Offene Einladungen anzeigen |
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

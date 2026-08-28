# Balance

Alle Stellschrauben an einem Ort. Jede Zahl steht als Konstante in der Engine —
diese Datei sagt, **warum** sie so steht.

## Energie

| | Wert | Ort |
|---|---|---|
| Grundvorrat | 150 | `ENERGY_BASE_CAP` |
| Füllzeit leer → voll | 75 Minuten | `ENERGY_FILL_MINUTES` |
| Daraus: Regeneration | 120/h = **2/min** | `energyPerHour(cap)` |
| Ausbau je Stufe | +25, max. 12 Stufen | `ENERGY_CAP_STEP` |
| Preis der Stufen | 2.000 × Stufennummer, gesamt 156.000 | `energyCapPrice` |

Die Regeneration hängt am **Vorrat**, nicht an einer festen Zahl: ein größerer
Vorrat füllt sich schneller, die Füllzeit bleibt gleich. Voll ausgebaut sind
das 6 Punkte pro Minute — mehr, als man ausgeben kann. Das ist Absicht: Energie
soll früh spürbar sein und sich später *wegspielen* lassen.

| Kosten | | Erträge | |
|---|---|---|---|
| Pflege, Erkundung | 1 | Gewonnener Kampf | +4 |
| Kampf, Raid-Angriff | 2 | Gewonnenes Duell | +5 |
| Duell, Expedition | 3 (2–6) | Entwicklung | +15 |
| | | Raid-Boss besiegt | +20 |
| | | Neuer Orden | +60 |
| | | Gebiet vollständig | +120 |

Kaufbar: 10 Energie für 100 Gold, größere Pakete bis 8 Gold je Punkt.

## Vergessene Kämpfe

Ein Kampf ist rundenbasiert und wartet geduldig — aber nach **zwei Stunden**
ohne Zug gilt er als verlassen und schließt sich ohne Sieger.

Der Grund ist gemessen, nicht theoretisch: wer die App mitten im Kampf
schließt, hatte vorher für immer einen laufenden Kampf, und *alles*, was
„läuft gerade ein Kampf?" prüft, sagte nein — Heilen im Poké-Center, der
nächste Überfall, der nächste Arenaleiter. Ein Kampf von 13:06 Uhr blockierte
so um 19:30 Uhr noch das Heilen, und die Meldung dazu lautete „Das geht gerade
nicht".

## Taktkontrolle

| | Wert |
|---|---|
| Pflegeaktionen je 15 Minuten | 100 |
| Mindestabstand zwischen Klicks | 180 ms |
| Rhythmus: Standardabweichung der letzten 12 Abstände | < 15 ms → 30 s Pause |
| Pflegestation (Ausbau) | +50 Aktionen je Stufe, bis 350 auf Stufe 5 |
| Poké-Center | 10 Minuten, mit der Schwesternstation bis auf 4 (Untergrenze 3) |

Die Pflegestation hebt **nur die Menge**. Mindestabstand und Rhythmusprüfung
bleiben unangetastet — sonst wäre der Ausbau ein käuflicher Freibrief für
Automatik statt Luft für jemanden, der viel von Hand spielt.

Der dritte Punkt ist der eigentliche Schutz. Gemessen wird nicht
Geschwindigkeit, sondern **Gleichmäßigkeit**: ein Skript klickt metronomisch,
eine Hand nicht. Wer genug Jitter einbaut, um durchzukommen, hat keinen Vorteil
mehr.

Die Schwelle stand zuerst bei 35 ms über 8 Abstände, begründet damit, dass eine
Hand um Dutzende Millisekunden schwanke. Am schnellen Ende stimmt das nicht: wer
so schnell tippt, wie es geht, wird *gleichmäßiger*. An den Daten eines echten
Spielers gemessen — 218 ms Mittel, 33,5 ms Streuung — lag eine Hand knapp unter
der alten Schwelle und wurde als Skript behandelt. 15 ms liegt unter allem, was
eine Hand erzeugt, und weit über dem, was ein Timer erzeugt.

Die Zwangspause steht in `pacing_penalties`, und die Abstände davor sind danach
abgegolten. Ohne beides war die angekündigte Zeit eine Falschaussage: ein
abgewiesener Versuch wird nicht mitgeschrieben, also sah die Probe dreißig
Sekunden später dieselben Abstände und wies wieder ab — bis sie nach einer
Viertelstunde aus dem Fenster fielen. Angekündigt: 30 Sekunden. Tatsächlich: bis
zu 15 Minuten.

Die Prüfung läuft bewusst **außerhalb** der Transaktion. Innerhalb nahm der
Rollback der abgewiesenen Aktion die Pause und den Protokolleintrag mit — das
Protokoll, mit dem sich die Schwelle überprüfen lässt, blieb deshalb
ausgerechnet in jedem echten Fall leer.

## Verwerten und Seelenfragmente

| | Wert |
|---|---|
| Fragmente je verwertetem Pokémon | 1 je Typ |
| Fragmente für ein Ei | 15 desselben Typs |
| Fragmente für ein **schillerndes** Ei | 85 desselben Typs |
| Ei enthält | eine zufällige **Grundform** dieses Typs |

Eine Box füllt sich mit Pokémon, die man nicht braucht — und wegwerfen ohne
Gegenwert tut niemand. Verwerten macht daraus Fragmente, zehn davon werden zu
einem Ei derselben Sorte: aus dem, was man nicht braucht, wird ein Weg zu dem,
was man sucht.

Je Typ ein Fragment, nicht je Pokémon eines: ein Zwei-Typen-Pokémon gibt zwei
verschiedene. Das belohnt Vielfalt, ohne die Menge zu verdoppeln — fünfzehn
Feuer-Fragmente brauchen weiterhin fünfzehn Pokémon mit Feuer-Anteil.

Das schillernde Ei kostet fast das Sechsfache. Bei 1:512 im Freien entspricht
ein garantiertes Shiny einem sehr langen Atem; 85 Fragmente sind ein Vorhaben,
kein Nebenbei.

Nur Grundformen schlüpfen. Ein Ei, aus dem eine Entwicklungsstufe käme, wäre
eine Abkürzung um das Aufziehen herum.

Drei Sperren, alle mit demselben Grund — Verwerten ist endgültig: nicht im
Kampf, nicht auf Expedition, und nie das letzte Pokémon.

## Fangserie und Shinys

| | Wert |
|---|---|
| Grundchance | 1 : 512 (0,20 %) |
| je Stufe der Serie | +25 % der Grundchance |
| Höchststufe | 40 → 2,15 % |

Die Serie zählt **nur für die Art, die man jagt**. Vorher galt der Zuschlag für
jede Begegnung: wer Abra 45-mal hintereinander fing, traf auch überall sonst
elfmal häufiger auf Schillernde — und musste sie wegwerfen, weil es die falsche
Art war. Genau so ist es gemeldet worden. Der Fehler kostete nichts an Zahlen,
nur an Sinn: eine Jagd, die einem alles außer dem Gesuchten schenkt.

Die Safari zeigt die Serie jetzt an: Art, Stand, die Chance daraus und wie weit
es noch bis zur Höchststufe ist.

## Expeditionen vorziehen

Zehn Minuten je Energiepunkt. Die kurze Reise (30 min) kostet damit 3 Punkte,
die lange (8 h) 48 — teuer genug, dass es eine Entscheidung bleibt.

Kein Verkauf von Fortschritt: Energie füllt sich von selbst, sie fehlt dann nur
beim Erkunden. Wer beschleunigt, verschiebt also, statt zu kaufen.

## Poké-Beet

| | Wert |
|---|---|
| Beete | 4 |
| Wachstumszeit | 4 Stunden, 4 Pflegeschritte |
| Ohne Pflege | +50 % |
| Volle Handpflege | +100 % |
| Pflanzen-Pokémon | 50 % + ½ je Level (Lv 100 = 100 %) |
| Gegenstände je Beet | max. 30 |
| **Gold je Beet** | **max. 500, einmal je 24 h** |

Beim Gold wurde zweimal nachgeschärft: 2.000 ohne Sperre wären bis zu 48.000
Gold am Tag gewesen — mehr als jede andere Einnahmequelle zusammen. Jetzt sind
es höchstens 500 Gold Gewinn pro Tag. Die Sperre hängt am Zeitpunkt des
Eingrabens, nicht am Zustand des Beetes: früh ernten und neu pflanzen umgeht
sie nicht.

## Poké-Center

| | Wert |
|---|---|
| Abklingzeit | 15 Minuten |
| Geldfund | 5 % · 60–400 Gold ×(1 + 0,25 je Orden) |
| Geschenk | 5 % · 1–15 Stück je nach Wert |
| Tauschangebot | 1,5 % |
| Ereignislos | 88,5 % |

Ein Wurf entscheidet, nicht drei nacheinander — sonst hätten spätere Ereignisse
real weniger Chance als ihre Zahl behauptet.

Die Stückzahl eines Geschenks fällt aus dem **Preis** des Gegenstands
(`450 / Wert`, geklemmt auf 1–15). Ein neues Item im Pack ist damit automatisch
richtig einsortiert.

## Überfälle und Legendäre

| | Wert |
|---|---|
| Überfall je Erkundung | 4 % |
| Sagenbeere beim Sieg | 50 % |
| Pokémon mit makellosen Werten | 3 % |
| **Legendäres finden** | **0,1 %**, nur in bezwungener Region |
| Legendäres fangen, ohne Beeren | 5 % |
| je Sagenbeere | +25 %, höchstens 3 → 80 % |

Gegen ein Legendäres wirken **weder Bälle noch Schwächen noch Beruhigen**. Nur
Sagenbeeren, und die gibt es nur aus Überfällen. Die Rechnung: ein Legendäres
alle ~1.000 Erkundungen, drei Beeren aus ~6 gewonnenen Überfällen, also
~150 Erkundungen. Wer vorbereitet ist, hat die Beeren längst; wer unvorbereitet
darauf trifft, verliert es vermutlich.

## Lockdüfte und Störsender

| | Wert |
|---|---|
| Lockduft je Typ | 50 Gold für 5 Erkundungen |
| Gewicht des gesuchten Typs | ×4 |
| Störsender | 10.000 Gold, 5 Erkundungen mit garantiertem Überfall |
| Überfall wirft Lockdüfte ab | 70 %, dann 2–5 Stück verschiedener Arten |

Der Faktor 4 ist bewusst kein Bestellschein: in einem Gebiet, in dem ein Viertel
der Spawn-Tabelle den Typ trägt, macht er daraus gut die Hälfte. Wo der Typ gar
nicht vorkommt, bleibt der Duft wirkungslos — er zaubert nichts herbei, was dort
nicht lebt. Verbraucht wird er **vor** dem Wurf, sonst wäre er ein Wunschautomat:
fände man nichts Passendes, bliebe die Anwendung erhalten.

Der Störsender kauft Geduld ab. Überfälle sind die einzige Quelle für
Sagenbeeren und kommen mit 4 % je Erkundung — im Schnitt also alle 25. Die
Ladung wird nur verbraucht, wenn wirklich ein Gegner zustande kommt.

## Ereignisgegner treten auf Augenhöhe an — knapp darunter

Ein Überfall hat keinen Ort im Entwurf — er passiert dort, wo man gerade
erkundet, quer durch alle Regionen. Feste Level wären deshalb immer für
jemanden falsch: dieselbe Truppe träfe den einen als Wand und den anderen als
Übung. Das Team richtet sich am **Median des eigenen Teams** aus, um zwei
Level nach unten versetzt und mit ±3 gestreut — der Schwächste fünf darunter,
der Stärkste einen darüber. Und es tritt **nie mit mehr Gegnern an, als man
selbst dabeihat**. Wer die Skalierung abschaltet, bekommt die Entwurfswerte.

Beides ist gemessen, nicht geschätzt. Simulierte Überfälle (ohne Items, ohne
kluges Wechseln — echte Spieler liegen also höher):

| Teamgröße | genau auf dem Median, 3 Gegner | −2 und Gegner ≤ Team |
|---|---|---|
| 2 | 26 % | 77 % |
| 3 | 31 % | 35 % |
| 4 | 36 % | 53 % |
| 6 | 76 % | 99 % |

Der Ausreißer bei drei ist ehrlich: das simulierte Dreierteam besteht aus
Raupy, Hornliu und Taubsi. Drei schwache Arten bleiben drei schwache Arten.

Ein Überfall unterbricht das Erkunden — er soll ein Kampf sein, den man meistens
gewinnt, kein Boss.

## Skalierung

Gebiete und Trainer treffen den **Median** des aktiven Teams. Der Median, nicht
das stärkste Mitglied: ein Team aus 5/5/5/5/90 hat den Durchschnitt 22, eine
Zahl, die auf kein einziges davon zutrifft. So macht ein getauschtes
Level-90-Pokémon nicht die ganze Welt unspielbar.

Der Versatz hat **zwei Teile**, und sie beantworten verschiedene Fragen:

| Teil | Frage | Bezug | Richtung |
|---|---|---|---|
| Region senken | Darf ein Anfänger in Johto anfangen? | Eingang der Region, **beim ersten Betreten** | nur nach unten |
| Gebiet heben | Lohnt es sich, Route 1 ewig abzugrasen? | das Gebiet selbst, **heute** | nur nach oben |

Die Trennung ist teuer bezahlt. Ein einziger Versatz, der auch nach oben geht
und aus dem heutigen Teamlevel folgt, zieht die ganze Region mit: der Spieler
steigt von 5 auf 40, und das Indigo-Plateau steigt von 64 auf 98 mit. Die
eigene Liga wäre nie erreichbar. Deshalb wird der Teil nach unten **einmal**
festgeschrieben — beim ersten Schritt in die Region — und danach nie wieder
angefasst (`region_entries`). Nach oben bewegt sich jedes Gebiet für sich, und
ein Gebiet, das ohnehin über dem Spieler liegt, bewegt sich gar nicht.

Die Regel in einem Satz: **eine Region empfängt dich auf deinem Niveau und
wächst dann nicht mehr mit dir — du wächst in sie hinein.**

Johto beginnt im Entwurf bei Level 58; wer dort mit Level 5 anfängt, findet
Route 29 auf 2–8 und den Silberberg auf 28–38 vor. Das schwächste Gebiet fällt
nie unter Level 2.

Trainer erben den Versatz **ihres Gebiets**, nicht ihren eigenen: der Rivale
steht im Entwurf zwei Level unter der Obergrenze seiner Route, ein Arenaleiter
darüber. Diese Abstände sind die Aussage des Entwurfs.

Abschaltbar auf der Weltkarte.

## Gebiete freischalten

Verlangt wird, was im **Pokédex** steht, nicht was im Vorgängergebiet gefangen
wurde. Vorher musste man auf Route 2 noch einmal ein Taubsi fangen, obwohl auf
Route 1 schon eines im Beutel war — dieselbe Art, nur woanders.

Die Schwellen sind eine Formel, keine 38 Handzahlen: Sockel je Region plus ein
Schritt je Gebiet.

| Region | Gebiet 2 | Schritt | letztes Gebiet |
|---|---|---|---|
| Kanto | 0 | +7 | 91 |
| Johto | 80 | +6 | 128 |
| Hoenn | 150 | +6 | 216 |

Das **erste** Gebiet einer Region verlangt nichts: dort steht schon die
Regionssperre.

## Regionssperre

Eine neue Region betritt nur, wer seine aktuelle bezwungen hat — alle Orden,
Top Vier und Meister. Die Startregion bleibt frei wählbar; gesperrt ist der
*Wechsel*, nicht der Anfang. Eine Region, die man schon betreten hat, bleibt
offen, damit niemand ausgesperrt wird, der zurückreisen will.

Ohne diese Sperre wären die Regionen ein Buffet: man pickt sich aus jeder die
leichten Gebiete und lässt die Ligen liegen.

## Reisegrenze

Die einzige Zahl, die sagt, wie weit jemand gekommen ist:

| Bezwungene Regionen | Grenze |
|---|---|
| 0 (Start) | 100 |
| 1 | 150 |
| 2 | 200 |
| … | +50 je Region |
| 8 | 500 (absolutes Ende) |

Der Startwert ist 100 und nicht 50, und das ist gemessen: Kantos Champion tritt
mit Level 78–84 an, Johtos Meister mit 90. Eine erste Grenze von 50 machte die
erste Liga nicht schwer, sondern unmöglich — auch das perfekte Team bliebe
dreißig Level darunter. Die erste Region gibt deshalb den Spielraum, den ihr
Inhalt verlangt; die Leiter beginnt danach.

Bezwungen heißt: **alle Orden der Region plus ihr Meister**. Bewusst an
bezwungene Regionen gebunden, nicht an betretene — sonst tourte man neun
Regionen auf Level fünf ab und hätte die Grenze geschenkt.

Die Grenze steht nirgends gespeichert; sie folgt aus Orden und Siegen. Eine
gespeicherte Grenze wäre eine zweite Wahrheit, die beim nächsten
Content-Wechsel falsch wird.

Sie wirkt an drei Stellen: EP laufen an ihr nicht weiter (sonst säße man nach
der nächsten Region schlagartig auf zwanzig geschenkten Leveln), die Skalierung
hebt kein Gebiet darüber hinaus, und im Duell gilt die **niedrigere** der
beiden Grenzen — ein Duell soll über die Aufstellung entscheiden, nicht über
Reisekilometer.

## Levelkurve

| Region | Von | Bis | Meister |
|---|---|---|---|
| Kanto Route 1 → Indigo-Plateau | 2 | 64 | 78–84 |
| Kanto nach der Liga | 60 | 78 | — |
| Johto Route 29 → Silberberg | 58 | 94 | 86–90 |
| Johto nach der Liga | 86 | 100 | — |
| Hoenn Route 101 → Siegesstraße | 96 | 146 | 150–156 |
| Hoenn nach der Liga | 138 | 150 | — |

Hoenn ist als eigene Stufe entworfen, nicht als Fortsetzung: gedacht für
jemanden, der Kanto und Johto hinter sich hat. Wer Hoenn als Erstes wählt,
findet sie um 94 Level gesenkt vor — Route 101 auf 2–8, den Meister auf 62 —
und bleibt damit innerhalb seiner ersten Reisegrenze von 100.

Das sind die **Entwurfslevel**. Wer Johto zuerst wählt, spielt dieselben
Gebiete auf sein eigenes Niveau gesenkt; die Abstände zwischen ihnen bleiben.

Jenseits von Level 100 gelten die Originalformeln nicht mehr — sie sind dort
nicht definiert, und zwei von ihnen brechen zusammen: `erratic` enthält den
Faktor (160 − n) und fällt ab Level 160 ins Negative. Eine EP-Kurve, die fällt,
bedeutet Level, die man durch Kämpfen *verliert*. Ab 101 wird deshalb der Wert
bei 100 kubisch fortgeschrieben. Für die polynomialen Kurven ist das exakt
dieselbe Zahl wie zuvor (n³ = 100³·(n/100)³), für die beiden Sonderkurven die
naheliegende Fortschreibung ihres Aufwands.

## Startregion

Jede Region, deren erstes Gebiet keine Vorbedingung hat, ist ein möglicher
Anfang — heute Kanto und Johto. Die Wahl setzt nur, wo man aufwacht: gereist
wird überallhin.

## Wo die Zahlen stehen

```
packages/engine/src/energy.ts     Energie, Pakete, Ausbau
packages/engine/src/pacing.ts     Taktkontrolle
packages/engine/src/planting.ts   Beet
packages/engine/src/center.ts     Poké-Center
packages/engine/src/league.ts     Top Vier, Überfälle, Legendäre
packages/engine/src/scaling.ts    Levelskalierung
packages/engine/src/care.ts       Pflege
packages/engine/src/encounter.ts  Fangformel, Spawns
```

Jede dieser Dateien ist rein und getestet. `npm run simulate` rechnet die
Kurven über 400 Spieltage durch und meldet, wenn etwas aus dem Ruder läuft.

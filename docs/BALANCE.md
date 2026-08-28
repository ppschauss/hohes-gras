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

## Taktkontrolle

| | Wert |
|---|---|
| Pflegeaktionen je 15 Minuten | 100 |
| Mindestabstand zwischen Klicks | 180 ms |
| Rhythmus: Standardabweichung der letzten 8 Abstände | < 35 ms → 30 s Pause |

Der dritte Punkt ist der eigentliche Schutz. Gemessen wird nicht
Geschwindigkeit, sondern **Gleichmäßigkeit**: ein Skript klickt metronomisch,
eine Hand schwankt um Dutzende Millisekunden. Wer genug Jitter einbaut, um
durchzukommen, hat keinen Vorteil mehr.

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

## Reisegrenze

Die einzige Zahl, die sagt, wie weit jemand gekommen ist:

| Bezwungene Regionen | Grenze |
|---|---|
| 0 (Start) | 50 |
| 1 | 100 |
| 2 | 150 |
| … | +50 je Region |
| 9 | 500 (absolutes Ende) |

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

| Region | Von | Bis |
|---|---|---|
| Kanto Route 1 → Indigo-Plateau | 2 | 64 |
| Kanto nach der Liga | 60 | 78 |
| Johto Route 29 → Silberberg | 58 | 94 |
| Johto nach der Liga | 86 | 100 |

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

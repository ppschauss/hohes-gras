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

Gebiete und Trainer heben ihr Level auf den **Median** des aktiven Teams — nie
darunter. Der Median, nicht das stärkste Mitglied: ein Team aus 5/5/5/5/90 hat
den Durchschnitt 22, eine Zahl, die auf kein einziges davon zutrifft. So macht
ein getauschtes Level-90-Pokémon nicht die ganze Welt unspielbar.

Trainer erben den Versatz **ihres Gebiets**, nicht ihren eigenen: der Rivale
steht im Entwurf zwei Level unter der Obergrenze seiner Route, ein Arenaleiter
darüber. Diese Abstände sind die Aussage des Entwurfs.

Abschaltbar auf der Weltkarte.

## Levelkurve

| Region | Von | Bis |
|---|---|---|
| Kanto Route 1 → Indigo-Plateau | 2 | 64 |
| Kanto nach der Liga | 60 | 78 |
| Johto Route 29 → Silberberg | 58 | 94 |
| Johto nach der Liga | 86 | 100 |

Johto setzt bei 58 an, wo Kanto bei 64 endet. Eine zweite Region, die wieder
bei Level 5 anfängt, macht alles zunichte, was der Spieler aufgebaut hat.

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

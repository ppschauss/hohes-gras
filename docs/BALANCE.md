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
| Pflege, Erkundung | 1 | Erster Sieg über einen Gegner | +4 |
| Kampf, Raid-Angriff | 2 | Gewonnenes Duell | +2 (Einsatz: 3) |
| Duell, Expedition | 3 (2–6) | Entwicklung | +15 |
| | | Raid-Boss besiegt | +20 |
| | | Neuer Orden | +60 |
| | | Gebiet vollständig | +120 |

Kaufbar: siehe „Energie kaufen".

**Ein Duell kostet mehr, als es zahlt.** 3 Energie Einsatz, 2 zurueck beim
Sieg. Vorher waren es 5 — wer gewinnt, gewann damit auch Energie, und PvP wurde
zur zweiten Druckerpresse neben den Wiederholungskämpfen. Der Sieg federt den
Einsatz jetzt ab, statt ihn zu übertreffen.

**Energie gibt es einmal je Gegner, nicht je Kampf.** Ein Kampf kostet 2 und gab
4 zurück — auch beim hundertsten Mal gegen denselben Trainer. Wer die Skalierung
nach unten drückte und in einem Anfangsgebiet alles mit einem Schlag erledigte,
machte daraus einen Automaten. Der erste Sieg zahlt weiterhin, die Wiederholung
gibt Gold und EP, aber keine Energie mehr.

## Saison-Reise

Eine Saison dauert **sieben Tage** (vorher 28) und hat **25 Stufen** (vorher 30).
Die Stufen kosten `40·n + 4·n²` Punkte (n = Stufe − 1): 44 für die zweite, 228
für die letzte, insgesamt 3.264. Das ist an echten Werten gemessen — ein
gelegentlicher Spieler kommt auf rund 450 Punkte am Tag, kommt also in der
Woche gerade durch; ein sehr aktiver ist nach gut einem Tag durch. Auf 13 der
25 Stufen liegt ein Gegenstand, sonst Gold.
Vier Wochen waren zu lang, um ein Ziel zu sein: wer in Woche eins zurückfiel,
holte den Rest nicht mehr auf, und wer vorne lag, hatte drei Wochen nichts mehr
zu tun.

Die **letzte Stufe** wirft ein **Schillerndes Seelenfragment** ab — die einzige
Quelle dafür. **Fünf** davon werden zu einem schillernden Ei eines frei
wählbaren Typs, also fünf durchgespielte Wochen. Der alte Weg über 85
gleichfarbige Fragmente bleibt bestehen; wer schillernde Fragmente hat, zahlt
automatisch mit ihnen.

### Wogegen der Pass abgesichert ist

Saisonpunkte gibt es **einmal am Tag je Gegner** — für Arenen wie für
Trainerkämpfe. Vorher zahlte ein Arenaleiter 60 Punkte *je Sieg*, und Arenen
lassen sich beliebig oft herausfordern: mit einem ausgewachsenen Team sind das
30 Punkte je Energie, während ein Fang 4 gibt und eine Pflegeaktion 2. Die
ganze Leiter wäre ein Nachmittag gegen denselben Gegner gewesen. Im Protokoll
stand die Vorstufe davon schon: 250 Wiederholungssiege gegen einen einzigen
Käfersammler.

Entwicklungen zahlen Punkte nur für die ersten **zehn am Tag** — dieselbe
Grenze, die schon für die Energie gilt. Gemessen: 335 Entwicklungen an einem
Tag, zu je 15 Punkten sind das 5.025 und damit mehr als eine ganze Leiter.

Damit ist jede Punktquelle nach oben begrenzt: wer an einem Tag alles macht,
was das Spiel hergibt, landet bei rund 3.300 Punkten — ungefähr einer
Leiterlänge. Alles andere braucht die Woche.

## Lernsätze

Der Import nahm bis hierher genau **eine Spielversion**: die erste aus einer
Prioritätsliste, in der eine Art überhaupt vier Attacken per Levelaufstieg
lernt. Alles andere fiel weg — gemeldet als „die Pokémon lernen nicht alle
Attacken, die sie eigentlich lernen könnten", und gemessen stimmte das.

Jetzt zählen **alle Versionen zusammen**, je Attacke das niedrigste Level:

| | Ø je Art | Median | max | Arten unter 8 Attacken |
|---|---|---|---|---|
| vorher | 14,2 | 15 | 24 | 35 |
| jetzt | 18,6 | 19 | 37 | 19 |

Keine Art hat dabei verloren: die neue Menge ist eine Obermenge der alten, und
Level können nur sinken. Glurak geht von 17 auf 23, Garados von 13 auf 24,
Woingenau von 2 auf 6. Ditto bleibt bei 1 — es lernt nun einmal nur Wandler.

**Maschinen- und Lehrer-Attacken bleiben draußen.** Sie wären gemessen weitere
62 je Art, tragen aber kein Level: sie würden die Staffelung nicht füllen,
sondern ersetzen. Ein Glumanda auf Level 5 mit Erdbeben ist kein reicheres
Lernset, sondern gar keins mehr.

## Freischaltung: zwei Drittel statt einer Stufenzahl

Die Dex-Schwelle je Gebiet war eine Formel mit festem Schritt — Kanto sieben
Arten je Gebiet, Johto und Hoenn sechs. Nachgerechnet gegen das, was in den
vorherigen Gebieten überhaupt vorkommt:

| Region | Gebiet | erreichbar | gefordert |
|---|---|---|---|
| Kanto | 8 | 36 | **42** |
| Kanto | 15 | 84 | **91** |
| Hoenn | 8 | 42 | 36 (86 %) |

In Kanto war es ab dem fünften Gebiet **unlösbar**: die Schwelle verlangte mehr
Arten, als es gab. In Hoenn brauchte man 86 % des Erreichbaren — damit ist jede
wetter- oder tageszeitgebundene Art Pflicht, und genau daran hing „34/36 Arten,
das ist zu präsent".

Jetzt sind es **zwei Drittel des Erreichbaren**. Das lässt Luft für die
seltenen, die bedingten und die übersehenen Arten, und es rechnet sich selbst
nach, wenn sich der Inhalt ändert. Hoenns achtes Gebiet fordert damit 28 statt
36.

## Raids: an der Gruppe gemessen, die es gibt

Die Zielgrößen waren **zwei, fünf und zehn** Trainer mit vollem Team — gedacht
als „eine Gruppe von Freunden statt einer großen Gilde", und trotzdem zu groß.
Gespielt wird hier zu viert: Stufe 3 verlangte fünf und Stufe 5 zehn, also
waren zwei von drei Stufen unerreichbar, egal wie gut jemand spielt.

Jetzt **einer, zwei, vier**. Stufe 1 schafft man allein, Stufe 5 braucht die
ganze Runde. Dieselbe Staffelung, nur an der wirklichen Gruppe gemessen.

## Antrittsgeld

Ganz ohne Ertrag blieb der Wiederholungskampf trotzdem falsch: gekämpft hat man
schließlich. Jeder ausgefochtene Kampf zahlt deshalb ein **Antrittsgeld** von
10 Gold je aufgewendeter Energie — 20 für einen Trainerkampf, und bei Duellen
ist es derselbe Betrag, den auch eine Niederlage einbringt. Es gibt ihn auch,
wenn man verliert; die Energie ist so oder so weg. Nur beim Aufgeben nicht,
sonst wäre Anfangen-und-Abbrechen der schnellste Weg dazu.

Der Satz ist am unteren Ende der Wirtschaft angesetzt: ein erster
Arenadurchlauf bringt je Energie das Acht- bis Vierunddreißigfache, ein erster
Sieg über einen Trainer ein Vielfaches davon. Dieselben 250 Wiederholungssiege,
die einmal 88.445 Gold brachten, wären damit 5.000 — spürbar, aber nie die
beste Art, an Gold zu kommen.

## Handwerk und Fundstücke

Jeder achte Fang (**12,5 %**) bringt einen Werkstoff mit — Seidenfaden,
Feinsand, Tautropfen, Eisensplitter, selten Sternenstaub. Vorher kamen
Werkstoffe ausschließlich von Expeditionen, und damit war die häufigste
Handlung des Spiels von der Werkbank abgeschnitten.

24 Rezepte statt 6 — fünf davon erst durch Forschung. Die neuen zielen auf
genau diesen Kreislauf: Bälle und
Medizin aus Fundstücken, und **Entwicklungssteine aus Seelenfragmenten** (8
Fragmente der passenden Sorte + 2 Sternenstaub + 500 Gold, Labor Stufe 2). Im
Laden kosten dieselben Steine 1.500 Gold — hier kostet es Arbeit statt
Kontostand.

Am weitesten geht das **Verbindungskabel**: 6× Eisensplitter, 3× Seidenfaden,
1× Sternenstaub und 800 Gold, das Rezept erst nach der Forschung (Labor
Stufe 2). Es hat bewusst keinen Ladenpreis, und ein Kabel reicht für genau eine
Entwicklung. Elf Arten hängen daran — sie waren vorher gar nicht erreichbar,
weil sie im Vorbild einen Tauschpartner brauchen, der auch zurücktauscht. Der
Preis ist deshalb absichtlich in Expeditionen bemessen und nicht in Gold: Gold
hat, wer lange spielt, Eisensplitter hat, wer *fährt*.

## Kapazitäten und ihr Ausbau

| Was | Grundstock | Ausbau | je Stufe | Preis | Ende |
|---|---|---|---|---|---|
| Box | 900 | Depot, 25 Stufen | +50 Plätze | 5.000 (fest) | 2.150 |
| Brutplätze | 3 | Brutkammer, 5 Stufen | +1 Ei | 2.500 · Stufe² | 8 |

Das Depot hat als einziger Ausbau einen festen Preis: Platz ist eine Ware,
fünfzig Plätze sind fünfzig Plätze. Die Brutkammer wächst quadratisch, weil ein
Brutplatz mehr keine Ablage ist, sondern eine weitere Brut, die *gleichzeitig*
läuft.

## Vergessene Kämpfe

Ein Kampf ist rundenbasiert und wartet geduldig — aber nach **zwei Stunden**
ohne Zug gilt er als verlassen und schließt sich ohne Sieger.

Der Grund ist gemessen, nicht theoretisch: wer die App mitten im Kampf
schließt, hatte vorher für immer einen laufenden Kampf, und *alles*, was
„läuft gerade ein Kampf?" prüft, sagte nein — Heilen im Poké-Center, der
nächste Überfall, der nächste Arenaleiter. Ein Kampf von 13:06 Uhr blockierte
so um 19:30 Uhr noch das Heilen, und die Meldung dazu lautete „Das geht gerade
nicht".

## Überschüssige Energie wird Gold

Über **1.000 Energie** wird jeder weitere gutgeschriebene Punkt zu **1 Gold**.
Die größte persönliche Obergrenze liegt bei 510 (150 + 12 Ausbaustufen +
Gewächshaus) — tausend Punkte sind also schon ein Vorrat für mehrere Tage.
Vorher stapelte sich Energie bis zur harten Grenze von 9.999 und war darüber
schlicht weg: ein Spieler hat für 170.000 Gold Energie gekauft, von der über
die Hälfte im Moment der Gutschrift verschwand, ohne dass irgendwo etwas davon
stand.

Der Kurs ist bewusst schlecht — gekauft kostet ein Punkt 10 bis 13 Gold. Er
ist keine Anlage, sondern eine Quittung: nichts verschwindet mehr stillschweigend.
Deshalb steht im Laden jetzt auch vor dem Kauf, wie viel einer Packung sofort
wieder zu Gold würde.

## Energie kaufen

| Packung | Energie | Gold | je Punkt |
|---|---|---|---|
| klein | 10 | 130 | 13 |
| mittel | 50 | 575 | 11,5 |
| groß | 200 | 2.000 | 10 |

Der Preis je Punkt fällt mit der Menge, damit die große Packung eine
Entscheidung bleibt und nicht bloß die kleine mal zwanzig. Angehoben von
10/9/8: Energie war das billigste Mittel gegen jede Wartezeit — und was jede
Wartezeit aufhebt, darf etwas kosten.

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

## Energie fürs Entwickeln

Die ersten **zehn Entwicklungen am Tag** bringen Energie (je 15), danach gibt es
für weitere keine mehr. Entwickeln selbst bleibt unbegrenzt.

Im Code stand einmal, eine Entwicklung sei „eine ehrliche Energiequelle: sie
lässt sich nicht farmen". Das galt, solange Entwicklungen selten waren — mit
Eiern, Bonbons und einer vollen Box entwickelt man zwanzig am Stück. Der Deckel
nimmt dem Fortschritt nichts, nur die Energie; wer mehr braucht, kauft sie.

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

| Fangserie | Shiny-Chance |
|---|---|
| 0 | 0,20 % (1 : 512) |
| 10 | 1,8 % |
| 20 | **10 %** |
| 30 | 28 % |
| 40 | 59 % |
| 48 | 95 % |
| **49** | **100 % — der fünfzigste Fang glänzt sicher** |

Die Kurve ist kein Geschmackswert: sie hängt an zwei Zusagen — zehn Prozent bei
zwanzig Fängen, Sicherheit beim fünfzigsten. Der Exponent dazwischen folgt aus
beiden und steht als Rechnung im Code, nicht als Zahl. Geändert wird an den
Ankern.

Sie steigt spät und dann steil, und auch das ist Absicht: eine flache Kurve
wäre ein Rabatt, diese hier ist ein Ziel.

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

## Fundstücke und der Metalldetektor

Drei Prozent je Erkundung heißt: etwa jede dreiunddreißigste, also mehrmals am
Tag, aber nie so oft, dass man aufhört hinzusehen. Dasselbe gilt für den
Streuner.

Beim Detektor war die Frage nicht die Häufigkeit, sondern der Inhalt. Zehn
Anwendungen für 500 Gold sind 50 Gold je Fund; ein Münzbeutel bringt im Schnitt
422. Mit dem Anteil des Zufallsfundes (28 %) läge der Erwartungswert bei 118
Gold je Anwendung — das Gerät hätte sich selbst vervielfacht, und bei 1.000
Energie am Tag wäre es die beste Goldquelle des Spiels gewesen.

Deshalb hat der Detektor eine eigene Verteilung: 10 % Münzen statt 28 %, dafür
mehr Ware und Fragmente. Damit liegt sein Goldertrag bei rund 42 je Anwendung
und deckt gerade die 50, die er kostet. Er kauft **Fortschritt statt Guthaben**
— und das ist auch das, wonach ein Detektor piept.

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
selbst dabeihat**.

**Auch wer die Skalierung abschaltet.** Das war einmal anders — mit der
Begründung, wer die Entwurfswerte will, solle sie überall bekommen. Für ein
Gebiet stimmt das: es hat einen Ort und ein entworfenes Niveau, an dem man
hängen kann. Ein Überfall hat beides nicht. Im echten Spiel stand deshalb eine
Rocket-Truppe auf Level 42 bis 46 vor einem Team auf 25, und ausweichen ließ sie
sich nicht — die Einstellung galt für Gebiete, traf aber etwas, das keines ist.

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

**Der Schalter regelt nur den Teil nach oben.** Er hieß immer „Gebiete behalten
ihre Entwurfslevel, frühere Routen bleiben leicht" und tat zwei Dinge: das —
und er nahm jeder Region ihren Einstieg. Die entworfenen Bänder sind nämlich
eine Kette:

| Region | Eingang | Ende |
|---|---|---|
| Kanto | 2–6 | 66–78 |
| Johto | 58–64 | 90–100 |
| Hoenn | 96–102 | 146–150 |

Hinter dem ausgeschalteten Schalter stand damit ein Johto ab Level 58 und ein
Hoenn ab Level 96. Wer ihn umlegte, verlor die freie Wahl der Startregion, ohne
dass irgendwo stand, dass er das täte — und ein Überfall, der zu keinem Gebiet
gehört, fiel gleich mit auf seine Entwurfswerte zurück.

Jetzt gilt: **eine Region empfängt einen immer auf dem eigenen Niveau.** Das ist
keine Geschmacksfrage, sondern die Bedingung dafür, dass es drei Startregionen
gibt. Der Schalter entscheidet nur noch, ob die Gebiete danach mitwachsen — aus
heißt „du wächst in die Region hinein und lässt sie hinter dir", an heißt „sie
bleibt fordernd".

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


## Expeditionen und Bälle

Der Anlass war das Verbindungskabel: es braucht sechs Eisensplitter, und eine
**achtstündige Grabung mit perfektem Team gab 2,5**. Zwanzig Stunden Graben für
ein Kabel, an dem elf Arten hängen — das ging nicht.

Zwei Ursachen, beide gemessen:

**Die Züge waren zu wenige und zu flach.** Gerechnet wurde `1 + yieldFactor/6`.
Bei der kurzen Reise kamen für ein mieses (0,7 Qualität) und ein perfektes Team
1,17 bzw. 1,42 heraus — beide runden auf 1. Wen man mitschickte, war also für
die Beute völlig gleich, und das war der Mechanik nicht anzusehen. Jetzt steht
die Zahl ausdrücklich in der Dauer: 2 / 5 / 10 Züge, mal `0,5 + Bewertung/2`.

**Die Mengen je Zug waren klein.** Materialien liegen jetzt bei 2–6 statt 1–3;
die Patrouille wirft 5–12 Pokébälle statt 2–5 aus.

Gemessen danach, jeweils volles Team:

| Reise | vorher | nachher |
|---|---|---|
| Graben 8 h | 2,5 Eisensplitter | **13,6** |
| Patrouille 8 h | 3,3 Pokébälle | **22,1** |
| Graben 30 min | 0,7 Eisensplitter | **2,7** |

Gold blieb unangetastet. Es war nie der Engpass — 680 Gold aus einer langen
Grabung standen 2,5 Splittern gegenüber, und das Verhältnis war die eigentliche
Schieflage: Material war knapp, Gold war es nie.

### Warum die Bälle daran hängen

Fünfzig Superbälle kosten 48 Pokébälle und 12 Eisensplitter — **eine** lange
Grabung deckt die Splitter. Vorher hätte dieselbe Menge acht Grabungen
gebraucht, also über zwei Tage für eine Ladung Bälle.

Der **Pokéball** ist jetzt selbst herstellbar. Vorher stand er nur im Laden,
und weil jedes andere Ballrezept Pokébälle verbraucht, hing die ganze Kette
doch wieder am Gold. Fünfzig Stück: 16 Eisensplitter + 8 Seidenfaden + 400 Gold
gegen 1.500 Gold im Laden. Wer fährt, zahlt weniger als wer nur reich ist —
und genau dafür sind die Expeditionen da.

Der Mengenrabatt (25 → 2,25×, 50 → 4×) ist der kleinere Teil. Der Grund für die
Chargen ist, dass zehnmal derselbe Knopf keine Entscheidung ist.

### Die Typensperre

Der Typ war ein Bonus (1,4×) und ist jetzt Bedingung. Der Preis dafür war, die
Typenlisten zu weiten: vorher kamen Feuer, Gift, Geist, Drache, Unlicht und Fee
in **keiner** der vier Arten vor, und die Sperre hätte 58 der 390 Arten
ausgesperrt — darunter jeden Feuer-Starter. Nachgezählt an einem echten
Spielstand: von 104 Pokémon passt jetzt jedes auf mindestens eine Expedition.

Weil der Typmultiplikator wegfällt, zählen nur noch Level und Ausdauer — und
die volle Bewertung gibt es schon bei **vier** passenden statt sechs. Sechs
gleichtypige früh im Spiel zu haben ist unrealistisch, und eine Sperre, die
zusätzlich die Ausbeute drückt, wäre zweimal dieselbe Strafe.


## Erholung: die Box als Ruheplatz

**100 Ausdauerpunkte je Stunde in der Box, 6 im Team.** Leer bis voll: eine
Stunde gegen siebzehn.

Der Abstand ist Absicht und nicht Großzügigkeit. Die Box war bisher Verwahrung;
mit voller Erholung in einer Stunde wird sie zur zweiten Seite einer echten
Entscheidung — ein Pokémon, das gerade nicht gebraucht wird, gehört dorthin,
und man bekommt es ausgeruht zurück. Im Team *arbeitet* es, und dort bleibt
Ausdauer knapp.

### Der Fehler darunter

Die Rate allein hätte nichts geändert. Die Erholung hing an `last_seen_at` —
demselben Zeitstempel, den jede Anfrage neu setzt. Unter zehn Minuten Abstand
stieg die Rechnung aus, und die Zeit war trotzdem verbraucht:

| Rhythmus | kam an (bei 18/h) |
|---|---|
| alle 3 / 5 / 9 min | **0/h** |
| alle 12 min | 15/h |
| alle 20 / 30 / 60 min | 18/h |

Wer aktiv spielt, sieht selten neun Minuten lang nicht in die App. Gemessen an
einem echten Spielstand: 40 von 100 eingelagerten Pokémon standen auf exakt
demselben Wert, drei auf 1, neun auf 4.

Jetzt hat jeder Trainer zwei eigene Uhren — eine fürs Team, eine für die Box —,
und sie rücken nur um die gewährten Punkte vor. Der Rest bleibt stehen. Damit
ist der Spielrhythmus gleichgültig, und das ist die eigentliche Zusage: nach
einer Stunde ist dieselbe Menge da, egal wie oft jemand hereingesehen hat.

Zwei Uhren und nicht eine, weil die Raten verschieden sind: eine gemeinsame
würde der langsameren ihre Reste stehlen.


## Shinys: von 15 auf 205 Begegnungen

Gemeldet mit „viel zu einfach" — und zwar von dem Spieler mit den meisten.
Nachgerechnet über 200.000 Läufe bei durchgehender Fangserie: ein Schillerndes
kam im Schnitt nach **15 Begegnungen** (Median 13). In den echten Spielständen
sah man es: 18,2 %, 12,9 % und 6,7 % der Sammlungen glänzten.

Die Grundchance war nicht das Problem — 1/512 ist in Ordnung. Es war die
Fangserie, die sie um das Fünfzigfache hob und dort ließ:

| | vorher | jetzt |
|---|---|---|
| Plateau erreicht nach | 10 Fängen | **30** |
| Chance auf dem Plateau | 10 % | **0,35 %** |
| Garantie bei | 49 | **400** |
| Serie nach einem Fang | fällt auf 20 | **auf 0** |
| **Median bis zum ersten** | **13** | **205** |
| Schnitt / p10 / p90 | 15 / 5 / 28 | **219 / 38 / 401** |

Der Rückfall auf 20 war der stillste Fehler: zwanzig lag *auf* dem Plateau,
also war die Chance direkt nach einem Treffer wieder die höchste, die es gab.
Das machte das zweite Schillernde billiger als das erste und das dritte auch —
daher die Sammlungen mit zwanzig Stück.

Die Garantie liegt beim Doppelten des Medians. Sie ist ein Deckel gegen echtes
Pech, kein Ziel, das man einplant.

### Was die Serie noch bringt

Weniger, als man denkt, und trotzdem genug. 0,35 % gegen 0,195 % Grundrate ist
knapp das Doppelte — der eigentliche Wert liegt in der **Zusage bei 400**, die
es ohne Serie gar nicht gibt. Wer wahllos fängt, hat 0,195 % je Begegnung und
keine Obergrenze: Median 355 und ein Ende, das nie kommen muss.

### Ein Fehler, den erst die neuen Zahlen sichtbar machten

Der erforschte Zuschlag (`res-shiny`, höchstens 0,1 Prozentpunkte) wirkte
**allein auf Serie 0**; der Anstieg danach ignorierte ihn. Solange das Plateau
bei zehn Prozent lag, verschwand er darin. Mit 0,35 % wäre daraus eine sichtbare
Verkehrung geworden: voll erforscht stünden bei Serie 0 gerade 0,295 %, beim
ersten Fang aber nur noch 0,20 % — **das Fangen hätte die Chance gesenkt.**

Jetzt hebt der Zuschlag die ganze Kurve. Voll erforscht: Median 159 statt 205.

**Bestehende Schillernde bleiben.** Sie sind ehrlich erspielt, nur unter zu
leichten Regeln; sie nachträglich abzuwerten würde die Spieler für einen Fehler
in diesen Zahlen bestrafen.

## Raids werfen Werkstoffe ab

Der Einwand lautete, die Bosse seien zu teuer. Gemessen: ein Raid gab
**ausschließlich Gold**, es war also nichts versteckt — er brachte wirklich
nichts, was man sonst nirgends bekommt.

Statt den Preis zu senken, gibt es jetzt Werkstoffe, verteilt wie das Gold
(halb zu gleichen Teilen, halb nach Beitrag), mit einem Sockel von einem
Drittel: wer mitschlägt, geht nie leer aus. Eine Stufe-5-Beschwörung zu viert
bringt jedem 12–19 Eisensplitter, 8–13 Tautropfen und 3–4 Sternenstaub — mehr
als eine achtstündige Grabung, und Sternenstaub ist sonst der Engpass der
ganzen Werkbank.

Damit ist der Raid das, was er sein sollte: der schnellste Weg an Material,
nicht eine zweite Goldquelle.

## Die Arena bestraft den zweiten Besuch nicht mehr

Die Prämie fiel einmal am Tag je Stufe, danach nichts — gemeldet als „fühlt
sich viel zu wenig belohnend an beim zweiten Mal". Stimmt. Jeder weitere
Durchlauf zahlt jetzt ein Viertel, dieselbe Größenordnung, die Routentrainer
für den zweiten Anlauf bekommen (`repeatRewardRatio`).

Gegenstände nur, soweit ein Viertel für ein ganzes Stück reicht: ein halber
Sternenstaub wäre keine Belohnung, sondern eine Rundungsfrage.

**Nicht geändert** wurde das Antrittsgeld bei wiederholten Trainerkämpfen. Der
Einwand („nur 20 Gold, egal welches Level") beschreibt die Anti-Grind-Sperre,
und die tut genau, was sie soll. Dass der Streuner beim Erkunden besser zahlt,
hat dieselbe Ursache und ist Absicht: er wird zufällig aus der ganzen Region
gezogen, ist also fast immer ein Gegner, den man heute noch nicht geschlagen
hat. Erkunden über Kurbeln zu stellen ist der Sinn der Regel.


## Zwei Fehler, die erst der Betrieb zeigte

### Das Labor hob die Fangchance um exakt nichts

Gemeldet: „vor dem Upgrade 83–86 %, mit dem Labor-Upgrade das Gleiche."

Labor und Forschung wurden halbiert auf die **Ordenszahl** addiert — und die
ist bei neun gedeckelt (`MAX_BADGE_BONUS`), weil sechsundzwanzig Orden das
Fangen sonst zur Formalität machen. Wer neun Orden hatte, bei dem verpuffte
jede weitere Laborstufe restlos. Nachgerechnet: Orden+Labor 9, 12 oder 16
ergaben alle exakt 91,2 %.

Der Deckel gehört zu den Orden, nicht zu allem, was die Fangchance hebt. Beides
ist jetzt getrennt: Orden bleiben bei neun gedeckelt, Labor und Forschung sind
ein eigener Faktor mit eigener Grenze (30 %).

Seltene Art, Level 55, Hyperball, zwei Stapel:

| | vorher | jetzt |
|---|---|---|
| ohne Labor | 36,8 % | 36,8 % |
| Labor 1 | 36,8 % | 38,6 % |
| Labor 3 | 36,8 % | 42,3 % |
| Labor 5 | 36,8 % | 46,0 % |
| + Forschung | 36,8 % | 47,8 % |

### Die Kampfzone zahlte jedem Kampf den ersten Sieg

Gemeldet: 24.529 EP aus 33 Kämpfen.

Jeder Gegner dort hat eine eigene Kennung (`gauntlet-hoenn-42`), gilt also
immer als **erster Sieg** — und der zahlt voll, während eine Wiederholung sonst
halbiert wird. Mit Faktor 2,5 waren das 928 EP je Kampf: fünfmal ein
wiederholter Routentrainer (186), und das unbegrenzt oft.

| | EP je Kampf |
|---|---|
| Routentrainer, erster Sieg | 371 |
| Routentrainer, Wiederholung | 186 |
| Arena „schwer" | 1.113 |
| Kampfzone **vorher** | 928 — jeden Kampf |
| Kampfzone **jetzt**, Serie 0 | 445 |
| Kampfzone jetzt, Serie 50 | 243 |
| Kampfzone jetzt, Serie 100 | 167 |

Der Faktor sank auf 1,2 und flacht über die Serie ab
(`Faktor / (1 + Serie/60)`). Ohne die Abflachung wäre eine Serie von
zweihundert schlicht zweihundertmal der erste Kampf, und die einzige sinnvolle
Spielweise wäre, ewig weiterzukämpfen. 33 Kämpfe bringen jetzt **11.787 statt
30.624**.

Die späten Kämpfe tragen sich über die Stufen bei 50 und 100 — über Gold und
Werkstoffe, nicht über Erfahrung.

### Nebenbei: eine Tabelle, die unbegrenzt wuchs

Beim Nachmessen aufgefallen: Arena und Kampfzone vermerkten ihre Kunstgegner
dauerhaft in `trainer_defeats`. Dort standen **119 solcher Zeilen gegen
39 echte Trainer** — und keine davon wird je wieder gelesen. Sie werden jetzt
gar nicht mehr angelegt, und eine Migration hat die alten entfernt.


## Die Flucht zählt Würfe, nicht Runden

Gemeldet: vier verlorene Fangserien, „das Fukano dachte sich, ich verzieh mich".

Die Fluchtchance hing am **Rundenzähler** — und der stieg auch beim Schwächen
und Beruhigen. Wer viermal vorbereitete und dann warf, stand beim **ersten**
Wurf schon bei 25 %. Vorbereiten ist aber kein Fluchtgrund.

Gezählt werden jetzt Würfe, und die ersten drei sind sicher:

| Wurf | 1–3 | 4 | 5 | 6 | 8 | 14 |
|---|---|---|---|---|---|---|
| Flucht | **0 %** | 5 % | 10 % | 15 % | 25 % | 50 % |

Dazu steht die Zahl jetzt **auf dem Bildschirm**. Vorher verschwand das Wesen,
und es sah aus wie Willkür; jetzt kann man abwägen — noch ein Ball oder lieber
erst beruhigen.

## In der Kampfzone bekam am Ende nur einer noch Erfahrung

Gemeldet, und es war mein Fehler. Die Heilung übersprang Besiegte:

```ts
if (c.hpCurrent >= max || c.hpCurrent <= 0) continue
```

Auch an den Stufen. Wer einmal umfiel, blieb damit den **ganzen Lauf** draußen
— und weil nur antritt, wer noch steht, bekam er auch keine Erfahrung mehr. Über
dreißig Kämpfe schrumpfte das Team auf den letzten Stehenden zusammen.

Jetzt gilt der Unterschied, der ohnehin gemeint war: nach einem Sieg gibt es
zwölf Prozent für die Stehenden, an einer **Stufe** steht das Team wieder
vollzählig auf. Sie ist der Rastplatz, und ohne das Beleben war sie nur ein
halber. Zwischen den Stufen bleibt Umfallen ein echter Verlust — das ist das
Risiko, das die Serie zu einer macht.

Die Heilung je Sieg stieg dabei von acht auf zwölf Prozent.

## Drei Arena-Typen am Tag

Einer war zu wenig: wer gegen den Typ des Tages kein passendes Team hat, konnte
die Arena schlicht nicht sinnvoll spielen und musste bis morgen warten.

Jetzt stehen **drei** offen, aus dem Datum gerechnet wie vorher — mit einer
Schrittweite, die teilerfremd zur Typenzahl ist, damit nicht drei benachbarte
erscheinen. In achtzehn Tagen kommt jeder der achtzehn Typen dran.

Jeder Typ trägt seinen **eigenen** Tagesabschluss je Stufe. Ohne das wären die
drei Angebote in Wahrheit eines: wer Feuer auf „schwer" geschafft hat, bekäme
Wasser auf „schwer" nur noch zum Wiederholungssatz.

Mit allen achtzehn wäre der „Typ des Tages" keiner mehr — drei geben eine Wahl,
ohne die Vorbereitung sinnlos zu machen.

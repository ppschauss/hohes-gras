# Verbund — mehrere Instanzen, eine Spielerwelt

**Stand: Entwurf.** Nichts davon ist gebaut. Dieses Dokument beschreibt, was
gebaut werden soll, warum es so geschnitten ist und was bewusst *nicht* geht.

## Das Ziel

Mehrere Installationen des Bots — auf verschiedenen Servern, von verschiedenen
Leuten betrieben — sollen sich eine Spielerwelt teilen: man sieht einander,
kann befreundet sein, in einer Rangliste stehen, miteinander schreiben, handeln
und tauschen. Die bestehende lokale Spielerbasis soll dabei nicht verloren
gehen.

## Die Entscheidung: Verbund, nicht zentrale Datenbank

Drei Wege waren denkbar.

**Alles zentral.** Die Instanzen werden zustandslose Frontends, eine Datenbank
in der Cloud ist die einzige Wahrheit. Sauber im Modell — aber die Engine macht
pro Anfrage dutzende kleine, synchrone SQLite-Zugriffe; ein einzelner Kampfzug
liest und schreibt vielfach. Über Netzwerklatenz wird daraus etwas spürbar
Langsameres als heute, und die gesamte Datenschicht müsste neu geschrieben
werden. Verworfen, solange der Verbund reicht.

**Zwei autoritative Datenbanken abgleichen.** Beide Seiten lassen Fänge, Käufe
und Kämpfe zu, danach wird zusammengeführt. Das ist nicht aufwendig, sondern
unmöglich: Welcher Goldstand gewinnt? Wurde der Trank einmal oder zweimal
verbraucht? Geld und Gegenstände sind genau das, was sich nicht automatisch
verschmelzen lässt. Verworfen.

**Verbund.** Jede Instanz bleibt die Wahrheit über ihre eigenen Spielstände.
Ein kleiner zentraler Dienst hält nur Dinge, die sich **anhängen** lassen und
nie zusammengeführt werden müssen: Identitäten, Ranglisten-Schnappschüsse,
Chat, Angebote — und, für Handel und Tausch, **Treuhand-Marken**. Gewählt.

## Was zentral liegt

Ein Cloudflare Worker mit D1. Klein genug, dass er auf dem kostenlosen Kontingent
läuft.

| Tabelle | Inhalt | Art |
|---|---|---|
| `instances` | Kennung, öffentlicher Schlüssel, Anzeigename | Stammdaten |
| `trainers` | globale Id, Telegram-Id, Anzeigename, Heimat-Instanz | Stammdaten |
| `profiles` | Schnappschuss: Orden, Dex, Siege, Wertung | wird überschrieben |
| `friendships` | zwei globale Ids | anhängend |
| `messages` | Chat: Kanal, Absender, Text, Zeit | anhängend |
| `listings` | Marktangebot: Verkäufer, Beschreibung, Preis, Zustand | anhängend + Zustand |
| `escrow` | Treuhand-Marke: Inhalt, Empfänger, eingelöst? | anhängend + einmalig |

Die **Telegram-Id ist der Anker**. Sie ist bereits die Identität in jeder
Instanz, sie ist global eindeutig, und sie kostet keinen neuen Anmeldeweg. Die
globale Id ist ein Hash daraus, damit die rohe Telegram-Id nicht in fremden
Datenbanken liegt.

## Was lokal bleibt

Alles, was den Spielstand ausmacht: Kreaturen, Beutel, Gold, Fortschritt,
Kämpfe. Die Instanz schiebt regelmäßig einen **Schnappschuss** des Profils nach
oben (Orden, Dex-Zahl, Siege) — das reicht für Rangliste und Trainerkarte und
kann nie in Konflikt geraten, weil es nur überschrieben wird.

## Handel und Tausch: Treuhand statt geteilter Tabelle

Der heutige Kauf ist eine einzige Transaktion:

```
Gold abbuchen → Angebot als verkauft markieren → Auszahlung → owner_id umschreiben
```

Über Instanzgrenzen zerfällt die letzte Zeile in drei Schritte. Ein Tausch ist
kein Zusammenführen, sondern ein **Transfer** — und Transfers lassen sich sicher
machen, wenn genau eine Stelle entscheidet, ob sie schon stattgefunden haben.

### Der Ablauf

1. **Einstellen.** Die Quell-Instanz sperrt die Kreatur lokal (dieselbe
   Mechanik wie „unterwegs", siehe `busy.ts`) und meldet ein Angebot nach oben.
   Die Kreatur bleibt beim Verkäufer, kämpft aber nicht mehr und lässt sich
   nicht verwerten.
2. **Kaufen.** Die Käufer-Instanz bucht **zuerst** das Gold ab und fordert dann
   zentral den Zuschlag an. Der Dienst setzt das Angebot per
   Vergleiche-und-Setze auf `verkauft` — gewinnt ein anderer das Rennen, war
   die Abbuchung Teil einer Transaktion, die zurückrollt.
3. **Auslagern.** Die Quell-Instanz erfährt vom Zuschlag, **löscht die Kreatur
   lokal** und legt im selben Zug eine Treuhand-Marke an: die vollständigen
   Daten der Kreatur, signiert, adressiert an den Käufer. Ab hier existiert sie
   nur noch in der Marke.
4. **Einlösen.** Die Käufer-Instanz schreibt zuerst eine lokale Zeile
   „eingehend", löst dann die Marke zentral ein (wieder Vergleiche-und-Setze,
   genau einmal) und erzeugt die Kreatur. Stirbt sie dazwischen, findet sie die
   Zeile beim Start wieder und macht weiter.
5. **Auszahlen.** Das Gold für den Verkäufer geht denselben Weg als eigene
   Marke.

### Was schiefgehen kann, und was dann passiert

| Fehler | Folge |
|---|---|
| Quelle stirbt nach dem Löschen | Kreatur lebt in der Marke, Käufer holt sie ab |
| Quelle stirbt vor dem Löschen | Zuschlag steht, Auslagern wird beim Start nachgeholt |
| Ziel stirbt vor dem Einlösen | Marke offen, Ziel holt sie beim Start ab |
| Ziel stirbt nach dem Einlösen | „eingehend"-Zeile lokal, wird beim Start materialisiert |
| Zwei Käufer gleichzeitig | Vergleiche-und-Setze, einer verliert und bekommt sein Gold |
| Marke zweimal eingelöst | Zweiter Versuch schlägt fehl — sie ist einmalig |

Das entscheidende Prinzip: **die Kreatur ist immer an genau einem Ort** — in
einer Instanz oder in einer Marke, nie in beiden und nie in keinem.

## Was der Verbund nicht lösen kann: Vertrauen

Eine selbst gehostete Instanz kann lügen. Sie kann Kreaturen mit makellosen
Werten erfinden, Gold aus dem Nichts schöpfen und beides in den Verbund
schieben. Der zentrale Dienst sieht nur, dass eine Instanz etwas behauptet.

Dagegen hilft kein Protokoll, nur eine Entscheidung. Drei Stufen:

- **Unter Freunden.** Jede Instanz bekommt einen Schlüssel, alles wird
  protokolliert, Auffälligkeiten sieht man im Nachhinein. Für den Kreis, um den
  es hier geht, ist das angemessen.
- **Mit Grenzen.** Der Dienst deckelt, was eine Instanz je Tag in den Verbund
  schieben darf, und lehnt Werte ab, die es im Spiel nicht geben kann.
- **Öffentlich.** Ginge nur mit zentraler Autorität — also dem Weg, der oben
  verworfen wurde. Wer den Verbund öffentlich betreibt, muss damit rechnen.

Das steht hier so deutlich, weil es die einzige Eigenschaft ist, die man später
nicht nachrüsten kann, ohne den Entwurf umzudrehen.

## Chat

Nachrichten sind reine Anhängungen — der einfachste Fall für den Dienst. Drei
Kanäle: **global**, **Gilde**, **direkt**. Die Instanz holt neue Nachrichten
beim Öffnen der Mini-App und über den Bot; die Telegram-Anbindung gibt es für
Gilden bereits (`/gilde` bindet einen Gruppenchat), sie bekommt denselben Weg
nach oben.

## Automatische Aktualisierung

Ein Push auf `main` veröffentlicht eine `version.json` mit Commit und Prüfsumme.
Jede Instanz sieht stündlich nach, zieht bei Bedarf `git pull` und
`./manage.sh rebuild`.

**Der Rückfall ist der wichtige Teil.** Nach dem Neustart prüft die Instanz
ihre eigene Gesundheit; scheitert das, springt sie auf den vorherigen Commit
zurück und meldet es. Ohne diesen Schritt legt ein kaputter Build alle
Instanzen gleichzeitig lahm — und zwar genau die, die niemand betreut.

## Reihenfolge

Jeder Schritt ist für sich nützlich; keiner setzt den nächsten voraus.

1. **Dienst und Identität.** Worker, D1, Instanzschlüssel, globale Trainer.
   Danach: die Instanz kennt ihre globale Id.
2. **Profile und Rangliste.** Schnappschüsse hoch, globale Rangliste runter.
   Danach: man sieht einander.
3. **Freunde über Instanzen.** Trainer-Codes global auflösen.
4. **Chat.** Global und Gilde, in der Mini-App und über den Bot.
5. **Angebote lesen.** Fremde Marktangebote anzeigen, noch ohne Kauf.
6. **Treuhand.** Kauf und Tausch über Instanzgrenzen.
7. **Automatische Aktualisierung** mit Rückfall.

Schritt 1 bis 4 sind unkritisch: nichts davon kann einen Spielstand
beschädigen. Ab Schritt 6 wird es ernst — dort gehört ein Testlauf zwischen
zwei Instanzen hin, bevor echte Kreaturen die Grenze überqueren.

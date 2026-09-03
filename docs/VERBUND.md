# Verbund — mehrere Instanzen, eine Spielerwelt

**Stand: Schritt 1 bis 7 laufen** — Identitäten, Profile, Rangliste, Chat,
Freunde über Instanzgrenzen, der Aushang und die Treuhand für Käufe. Was davon
wo liegt, steht weiter unten unter „Stand".

Der Rest dieses Dokuments ist gemischt: Entwurf und Gebautes stehen
nebeneinander. Wo ein Abschnitt etwas beschreibt, das es **nicht** gibt, steht
das ausdrücklich am Anfang des Abschnitts. Ohne diese Markierung gilt: es ist
gebaut.

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
| `instances` | Kennung, geteiltes Geheimnis, Anzeigename, Vertrauensstufe | Stammdaten |
| `trainers` | globale Id, Anzeigename, Heimat-Instanz, Trainer-Code | Stammdaten |
| `profiles` | Schnappschuss: Orden, Dex, Siege, Wertung | wird überschrieben |
| `friends` | zwei globale Ids | anhängend |
| `friend_requests` | offene Anfragen zwischen zwei Ids | anhängend |
| `chat` | Kanal, Absender, Text, Zeit | anhängend |
| `market` | Aushang je Instanz: Abschrift, keine Kreatur | wird ersetzt |
| `market_orders` | Treuhand: Zustand eines Kaufs, verwahrtes Pokémon | Vorgang |
| `releases` | der Stand, auf den sich alle aktualisieren sollen | wird überschrieben |

Zwei Dinge daran sind bewusst so: Das Geheimnis einer Instanz ist ein
**geteiltes** (HMAC), kein öffentlicher Schlüssel — die Namen in dieser Tabelle
sagten lange etwas anderes. Und die **Telegram-Id geht nicht hoch**; die globale
Id ist ihr Hashwert mit einem Salz, das nur der Verbund kennt.

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

## Gegen gefälschte Kreaturen

> **Nichts aus diesem Kapitel ist gebaut.** Es beschreibt fünf Ebenen; im Code
> existiert davon keine einzige. Der Verbund prüft an einem hereingereichten
> Pokémon heute nur, dass es eine Zeichenkette unterhalb der Längengrenze ist —
> `store.ts` sagt es offen: „was darin steht, geht ihn nichts an".
>
> Die **einzige** heute wirksame Sicherung ist die Vertrauensstufe: eine Instanz
> darf erst handeln, wenn der Betreiber sie freischaltet (siehe „Was die Stufen
> wirklich bedeuten"). Das ist eine Entscheidung über Menschen, keine Prüfung
> über Daten. Wer eine fremde Instanz zum Handel zulässt, vertraut ihrem
> Betreiber — und sonst nichts.
>
> Diese Markierung stand hier lange nicht, während die Treuhand bereits lief.
> Wer nach diesem Kapitel entschieden hat, ob er jemanden handeln lässt, hat
> sich auf vier Ebenen verlassen, die es nicht gibt.

Eine selbst gehostete Instanz kann lügen. Sie kann Kreaturen mit makellosen
Werten erfinden, Gold aus dem Nichts schöpfen und beides in den Verbund
schieben. Der zentrale Dienst sieht zunächst nur, dass eine Instanz etwas
behauptet.

Eine Versionsnummer und ein „zuletzt geändert von" wären dagegen zu schwach:
das sind Felder, die der Fälscher selbst schreibt. Es braucht Angaben, die sich
**nachrechnen** lassen, und eine Kette, die sich nicht rückwirkend glätten
lässt. Fünf Ebenen, von stark nach schwach.

### 1. Nachrechenbare Herkunft — der stärkste Hebel

Die Engine ist frei von I/O und würfelt ausschließlich aus einem Seed. Ein
gefangenes Pokémon ist deshalb **vollständig aus seiner Begegnung ableitbar**:

```
seed  = trainerId : areaId : zeitpunkt : zähler
ivs   = randomIvs(rng(seed + ':creature'))
natur = pick(rng(seed + ':creature'))
```

Der zentrale Dienst hat dieselbe Engine und dasselbe Content-Pack. Er bekommt
mit der Kreatur die vier Bestandteile des Seeds und **rechnet nach**: kommen bei
diesem Seed genau diese Werte, diese Natur, dieses Schillern heraus? Wenn nein,
ist die Kreatur erfunden — ohne dass irgendjemand irgendwem glauben muss.

Damit kann eine Instanz nicht einfach „makellos und schillernd" behaupten. Sie
müsste einen Seed *suchen*, der das ergibt, und der Seed ist gebunden: an eine
Trainer-Id, an ein Gebiet, in dem die Art überhaupt vorkommt, an einen
Zeitpunkt, den der Dienst gegen seine eigene Uhr prüft, und an einen Zähler,
der je Trainer nur steigen darf. Ein Sprung im Zähler ist selbst der Alarm.

Das ist der Punkt, an dem sich eine Entscheidung von früher auszahlt: die
Engine wurde ohne I/O gebaut, damit man sie testen kann. Genau deshalb lässt
sie sich jetzt als Prüfinstanz einsetzen.

### 2. Signierte Herkunftskette

Nicht alles entsteht durch Fangen. Zucht, Entwicklung, Geschenke, Level,
Fleißpunkte — jede dieser Veränderungen hängt als **Glied an einer Kette**, die
die Kreatur mitträgt: wer, wann, welche Instanz, signiert mit deren Schlüssel.
Anhängend, nie überschreibend.

Eine Kreatur ohne lückenlose Kette bis zu einem Entstehungsereignis wird nicht
angenommen. Das verhindert das Fälschen nicht, aber es macht es **dauerhaft
zurechenbar**: wer eine Kreatur erfindet, steht für immer als ihr Ursprung in
ihrer Kette — auch wenn sie danach dreimal den Besitzer wechselt. Es gibt kein
Waschen.

### 3. Plausibilität gegen das Content-Pack

Der Dienst kennt das Pack und lehnt ab, was es im Spiel nicht geben kann:

- Art existiert, Level unter der Reisegrenze des Trainers
- Werte 0–31, Fleißpunkte höchstens 252 je Wert und 510 gesamt
- Attacken stehen im Lernsatz der Art auf diesem Level
- „gefangen in Gebiet X" → die Art muss dort auch vorkommen
- Entwicklung → das Ziel muss eine gültige Entwicklung der Quelle sein

Das erwischt die bequemen Fälschungen, und das sind die meisten.

### 4. Kontingente und Bilanz

Eine Instanz darf je Tag nur so viel in den Verbund schieben, wie zu ihrer Zahl
aktiver Trainer passt. Fälschen wird dadurch langsam — und das Überschreiten
ist selbst das Signal. Dasselbe für Gold: der Dienst führt die Bilanz je
Instanz. Wer dauerhaft mehr ausführt als einführt, ist entweder ein Handelsplatz
oder eine Druckerei; beides ist es wert, angesehen zu werden.

### 5. Vertrauensstufen und Rückabwicklung

Neue Instanzen dürfen zuerst nur **lesen** — sehen, schreiben, in der Rangliste
stehen. Handel wird freigeschaltet, nicht mitgeliefert.

Und weil die Kette lückenlos ist, lässt sich eine als Fälscher erkannte Instanz
**präzise zurückabwickeln**: alles, was je aus ihr kam, ist auffindbar, auch
nach mehreren Besitzerwechseln. Das ist die eigentliche Antwort auf „was kann
man dagegen tun" — verhindern nicht, aber vollständig rückgängig machen.

### Was bleibt

Ein geduldiger Fälscher, der *plausible* Kreaturen erzeugt — gewöhnliche Art,
gewöhnliche Werte, gültiger Seed — kommt durch. Das ist hinnehmbar: eine
plausible Kreatur ist eine, die man auch selbst hätte fangen können. Was nicht
durchkommt, ist das, was den Verbund kaputt machen würde.

Echte Verhinderung gäbe es nur mit zentraler Autorität — dem Weg, der oben
verworfen wurde. Das steht hier so deutlich, weil es die einzige Eigenschaft
ist, die man später nicht nachrüsten kann, ohne den Entwurf umzudrehen.

## Chat

Nachrichten sind reine Anhängungen — der einfachste Fall für den Dienst. Drei
Kanäle: **global**, **Gilde**, **direkt**. Die Instanz holt neue Nachrichten
beim Öffnen der Mini-App und über den Bot; die Telegram-Anbindung gibt es für
Gilden bereits (`/gilde` bindet einen Gruppenchat), sie bekommt denselben Weg
nach oben.

## Automatische Aktualisierung

> Der ursprüngliche Entwurf sah einen Automatismus vor: eine `version.json` aus
> einem Git-Haken, und jede Instanz zieht selbsttätig. Gebaut wurde bewusst
> etwas anderes — der Absatz unten beschreibt den **gebauten** Weg.

Der Stand wird von Hand gesetzt (`PUT /release` mit dem Admin-Geheimnis); es
gibt keine `version.json` und keinen Git-Haken. Jede Instanz fragt alle zehn
Minuten nach und benachrichtigt ihren Betreiber **einmal je Stand** über
Telegram. Gezogen wird nichts von selbst: der Betreiber drückt in der App
einen Knopf, die Instanz legt daraufhin nur eine Marke in `data/` ab, und
`./manage.sh watch` auf dem Wirt tut die eigentliche Arbeit.

Das ist Absicht. Ein Container, der sich selbst neu bauen darf, braucht den
Docker-Socket — und damit Zugriff auf alles, was auf der Maschine läuft.

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


---

## Stand: Schritt 1 bis 7 sind gebaut

Was es gibt, und wo es liegt:

| Teil | Ort | Zustand |
|---|---|---|
| Dienstlogik, ohne I/O | `packages/hub/src/service.ts` | 13 Tests |
| Signatur (HMAC, 5-Minuten-Fenster) | `packages/hub/src/auth.ts` | mitgeprüft |
| Speicher-Schnittstelle | `packages/hub/src/store.ts` | — |
| Speicher im Arbeitsspeicher (Tests) | `packages/hub/src/memory.ts` | — |
| Speicher auf Cloudflare D1 | `packages/hub/src/d1.ts` | nur Abfragen |
| Worker-Einstieg | `packages/hub/worker/index.ts` | ~40 Zeilen |
| D1-Schema | `packages/hub/worker/schema.sql` | — |
| Instanz-Seite | `packages/api/src/services/hub.ts` | 6 Tests |
| Hintergrund-Abgleich (alle 10 min) | `packages/api/src/jobs/scheduler.ts`, Job `hub-sync` | — |
| Globale Rangliste in der App | `packages/web/src/social/RankingPanel.tsx` | Umschalter |

Die Trennung ist dieselbe wie zwischen Engine und Spiel: **der Dienst kennt
keine Datenbank.** `createHub()` nimmt eine Anfrage und gibt eine Antwort
zurück — kein Fastify, kein Worker, kein Netz. Deshalb laufen alle 13 Tests des
Verbunds in Millisekunden und ohne Cloudflare, und deshalb ist der Worker
selbst so kurz, dass man ihn ganz lesen kann.

### Die Zusage der Instanz-Seite

**Ein Verbund darf nie zur Voraussetzung dafür werden, dass eine Instanz
läuft.** Konkret heißt das:

- Sind `HUB_URL`, `HUB_INSTANCE_ID` und `HUB_SECRET` leer, tut jede Funktion
  nichts und gibt `0` oder `null` zurück. Keine Anfrage geht hinaus.
- Ist ein Verbund eingerichtet, aber nicht erreichbar, wird das geloggt und
  sonst nichts. Es gibt keinen Pfad, auf dem ein Fehler des Verbunds eine
  Spielaktion scheitern lässt.
- Die Rangliste wird im Hintergrund geholt und lokal abgelegt; die Ansicht
  liest nur den Zwischenspeicher. Ein Blick auf die Rangliste wartet nie auf
  eine fremde Leitung, und schweigt der Verbund, bleibt der letzte Stand
  stehen statt einer leeren Liste.
- `hub_links` und `hub_cache` sind Beiwerk: löscht man sie, verliert das Spiel
  nichts.

Beides ist getestet, auch der Ausfall (`packages/api/test/hub.test.ts`).

### Was hinausgeht — und was nicht

Hoch geht ein Schnappschuss: Orden, Dex-Fänge, gewonnene Kämpfe, höchstes
Level, PvP-Wertung. Keine Kreaturen, keine Gegenstände, kein Gold, keine
Telegram-Id — die globale Id ist ein Hash aus Telegram-Id und einem Salz, das
nur im Verbund liegt. Aus ihr lässt sich die Nummer nicht zurückrechnen, und
eine Instanz kann keine Ids für fremde Spieler erfinden.

**Wer sich lokal aus der Rangliste genommen hat, taucht auch global nicht auf.**
Der Schalter hieß immer „nicht in der Rangliste"; eine zweite, größere
Rangliste wäre genau das, was er verhindern soll.

Hochgeschoben wird nur, was sich geändert hat — die meisten Trainer spielen an
den meisten Tagen nicht.

### Den Dienst ausrollen

Ein Befehl. Er braucht ein Cloudflare-API-Token mit genau zwei Rechten —
**Account · Workers Scripts · Edit** und **Account · D1 · Edit** — und legt
sonst nichts an:

```bash
cd build/app
CLOUDFLARE_API_TOKEN=… npm run hub:setup -w @game/hub
```

Der Lauf ist wiederholbar: eine vorhandene D1 wird weiterverwendet statt
danebengestellt, das Schema kommt mit `IF NOT EXISTS`, und **`ID_SALT` wird nur
gesetzt, wenn es noch keins gibt.** Das ist die wichtigste Regel des ganzen
Skripts: das Salz steckt in jeder globalen Trainer-Id. Wer es neu setzt, gibt
allen Spielern neue Ids und fängt die Rangliste bei null an.

Am Ende stehen `HUB_URL`, `HUB_INSTANCE_ID` und `HUB_SECRET` in `secrets.env`
(chmod 600, gitignored); das Instanz-Geheimnis gibt der Dienst genau einmal
heraus und es wird nirgends ausgegeben. Danach `./manage.sh up` — **nicht** `restart`, das liest die `--env-file` nicht neu — und der Job
`hub-sync` erledigt den Rest.

Neue Stände später:

```bash
npm run hub:deploy -w @game/hub
```

**Weitere Instanzen** melden sich mit dem `HUB_ADMIN_SECRET` an:

```bash
curl -X POST "$HUB_URL/instances" -H 'content-type: application/json' \
     -H "x-hub-admin: $HUB_ADMIN_SECRET" \
     -d '{"id":"zweite-huette","name":"Bennys Instanz"}'
```

Sie starten auf der Stufe `read` — lesen und die eigenen Trainer melden, aber
nicht handeln. Handel wird freigeschaltet, nicht mitgeliefert:

```bash
curl -X POST "$HUB_URL/instances/trust" -H 'content-type: application/json' \
     -H "x-hub-admin: $HUB_ADMIN_SECRET" \
     -d '{"id":"zweite-huette","trust":"trade"}'
```

### Selbstanmeldung

Der Weg oben verlangt, dass jemand mit dem Admin-Geheimnis für jede neue
Installation einen Befehl tippt — und danach das Instanz-Geheimnis sicher
weitergibt. Das ist umständlich und war der Grund, warum eine zweite Instanz
tagelang stumm blieb: sie war schlicht nie angemeldet worden.

Mit einem **Beitrittsschlüssel** meldet sich eine Installation selbst an. Er
liegt als `JOIN_SECRET` beim Verbund und darf genau eines: eine Instanz
anlegen. Das ist bewusst nicht das Admin-Geheimnis — mit dem setzt man auch
den Stand, auf den sich alle Instanzen aktualisieren sollen, und wer nur
beitreten will, soll niemanden zum Update drängen können.

```bash
npx wrangler secret put JOIN_SECRET -c worker/wrangler.toml
```

Danach trägt die neue Installation drei Werte in ihre `secrets.env`:

```
HUB_URL=...
HUB_INSTANCE_ID=zweite-huette
HUB_JOIN_SECRET=...
```

und startet mit `./manage.sh up`. Beim ersten Verbundlauf holt sie sich ihr
Geheimnis und legt es in ihrer **eigenen Datenbank** ab — der Container kann
`secrets.env` nicht schreiben, sie wird per `--env-file` übergeben und nicht
eingehängt. Im Log steht dann:

```
[hub] Beigetreten als "zweite-huette" auf Stufe read. Handel muss der Betreiber des Verbunds freischalten.
```

`HUB_SECRET` hat weiterhin Vorrang: eine bestehende Installation ändert sich
nicht.

Zwei Ausgänge werden ausdrücklich gemeldet und **nicht wiederholt**, weil sie
sich nicht von selbst lösen — eine bereits vergebene Kennung und ein falscher
Beitrittsschlüssel. Beides steht mit der Abhilfe im Log. Eine verlorene
Datenbank fällt in den ersten Fall: die Kennung ist dann beim Verbund noch
vergeben und muss dort gelöscht werden, oder die Installation nimmt eine neue.

### Was die Stufen wirklich bedeuten

`trust` war lange ein Feld, das gesetzt und nie gelesen wurde — die Sicherung
stand nur hier im Text. Solange man eine Instanz nur von Hand anlegen konnte,
war der Befehl selbst die Schranke. Mit der Selbstanmeldung fällt die weg,
also wird die Stufe jetzt geprüft:

| | `read` | `trade` |
|---|---|---|
| Trainer melden, Profile, Rangliste | ja | ja |
| Chat, Freunde über Instanzgrenzen | ja | ja |
| Fremde Angebote **ansehen** | ja | ja |
| Eigene Angebote **aushängen** | nein | ja |
| Kaufen, liefern, abholen (Treuhand) | nein | ja |

Die Grenze verläuft dort, wo Werte den Besitzer wechseln. Sehen, gesehen
werden und reden bewegt nichts, was jemandem gehört; anbieten und handeln
schon.

### Was beim ersten Ausrollen im Weg stand

Zwei Dinge, die keine Fehler im Code sind, aber jeden ersten Lauf aufhalten:

**Das Token braucht wirklich beide Rechte.** Im neuen Cloudflare-Builder heißt
das Recht **Write**, nicht „Edit", und beide liegen unter *Developer Platform*.
Die verlässliche Kontrolle ist die Zahl neben der Kategorie: dort muss **2/51**
stehen. Bei uns stand 1/51 — Workers ja, D1 nein —, und der Lauf scheiterte
erst an der Datenbank. Prüfen lässt es sich in zwei Sekunden:

```bash
A=<account-id>
curl -so /dev/null -w "Workers %{http_code}\n" \
  "https://api.cloudflare.com/client/v4/accounts/$A/workers/scripts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
curl -so /dev/null -w "D1      %{http_code}\n" \
  "https://api.cloudflare.com/client/v4/accounts/$A/d1/database" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Beide müssen **200** liefern.

**Das Konto braucht eine workers.dev-Subdomain.** Ohne sie lädt der Worker zwar
hoch, ist aber unter keiner Adresse erreichbar. Sie entsteht, sobald man die
Seite *Workers & Pages* im Dashboard einmal öffnet — Cloudflare legt sie dabei
selbst an. Danach dauert es allerdings **einige Minuten**, bis das Zertifikat
für `*.<name>.workers.dev` ausgestellt ist; bis dahin scheitert schon der
TLS-Handschlag mit „no peer certificate available". Das Skript wartet deshalb
in Zwanzig-Sekunden-Schritten, statt aufzugeben.

### Warum das Skript so sortiert ist

`HUB_URL`, `HUB_INSTANCE_ID` und `HUB_ADMIN_SECRET` werden **vor** der
Anmeldung nach `secrets.env` geschrieben, nicht danach. Der Grund ist genau der
Fall oben: das Admin-Geheimnis existiert nach `wrangler secret put` nur noch
auf dem Worker und in einer Shell-Variablen. Bricht der nächste Schritt ab,
wäre es verloren — und das ist der Schlüssel, mit dem man *weitere* Instanzen
anmeldet.

Aus demselben Grund ist `ID_SALT` das Einzige, das ein zweiter Lauf **nicht**
neu setzt. Es steckt in jeder globalen Trainer-Id; wer es erneuert, gibt allen
Spielern neue Ids und fängt die Rangliste bei null an.

### Vor dem Ausrollen prüfen

Der Worker lässt sich vollständig lokal betreiben, mit echtem D1:

```bash
npm run hub:dev -w @game/hub     # Worker auf :8787, liest worker/.dev.vars
npm run hub:e2e -w @game/hub     # Instanz-Client dagegen, über echtes HTTP
```

Das ist kein Ersatz für die Vitest-Tests, sondern deren Ergänzung: die ersetzen
`fetch` durch die Dienstlogik und prüfen damit die **Regeln**, nicht die
**Übersetzung** — Kopfzeilen, rohen Rumpf, D1-Spaltennamen. Genau da gehen
verteilte Systeme kaputt, und genau da fanden sich zwei Fehler, die alle
19 Tests überlebt hatten:

- Der Client hängte auch an ein `GET` einen Rumpf. `fetch` weist das rundheraus
  ab — jeder Abruf der Rangliste wäre im Betrieb gescheitert, im Test mit
  ersetztem `fetch` nie.
- Ein Trainer-Upsert **ohne** Namen überschrieb den vorhandenen mit `—`. Der
  Client schickt heute immer einen mit; „heute schickt niemand das" ist keine
  Zusicherung, und eine Rangliste voller Striche fällt erst auf, wenn sie schon
  so aussieht.

Beide sind behoben und haben jetzt einen Test. Der Prüflauf ist wiederholbar:
jeder Lauf meldet eine eigene Instanz an — eines, das vorher aufgeräumt werden
will, wird nicht ausgeführt.

### Aktualisierung: Schritt 7 ist gebaut

**Der Besitzer entscheidet, immer.** Der Verbund *sagt* nur, welcher Stand
aktuell ist — er stößt nichts an. Was auf einer fremden Maschine passiert,
entscheidet niemand außer der, dem sie gehört.

Der Ablauf:

1. **Der Stand steckt im Image.** `manage.sh build` reicht `git rev-parse
   --short HEAD` als `GIT_SHA` hinein. Ohne Repository — etwa aus einem
   heruntergeladenen Archiv — steht dort `unbekannt`, und der Abgleich hält
   sich dann ganz heraus, statt zu raten.
2. **Du setzt den aktuellen Stand**, von Hand und mit dem Admin-Geheimnis:

   ```bash
   SHA=$(git rev-parse --short HEAD)
   curl -X PUT "$HUB_URL/release" -H 'content-type: application/json' \
        -H "x-hub-admin: $HUB_ADMIN_SECRET" \
        -d "{\"sha\":\"$SHA\",\"notes\":\"Was drin ist\"}"
   ```

   Ausdrücklich kein Git-Haken: was alle Installationen betrifft, soll eine
   Entscheidung sein und nicht der Nebeneffekt eines Pushes.
3. **Jede Instanz fragt ihn ab**, im selben Zehn-Minuten-Takt wie die
   Rangliste, und legt ihn im Zwischenspeicher ab.
4. **Der Betreiber bekommt eine Nachricht** — einmal je Stand, nicht je Lauf.
   Eine Meldung alle zehn Minuten wäre keine Nachricht, sondern eine
   Belästigung; der Zähler steht in `hub_cache` und übersteht einen Neustart.
5. **Ein Knopf in der App** (Einstellungen → Konto & Daten, nur für Admins) löst aus.

### Warum der Knopf nicht selbst baut

Er legt eine **Marke** ab: `data/update-requested`. Mehr nicht.

Ein Container, der sich selbst neu bauen darf, braucht den Docker-Socket des
Wirts — und damit Zugriff auf alles, was auf der Maschine läuft. Bei sich zu
Hause mag man das vertreten; einer fremden Installation ist es nicht zuzumuten,
und ein Spiel ist kein Grund, danach zu fragen.

Die Arbeit tut deshalb ein Wächter **auf dem Wirt**:

```bash
nohup ./manage.sh watch >> ./data/update.log 2>&1 &
```

Er sieht alle 30 Sekunden nach der Marke und führt dann `./manage.sh update`
aus. Läuft keiner, passiert schlicht nichts — das ist besser, als wenn etwas
halb geschieht.

### Der Rückweg

`./manage.sh update` in Reihenfolge:

1. Datenbank sichern (`data/backups/game-vor-update-*.db`)
2. `git pull --ff-only` — schlägt er fehl, bleibt alles unverändert
3. neu bauen und starten
4. **bis zu 60 Sekunden auf `/api/health` warten**
5. antwortet der Dienst nicht: `git reset --hard` auf den alten Stand, neu
   bauen, Datenbank zurückspielen

Schritt 4 und 5 sind der eigentliche Punkt. Ein Update, das den Bot stumm
zurücklässt, ist schlimmer als keins.

### Was die Sicherheit trägt

- **`PUT /release` verlangt das Admin-Geheimnis**, nicht die Instanz-Signatur.
  Dürfte jede angemeldete Instanz den Stand setzen, könnte eine davon allen
  anderen einen beliebigen Commit als „aktuell" unterschieben.
- Angenommen wird nur, was **wie ein Git-Hash aussieht** (`[0-9a-f]{7,40}`).
- **`requireAdmin` im Dienst**, nicht in einer Schicht davor: die Routen unter
  `/api/admin` sind allein dadurch geschützt. Ohne diese Zeile könnte jeder
  Spieler die Installation neu bauen lassen — ein Test besteht genau darauf.

### Schritt 3 und 4 sind gebaut

**Chat.** Ein Raum für den ganzen Verbund, lokal zwischengespeichert wie die
Rangliste — ein Blick hinein wartet nie auf eine fremde Leitung, und ein
stummer Verbund lässt die letzten Nachrichten stehen statt eines leeren
Fensters. Eine Instanz darf nur im Namen **eigener** Trainer reden; ohne diese
Regel könnte jede beliebige Instanz allen alles in den Mund legen.

Gelesen wird mit `POST /chat/read`, nicht mit GET. Signiert wird der Rumpf, und
ein GET darf laut `fetch` keinen tragen — der erste Versuch signierte
`{"since":N}` und schickte nichts, was eine 401 ergab, die nach einem
Schlüsselproblem aussah. `assertGetHasNoBody` macht diesen Fehler jetzt laut
statt leise.

**Freunde über Instanzgrenzen.** Sie liegen im Verbund und nicht in
`friendships`: dort verweisen beide Spalten auf `trainers(id)`, und ein Trainer
auf einer fremden Instanz hat lokal keine Zeile. Das ist nicht bequemer,
sondern das Einzige, was geht.

Gesucht wird über den **Trainer-Code**. Der ist ohnehin zum Weitergeben
gemacht — anders als die Telegram-Id, die deshalb gar nicht erst im Verbund
liegt — und eine Instanz kann damit nicht die Liste aller Spieler
herunterladen: sie fragt einen Code, sie bekommt einen Treffer.

Fragen beide gleichzeitig, sind sie sofort befreundet. Ohne das läge jede
Anfrage drüben neben der eigenen, und keiner käme auf die Idee, die andere
anzunehmen.

### Wann ein Fehler durchgereicht wird und wann nicht

`call()` verschluckt jede Fehlerantwort zu `null` — richtig für den
Hintergrundabgleich, der niemanden stören soll. Für eine Handlung, die jemand
gerade ausgelöst hat, ist es falsch: ein unbekannter Trainer-Code meldete sich
als „Verbund nicht erreichbar", und der Spieler suchte den Fehler bei sich zu
Hause statt in seiner Eingabe.

Dafür gibt es `callOrThrow()`. Es reicht den Grund des Verbunds durch — aber
nur, wenn er zu den eigenen Fehlerarten gehört. Der Verbund ist ein fremder
Dienst, und was er sagt, gehört geprüft, bevor es als eigener Code weiterläuft.

### Was als Nächstes dran ist

Schritt 3 bis 7 stehen oben unverändert. Der nächste sinnvolle ist **Freunde
über Instanzen**: die Trainer-Codes global auflösen. Das braucht nichts Neues
an Infrastruktur — nur eine weitere Route auf demselben Dienst.

/**
 * Was sich im Spiel getan hat.
 *
 * Bewusst eine Datei und kein Sprachkatalog: dies ist kein Bedienungstext,
 * sondern ein Dokument. Es waechst nach vorn, wird nie umformuliert, und eine
 * zweite Sprache hiesse, dieselbe Geschichte zweimal zu pflegen — dann waere
 * eine der beiden Fassungen binnen einer Woche die falsche.
 *
 * Neueste zuerst. Ein Eintrag je Tag, an dem etwas ausgeliefert wurde; die
 * Punkte darunter fassen zusammen, was in den Uebergaben dieses Tages stand.
 */
export interface ChangeEntry {
  /** ISO-Datum, damit die Anzeige es selbst formatieren kann. */
  date: string
  /** Woran man den Tag wiedererkennt. */
  title: string
  items: string[]
}

export const CHANGELOG: ChangeEntry[] = [
  {
    date: '2026-08-31',
    title: 'Verbund, Kampfzone und viele gemeldete Fehler',
    items: [
      'Nur noch ein Legendäres kämpft mit. Sind mehrere im Team, tritt das schwächste an — die übrigen sehen zu und stehen im Garten mit „sieht zu“ da. Die Gegner richten sich weiter nach dem Durchschnitt des ganzen Teams: Stapeln macht den Kampf schwerer und die eigene Mannschaft kleiner.',
      'Raid-Bosse sind nie mehr legendär. Auf Stufe 5 war fast jeder vierte einer, und wer ihn fällte, fing ihn mit 35–90 % — gegen 0,1 % je Erkundung auf dem vorgesehenen Weg. Arena und Kampfzone schlossen Legendäre längst aus; die Raids waren übersehen worden.',
      'Legendäre gehören wieder in ihre Heimatregion: Kanto hat Arktos, Zapdos, Lavados, Mewtu und Mew; Johto die Hundetrios, Lugia, Ho-Oh und Celebi; Hoenn die restlichen zehn. Die Bedingung bleibt für alle gleich — 0,1 % je Erkundung, jedes Wetter, jede Tageszeit, Sagenbeeren zum Fangen und der Ball egal.',
      'Welche Legendären wo vorkommen, stand nirgends — es wurde aus Dex-Nummern geraten. Das konnte nie funktionieren: Legendäre tragen die höchsten Nummern ihrer Generation und lagen damit immer außerhalb. Jetzt steht die Liste im Pack, und ein Legendäres ohne Fundort lässt das Spiel gar nicht erst starten.',
      'Der Pokédex sagte bei Legendären „kommt in freier Wildbahn nirgends vor“. Er nennt jetzt die Region und die Bedingung.',
      'Keine einzige Attacke ohne Wirkung mehr. Von 296 Statuszügen taten anfangs 117 nichts — jetzt keiner. Was blieb, hat entweder eine Wirkung bekommen oder das Spiel verlassen, weil es Fähigkeiten, Tragegegenstände oder Doppelkämpfe bräuchte.',
      'Zuletzt dazugekommen: Delegator, Wandler, Metronom, Spiegeltrick, Egotrip, Imitator, Schlafrede, Natur-Kraft, Mimikry, Nachahmer, Überflutung, Umwandlung, Typenspiegel, Tarnung, Magiemantel, Erdanziehung, Wunderraum und Plasmaschauer.',
      'Einstiegsfallen: Stachler, Giftspitzen, Tarnsteine und Klebenetz erwarten jeden, der neu ins Feld kommt. Fliegende gehen über die meisten hinweg, ein Giftpokémon räumt die Giftspitzen auf.',
      'Horrorblick und Verwandte halten fest; Verhöhner, Folterknecht, Begrenzer und Heilblockade engen die Zugwahl ein. Dazu Abgesang, Wunschtraum, Bauchtrommel, Heilopfer, Stafette, Leidteiler und die vier Werte-Tauscher.',
      'Fünfzehn weitere Attacken wirken: Grasfeld, Elektrofeld und Nebelfeld verändern den Boden, Wirbelwind und Brüller drängen den Gegner hinaus, dazu Magnetflug, Beschwörung, Zielschuss, Willensleser, Scharfblick, Telekinese, Schnüffler, Wunderauge und Teleport. Platscher tut jetzt ausdrücklich nichts.',
      'Acht Attacken sind raus: Gegenstände tauschen und Umlenkung im Doppelkampf gibt es hier nicht.',
      'Wer sich zurückzieht, lässt Egelsamen, Zugabe und alles andere Anhaltende auf dem Feld zurück — das blieb vorher am Pokémon hängen.',
      'Tausch-Entwicklungen brauchen nur noch ein Verbindungskabel. Acht davon verlangten zusätzlich einen Tragegegenstand — den kann hier aber niemand tragen.',
      'Effekte über Runden: Egelsamen, Wasserring, Nachtmahr, Fluch, Gähner, Zugabe und Aussetzer wirken jetzt — dazu die Schirme Reflektor, Lichtschild, Bodyguard, Weißnebel und Rückenwind.',
      'Zwölf Züge, die Fähigkeiten oder Tragegegenstände brauchen, sind aus dem Spiel — beides gibt es hier nicht.',
      'Rapidschutz, Akupressur und Abgangsbund wirken jetzt auch. Drei reine Doppelkampf-Züge sind dafür ganz aus dem Spiel — Doppelkämpfe wird es nicht geben.',
      'Zwölf weitere Attacken wirken: Schutzschild, Scanner, Ausdauer, Erholung, Heilung, Vitalglocke, Aromakur, Energiefokus, Konzentration, Dunkelnebel, Psycho-Plus und Krafttrick.',
      'Legendäre erscheinen jetzt mit 0,1 % je Erkundung — bei jedem Wetter und zu jeder Zeit, dafür deutlich seltener. Vorher gab es zwei Wege nebeneinander, einer davon zehnmal zu großzügig.',
      'Tanhel, Metang und Metagross galten als legendär, weil sie Fangwert 3 haben. Sie brauchen keine Sagenbeere mehr.',
      'Die Zucht sagt jetzt, wie viel die Brutstation abzieht — und dass ein bereits gelegtes Ei seine Zeit behält.',
      'Ein Spieltag dauert jetzt fünf Stunden statt vierundzwanzig — die Nacht lag vorher für die meisten im Schlaf, und daran hängen zwei Drittel aller zeitgebundenen Pokémon.',
      'Regentanz, Sonnentag, Sandsturm und Hagelsturm stellen jetzt wirklich das Wetter um — sie standen in 79 Attackenplätzen und taten nichts.',
      'Tausch-Entwicklungen zeigten unter Fortschritt → Entwicklung ihren rohen Textschlüssel. Dort steht jetzt „mit Verbindungskabel".',
      'Die Box zeigte nur 200 Pokémon, sortiert nach Level — wer mehr hatte, sah die niedrigstufigen nicht mehr. Betraf auch Markt, Zucht und Tausch-Station.',
      'Duelle: der Mindestabstand sinkt von 1,5 Sekunden auf 0,6 — „Immer mit der Ruhe" kam bei normalem Spiel viel zu oft.',
      'Der Bereich „Designs" heißt jetzt „Einstellungen" — Export, Löschen und der Update-Knopf lagen dort, wo sie niemand vermutet hat.',
      'Verbund: fremde Marktangebote sind sichtbar. Ansehen geht, kaufen noch nicht — dafür braucht es eine Treuhand.',
      'Mew, Celebi und Rayquaza gelten jetzt als legendär: nur mit Sagenbeere zu fangen, und Rayquaza tritt nicht mehr in der Kampfzone an.',
      'Auf schmalen Telefonen lief die Kopfzeile über den Rand hinaus und schob die halbe Seite mit; Gold und Energie rücken dort jetzt zusammen.',
      'Das Expeditionsbüro zeigte seinen Textschlüssel statt seiner Wirkung und hatte kein Symbol. Beides da.',
      'Basis aufgeräumt: die Werkstatt zeigt ihre 26 Rezepte in aufklappbaren Gruppen statt untereinander, mit einem Filter für „jetzt möglich".',
      'Vier Forschungszentren im Labor — Fang & Schillernde, Feld & Expedition, Kampf & Training, Werkstoff & Gerät.',
      'Beutel bekommt Reiter je Art; die Seelenfragmente stehen in einem eigenen statt über allem.',
      'Dieser Bereich hier: nachlesen, was sich geändert hat.',
      'Kampfzone: Beute nach Stufen gestaffelt — jede Region hat zwei Sorten von Anfang an, Sternenstaub kommt ab Serie 50 dazu. Jede Stufe nennt ihre Gegenstände beim Namen.',
      'Alle 21 legendären Arten haben einen Fundort bekommen. Dreizehn kamen vorher in keinem einzigen Gebiet vor und waren damit unerreichbar.',
      'Kampfzone: Eintritt kostet 20 Energie, vollständige Erholung nur noch alle 25 Stufen, Fortschrittsbalken bis zur nächsten Stufe.',
      'Kampfzone gab für jeden Sieg Energie zurück — zwölf Läufe brachten das Dreizehnfache ihres Einsatzes. Behoben.',
      'Zucht: Beim Darüberfahren geht ein Fenster mit Wesen, Veranlagung und allen Werten auf.',
      'Wesen und Veranlagung stehen unter jeder Pokémon-Karte, ein Tipp öffnet sie.',
      'Traumfresser wirkte gegen wache Ziele. Er braucht jetzt ein schlafendes.',
      'Die Top Vier haben einen eigenen Zugang — sie hingen hinter dem gesperrten Trainingsknopf und waren nicht erreichbar.',
      'Tausch-Station zeigte schillernde Formen nicht.',
      'Gebietsbedingungen sprangen zurück (6 → 4 → 5 Pokémon). Ein einmal betretenes Gebiet bleibt jetzt für immer offen.',
      'Expeditionen: drei Plätze statt unbegrenzt, ausbaubar auf neun über das Expeditionsbüro.',
      'Kampfzone und Expeditionen hoben den falschen Reiter hervor.',
      'Verbund mehrerer Installationen: Freunde, Chat und Rangliste über Instanzgrenzen hinweg.',
      'Ein-Klick-Updater für Betreiber, mit Benachrichtigung bei neuem Stand.',
      'Tausch-Entwicklungen über eine Tausch-Station mit Verbindungskabel.',
      'Streuner treten auf Augenhöhe an statt auf dem Niveau ihrer Heimatroute.',
      'Fluchtchance zählt Würfe statt Züge — Schwächen und Beruhigen treiben sie nicht mehr hoch.',
      'Drei Arena-Typen am Tag statt einem.',
      'Raids messen sich an der Gruppe, die es wirklich gibt.',
      'Tages- und Wochenaufgaben.',
      'Trainer stehen in zwei Gebieten: kämpfen, wo man gerade ist.',
      'Drei Texte nannten falsche Zahlen: Arena-Heilung (25 statt 10 %), Poké-Center (alle 10 statt 15 Minuten), Energie (Füllzeit 75 Minuten statt „2 Punkte je Minute").',
    ],
  },
  {
    date: '2026-08-29',
    title: 'Arena, Saison, Labor und ein aufgeräumtes Menü',
    items: [
      'Trainingsarena: vier Kämpfe gegen den Typ des Tages, drei Stufen, Erfahrung ×1,5 / ×2 / ×3.',
      'Tägliche Anmeldebelohnung über vier Wochen und tägliche Geschenke unter Freunden.',
      'Saison auf 25 Stufen erweitert, Wochensaison mit schillerndem Fragment, Punktequellen sichtbar und gedeckelt.',
      'Forschung im Labor, Fleißpunkte und 13 neue Rezepte.',
      'Pension, Brut-Beet und käufliche Brutplätze in der Brutkammer.',
      'Streuner, Fundstücke und der Metalldetektor.',
      'Box verdreifacht, nach fünf Schlüsseln sortierbar — und sie erholt sich endlich.',
      'Gildenziele: zwölf statt vier, je Mitglied gerechnet und endlich zählbar.',
      'Pokédex zeigt Fundorte; die Gebietsliste nennt alle Arten, unbekannte mit ihrer Bedingung.',
      'Shiny-Kurve mehrfach nachgezogen: flacher Anstieg, Plateau, garantierter Fang am Ende der Serie.',
      'Duelle bekommen einen Takt, Kampf-Gold einen Tagesdeckel, ein Gegner zahlt einmal am Tag.',
      'Antrittsgeld: jeder ausgefochtene Kampf zahlt etwas.',
      'Prisma-Linie lernt im Takt ihres Vorbilds; die nächste Attacke steht sichtbar da.',
      'Sechzehn Kacheln und neun Reiter neu geordnet; Basis und Erfolge wurden eigene Bereiche.',
      'Bilder für die sechs Gartenhintergründe.',
      'Startregion Hoenn war unspielbar — Schwellen und Levelforderung folgen jetzt der Region.',
      'Weltuhr sagt, wann Tageszeit und Wetter umspringen.',
      'Zurück führt dahin, wo man hergekommen ist.',
      'Energie über 1.000 Punkte wird zu Gold.',
      'Beutel erreicht das Team; viele Gegner bringen mehr Erfahrung.',
      'Team-Reihenfolge per Doppeltipp.',
      'Die App überlebt ihren eigenen Deploy.',
    ],
  },
  {
    date: '2026-08-28',
    title: 'Der Anfang: drei Regionen, Browserfassung, Überfälle',
    items: [
      'Erste Fassung: Kreaturen-Sammelspiel als Telegram Mini-App.',
      'Hoenn als dritte Region: 13 Gebiete mit eigenen Startern.',
      'Reisegrenze statt Levelkappe — freie Startregion, Regionen laufen parallel.',
      'Skalierung: eine Region senkt sich beim Betreten, einzelne Gebiete heben sich.',
      'Browserfassung mit eigenem Desktop-Bedienfeld, Anmeldung per Einmalcode aus Telegram, Geräteliste.',
      'Lockdüfte, Störsender und Überfälle auf Augenhöhe.',
      'Gegenstände im Kampf, benutzbarer Beutel, Pflege-Erfahrung nach Level, Startpaket.',
      'Verwerten: Pokémon zu Seelenfragmenten, 15 davon zu einem Ei, 85 zu einem schillernden.',
      'Expeditionen mit bis zu sechs Pokémon, gegen Energie vorziehbar.',
      'Sagenbeeren aus dem Laden; Kapitel bekommen ihren Auftrag.',
      'Prisma-Glumanda-Linie zum Finden, Prisma-Abra als Ereignis-Wesen.',
      'Poké-Center wurde schneller, Regionssperre eingeführt, Gebietsmenü repariert.',
      '29 Gegenstands-Icons, 18 Lockduft-Icons und vier Überfall-Trupps gezeichnet.',
      'Taktkontrolle gegen zu schnelles Klicken.',
    ],
  },
]

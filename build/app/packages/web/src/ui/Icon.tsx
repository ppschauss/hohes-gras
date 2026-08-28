/**
 * Ein Strichzeichen-Satz statt Emoji.
 *
 * Emoji waren der schnellste Weg zu Symbolen und der schlechteste: sie sehen
 * auf jedem Gerät anders aus, tragen fremde Farben in eine Oberfläche, die
 * ihre Sättigung für Daten reserviert, und lassen sich nicht auf die Textfarbe
 * einstellen. Alles hier liegt auf demselben 24er-Raster, mit derselben
 * Strichstärke, und erbt `currentColor`.
 */
export type IconName =
  | 'home' | 'garden' | 'map' | 'team' | 'friends'
  | 'center' | 'plots' | 'expedition' | 'egg' | 'guild' | 'progress'
  | 'shop' | 'energy' | 'gold' | 'dex' | 'back' | 'chevron' | 'check'
  | 'weather' | 'clock' | 'spark'
  | 'feed' | 'play' | 'wash' | 'rest'

interface Props {
  name: IconName
  size?: number
  className?: string
}

/** Pfade auf einem 24×24-Raster, Strichstärke 1.75, runde Enden. */
const PATHS: Record<IconName, string> = {
  // Haus mit Giebel — der Startbildschirm.
  home: 'M4 11 12 4l8 7M6.5 9.5V19h11V9.5M10 19v-4.5h4V19',
  // Giesskanne. Bewusst nicht noch ein Blatt: der Garten stand sonst neben dem
  // Beet, und bei 24 Punkten waren beide derselbe Keimling.
  garden: 'M4 10h9v6.5A3.5 3.5 0 0 1 9.5 20h-2A3.5 3.5 0 0 1 4 16.5ZM13 12l5-3.5V16M6.5 10V8a2.5 2.5 0 0 1 5 0v2',
  // Gefaltete Landkarte.
  map: 'm3 6.5 6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5v-13M9 4v14M15 6.5v14',
  // Drei Köpfe: das Team.
  team: 'M9 10.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2ZM3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16 6.2a2.2 2.2 0 1 1 0 4.4M17 14.2c2 .6 3.5 2.4 3.5 4.8',
  // Zwei Personen, einander zugewandt.
  friends: 'M8 10.6a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4ZM16 10.6a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4ZM2.5 19c0-2.9 2.4-4.8 5.5-4.8M21.5 19c0-2.9-2.4-4.8-5.5-4.8',
  // Kreuz im Rahmen — die Station.
  center: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5ZM12 8.5v7M8.5 12h7',
  // Keimling über einer Erdlinie, mit Furchen: das Beet.
  plots: 'M2.5 17.5h19M4.5 20.5h15M12 17.5v-5.5M12 12c0-2.3 1.7-3.8 4.2-3.8 0 2.5-1.7 3.8-4.2 3.8ZM12 14.2c0-1.9-1.4-3.1-3.6-3.1 0 2.1 1.4 3.1 3.6 3.1Z',
  // Kompassrose.
  expedition: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5Z',
  // Ei.
  egg: 'M12 20.5c3.3 0 5.5-2.3 5.5-5.6C17.5 10.5 15 3.5 12 3.5S6.5 10.5 6.5 14.9c0 3.3 2.2 5.6 5.5 5.6Z',
  // Wappenschild.
  guild: 'M12 3.5 19 6v6c0 4.2-3 7-7 8.5-4-1.5-7-4.3-7-8.5V6Z',
  // Steigende Linie mit Achsen.
  progress: 'M4 4v16h16M7.5 15.5l3.5-4 3 2.5 4.5-6',
  // Einkaufstasche.
  shop: 'M5.5 8h13l-1 11.5h-11ZM9 8V6.2A3 3 0 0 1 12 3.2 3 3 0 0 1 15 6.2V8',
  // Blitz.
  energy: 'M13.5 3 6 13.2h5L10.5 21 18 10.8h-5Z',
  // Münze mit Kante.
  gold: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.8v8.4M14.4 9.6c-.6-.7-1.5-1-2.4-1-1.4 0-2.4.7-2.4 1.8 0 2.4 4.8 1.2 4.8 3.6 0 1.1-1 1.9-2.4 1.9-1 0-1.9-.4-2.4-1.1',
  // Aufgeschlagenes Buch.
  dex: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5ZM20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5Z',
  back: 'M14.5 5 8 12l6.5 7',
  chevron: 'M9.5 5 16 12l-6.5 7',
  check: 'M5 12.5 9.5 17 19 7',
  // Wolke mit Sonne.
  weather: 'M8.5 8.5a3.5 3.5 0 1 1 6.2 2.2M7.5 19h9a3.2 3.2 0 0 0 0-6.4 4.6 4.6 0 0 0-9 1 2.7 2.7 0 0 0 0 5.4Z',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2',
  // Beere mit Stiel und Blatt — füttern.
  feed: 'M12 20a5.5 5.5 0 0 0 5.5-5.5c0-3-2.5-5-5.5-5s-5.5 2-5.5 5A5.5 5.5 0 0 0 12 20ZM12 9.5V5.5M12 6.5c2.2 0 3.6-1 4-3-2.4-.2-3.8.7-4 3Z',
  // Ball mit Band und Knopf — spielen. Der gekreuzte Entwurf davor las sich
  // bei 22 Punkten als durchgestrichener Kreis, also als "verboten".
  play: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM4 12h4.4M15.6 12H20M12 14.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z',
  // Tropfen — waschen.
  wash: 'M12 3.5c3 3.7 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5.3 5-9Z',
  // Mond — ausruhen.
  rest: 'M19 14.5A7.5 7.5 0 0 1 9.5 5 7.8 7.8 0 1 0 19 14.5Z',
  // Vierzackiger Funke — Belohnung, Neues.
  spark: 'M12 3.5c0 4 1.5 5.5 5.5 5.5-4 0-5.5 1.5-5.5 5.5 0-4-1.5-5.5-5.5-5.5 4 0 5.5-1.5 5.5-5.5ZM18 15.5c0 1.8.7 2.5 2.5 2.5-1.8 0-2.5.7-2.5 2.5 0-1.8-.7-2.5-2.5-2.5 1.8 0 2.5-.7 2.5-2.5Z',
}

export function Icon({ name, size = 22, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

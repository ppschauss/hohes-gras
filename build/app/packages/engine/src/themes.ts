import { clamp } from './stats.js'

/**
 * Designs.
 *
 * Ein Design ist keine Liste fertiger Farbwerte, sondern eine Handvoll
 * Parameter — Grundton, Akzent, Zweitfarbe, Intensität —, aus denen die
 * vollständige Palette *gerechnet* wird. Zwei Gründe:
 *
 *  1. Jedes Design braucht zwei Fassungen, Tag und Nacht. Von Hand wären das
 *     zwei Dutzend Farbwerte pro Design, jede einzeln auf Kontrast zu prüfen.
 *  2. Die Helligkeitsstufen und Kontraste sollen über alle Designs identisch
 *     sein. Was sich unterscheidet, ist der Ton — nicht die Lesbarkeit.
 *
 * Gerechnet wird in OKLCH: dort ist L wahrgenommene Helligkeit, und eine feste
 * L-Leiter liefert in jedem Farbton denselben Kontrast. In sRGB wäre das nicht
 * so; ein sattes Blau und ein sattes Gelb mit gleichem "Helligkeitswert" sind
 * dort verschieden gut lesbar.
 */

export type ThemeGroup = 'basis' | 'typ' | 'region' | 'anime'
export type ThemeMode = 'day' | 'night'

export interface ThemeDef {
  id: string
  group: ThemeGroup
  /** Preis in Gold. 0 = von Anfang an dabei. */
  price: number
  /** Grundton der Flächen. */
  groundHue: number
  /** Wie stark die Flächen den Grundton tragen. 0 = neutral. */
  groundChroma: number
  /** Interaktion: Knöpfe, aktive Zustände. */
  accentHue: number
  accentChroma: number
  /** Zweitfarbe für Fortschritt und Erfolg. */
  spotHue: number
  spotChroma: number
}

/** Feste Helligkeitsleiter je Modus. Nur hier stehen die Kontraste. */
const LADDER: Record<ThemeMode, {
  ground: number; surface: number; raised: number; sunken: number
  edge: number; edgeStrong: number
  ink: number; inkMuted: number; inkFaint: number
  accent: number; accentInk: number; accentSoft: number
}> = {
  night: {
    ground: 0.145, surface: 0.196, raised: 0.242, sunken: 0.122,
    edge: 0.30, edgeStrong: 0.42,
    ink: 0.965, inkMuted: 0.795, inkFaint: 0.665,
    accent: 0.80, accentInk: 0.16, accentSoft: 0.30,
  },
  day: {
    ground: 0.975, surface: 0.945, raised: 0.905, sunken: 0.925,
    edge: 0.855, edgeStrong: 0.72,
    ink: 0.245, inkMuted: 0.435, inkFaint: 0.505,
    // Bewusst dunkel: ein mittelheller Knopf hat weder gegen weisse noch
    // gegen schwarze Schrift genug Abstand. Dunkel und satt, Schrift weiss.
    accent: 0.42, accentInk: 0.99, accentSoft: 0.88,
  },
}

const oklch = (l: number, c: number, h: number): string =>
  `oklch(${l.toFixed(3)} ${Math.max(0, c).toFixed(4)} ${h.toFixed(1)})`

/**
 * Die vollständige Palette eines Designs als CSS-Variablen.
 *
 * Die semantischen Farben (Gold, Energie, Gefahr, Wachstum) verschieben sich
 * mit dem Modus, aber nicht mit dem Design: Gold muss in jedem Design nach
 * Gold aussehen, sonst wäre es keine Bedeutung mehr, sondern Dekoration.
 */
export function paletteOf(theme: ThemeDef, mode: ThemeMode): Record<string, string> {
  const L = LADDER[mode]
  const gh = theme.groundHue
  const gc = theme.groundChroma
  const night = mode === 'night'

  /*
   * Im Hellen braucht dieselbe Tönung MEHR Chroma, nicht weniger.
   *
   * Das war zuerst andersherum gerechnet, aus der Vermutung, helle Flächen
   * würden Farbe stärker tragen. Das Gegenteil stimmt: bei L 0.95 ist der
   * darstellbare Farbraum schmal und die wahrgenommene Sättigung fällt ab —
   * 0.017 Chroma auf beinahe Weiß ist schlicht Weiß. Ein Design war im
   * Tag-Modus dadurch praktisch unsichtbar.
   */
  const surfaceC = night ? gc * 1.35 : gc * 2.2
  const accentC = night ? theme.accentChroma : theme.accentChroma * 0.9
  // Die Schrift auf dem Knopf richtet sich nach dem Knopf, nicht nach dem
  // Modus: so bleibt sie auch dann lesbar, wenn ein Design die Leiter einmal
  // anders ausnutzt.
  const accentInkL = L.accent > 0.62 ? 0.16 : 0.99

  return {
    '--ground': oklch(L.ground, surfaceC * (night ? 1.1 : 0.9), gh),
    '--surface': oklch(L.surface, surfaceC, gh),
    '--surface-raised': oklch(L.raised, surfaceC * 0.95, gh),
    '--surface-sunken': oklch(L.sunken, surfaceC * 1.15, gh),
    '--edge': oklch(L.edge, surfaceC * 0.9, gh),
    '--edge-strong': oklch(L.edgeStrong, surfaceC, gh),

    // Text nimmt einen Hauch des Grundtons auf, damit er in der Fläche liegt
    // statt darauf zu schwimmen — aber nur einen Hauch.
    '--ink': oklch(L.ink, Math.min(surfaceC, 0.012), gh),
    '--ink-muted': oklch(L.inkMuted, Math.min(surfaceC, 0.014), gh),
    '--ink-faint': oklch(L.inkFaint, Math.min(surfaceC, 0.016), gh),

    '--accent': oklch(L.accent, accentC, theme.accentHue),
    '--accent-ink': oklch(accentInkL, Math.min(accentC * 0.2, 0.03), theme.accentHue),
    '--accent-soft': oklch(L.accentSoft, accentC * 0.35, theme.accentHue),
    '--accent-ring': `oklch(${L.accent.toFixed(3)} ${accentC.toFixed(4)} ${theme.accentHue.toFixed(1)} / 0.55)`,

    '--nature': oklch(night ? 0.70 : 0.52, theme.spotChroma, theme.spotHue),
    '--nature-deep': oklch(night ? 0.44 : 0.40, theme.spotChroma * 0.7, theme.spotHue),

    // Bedeutungsfarben bleiben, was sie sind.
    '--gold': oklch(night ? 0.815 : 0.60, 0.125, 82),
    '--energy': oklch(night ? 0.855 : 0.62, 0.145, 96),
    '--danger': oklch(night ? 0.645 : 0.545, 0.175, 25),
    '--warn': oklch(night ? 0.775 : 0.60, 0.125, 62),
    '--ok': oklch(night ? 0.70 : 0.52, theme.spotChroma, theme.spotHue),

    '--shadow-sm': night ? '0 1px 2px oklch(0 0 0 / 0.4)' : '0 1px 2px oklch(0 0 0 / 0.10)',
    '--shadow': night ? '0 6px 20px oklch(0 0 0 / 0.45)' : '0 6px 20px oklch(0 0 0 / 0.12)',
    '--shadow-lg': night ? '0 16px 40px oklch(0 0 0 / 0.55)' : '0 16px 40px oklch(0 0 0 / 0.16)',
  }
}

/** Zwei Farben für die Vorschaukachel im Design-Laden. */
export function swatchesOf(theme: ThemeDef, mode: ThemeMode): { ground: string; accent: string; spot: string } {
  const p = paletteOf(theme, mode)
  return { ground: p['--ground']!, accent: p['--accent']!, spot: p['--nature']! }
}

/**
 * Der Katalog.
 *
 * Preise steigen mit dem Aufwand, den ein Design voraussetzt: Typ-Designs sind
 * früh erreichbar, Regionen kosten eine Weile Spielzeit, das Champion-Design
 * ist ein Zielpunkt.
 */
export const THEMES: ThemeDef[] = [
  { id: 'nachtgruen', group: 'basis', price: 0,
    groundHue: 158, groundChroma: 0.015, accentHue: 128, accentChroma: 0.055, spotHue: 152, spotChroma: 0.125 },

  // --- Typen: die Elemente des Spiels ------------------------------------
  { id: 'flamme', group: 'typ', price: 3000,
    groundHue: 32, groundChroma: 0.022, accentHue: 42, accentChroma: 0.15, spotHue: 62, spotChroma: 0.14 },
  { id: 'welle', group: 'typ', price: 3000,
    groundHue: 240, groundChroma: 0.024, accentHue: 232, accentChroma: 0.14, spotHue: 205, spotChroma: 0.13 },
  { id: 'blattwerk', group: 'typ', price: 3000,
    groundHue: 145, groundChroma: 0.024, accentHue: 138, accentChroma: 0.14, spotHue: 118, spotChroma: 0.14 },
  { id: 'gewitter', group: 'typ', price: 4500,
    groundHue: 285, groundChroma: 0.022, accentHue: 98, accentChroma: 0.16, spotHue: 92, spotChroma: 0.15 },
  { id: 'trugbild', group: 'typ', price: 4500,
    groundHue: 320, groundChroma: 0.024, accentHue: 330, accentChroma: 0.15, spotHue: 300, spotChroma: 0.13 },
  { id: 'firn', group: 'typ', price: 4500,
    groundHue: 210, groundChroma: 0.020, accentHue: 200, accentChroma: 0.12, spotHue: 190, spotChroma: 0.12 },

  // --- Regionen -----------------------------------------------------------
  { id: 'kanto', group: 'region', price: 12000,
    groundHue: 258, groundChroma: 0.026, accentHue: 25, accentChroma: 0.16, spotHue: 245, spotChroma: 0.14 },
  { id: 'johto', group: 'region', price: 12000,
    groundHue: 268, groundChroma: 0.018, accentHue: 88, accentChroma: 0.13, spotHue: 250, spotChroma: 0.10 },

  // --- Champion -----------------------------------------------------------
  { id: 'champion', group: 'region', price: 40000,
    groundHue: 45, groundChroma: 0.028, accentHue: 82, accentChroma: 0.155, spotHue: 60, spotChroma: 0.14 },

  // --- Anime --------------------------------------------------------------
  { id: 'sakura', group: 'anime', price: 8000,
    groundHue: 350, groundChroma: 0.022, accentHue: 355, accentChroma: 0.13, spotHue: 20, spotChroma: 0.12 },
  { id: 'neonstadt', group: 'anime', price: 15000,
    groundHue: 300, groundChroma: 0.030, accentHue: 328, accentChroma: 0.19, spotHue: 195, spotChroma: 0.17 },
  { id: 'abendrot', group: 'anime', price: 8000,
    groundHue: 18, groundChroma: 0.026, accentHue: 30, accentChroma: 0.15, spotHue: 350, spotChroma: 0.13 },
  { id: 'tuschezeichnung', group: 'anime', price: 6000,
    groundHue: 250, groundChroma: 0.006, accentHue: 250, accentChroma: 0.02, spotHue: 250, spotChroma: 0.03 },
]

export const findTheme = (id: string): ThemeDef | undefined => THEMES.find((t) => t.id === id)
export const DEFAULT_THEME = THEMES[0]!

/** Auflösung von "automatisch": tagsüber hell, abends dunkel. */
export function modeForTimeOfDay(timeOfDay: string): ThemeMode {
  return timeOfDay === 'day' || timeOfDay === 'dawn' ? 'day' : 'night'
}

export const THEME_MODES = ['auto', 'day', 'night'] as const
export type ThemeSetting = (typeof THEME_MODES)[number]

export function resolveMode(setting: ThemeSetting, timeOfDay: string): ThemeMode {
  return setting === 'auto' ? modeForTimeOfDay(timeOfDay) : setting
}

export const clampChroma = (c: number): number => clamp(c, 0, 0.4)

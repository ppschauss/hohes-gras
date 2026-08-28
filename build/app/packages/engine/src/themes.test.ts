import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME, THEMES, findTheme, modeForTimeOfDay, paletteOf, resolveMode, swatchesOf,
} from './themes.js'

/** L-Wert aus einem oklch()-String ziehen — die Helligkeit ist das, worauf es
 *  beim Kontrast ankommt. */
const lightnessOf = (css: string): number => Number(/oklch\(([\d.]+)/.exec(css)![1])
const chromaOf = (css: string): number => Number(/oklch\([\d.]+ ([\d.]+)/.exec(css)![1])

describe('Katalog', () => {
  it('hat eindeutige Kennungen', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
  })

  it('beginnt mit einem kostenlosen Grunddesign', () => {
    expect(DEFAULT_THEME.price).toBe(0)
    expect(THEMES.filter((t) => t.price === 0)).toHaveLength(1)
  })

  it('deckt alle vier Gruppen ab', () => {
    for (const group of ['basis', 'typ', 'region', 'anime']) {
      expect(THEMES.some((t) => t.group === group)).toBe(true)
    }
  })

  it('findet Designs nur unter ihrer eigenen Kennung', () => {
    expect(findTheme('champion')?.group).toBe('region')
    expect(findTheme('gibtsnicht')).toBeUndefined()
  })
})

describe('paletteOf', () => {
  it('liefert in jedem Design und Modus denselben Satz Variablen', () => {
    const reference = Object.keys(paletteOf(DEFAULT_THEME, 'night')).sort()
    for (const theme of THEMES) {
      for (const mode of ['day', 'night'] as const) {
        expect(Object.keys(paletteOf(theme, mode)).sort()).toEqual(reference)
      }
    }
  })

  it('haelt Text und Flaeche in jedem Design weit auseinander', () => {
    // Der eigentliche Zweck der gerechneten Palette: Lesbarkeit darf nicht vom
    // gewaehlten Design abhaengen.
    for (const theme of THEMES) {
      for (const mode of ['day', 'night'] as const) {
        const p = paletteOf(theme, mode)
        const surface = lightnessOf(p['--surface']!)
        expect(Math.abs(lightnessOf(p['--ink']!) - surface)).toBeGreaterThan(0.6)
        expect(Math.abs(lightnessOf(p['--ink-muted']!) - surface)).toBeGreaterThan(0.45)
        // Der blasseste Text ist die kritische Stelle.
        expect(Math.abs(lightnessOf(p['--ink-faint']!) - surface)).toBeGreaterThan(0.4)
      }
    }
  })

  it('dreht die Helligkeit zwischen Tag und Nacht wirklich um', () => {
    for (const theme of THEMES) {
      const night = paletteOf(theme, 'night')
      const day = paletteOf(theme, 'day')
      expect(lightnessOf(night['--ground']!)).toBeLessThan(0.3)
      expect(lightnessOf(day['--ground']!)).toBeGreaterThan(0.9)
      // Und der Text dreht mit.
      expect(lightnessOf(night['--ink']!)).toBeGreaterThan(0.9)
      expect(lightnessOf(day['--ink']!)).toBeLessThan(0.35)
    }
  })

  it('haelt den Knopf gegen seine eigene Schrift lesbar', () => {
    for (const theme of THEMES) {
      for (const mode of ['day', 'night'] as const) {
        const p = paletteOf(theme, mode)
        const diff = Math.abs(lightnessOf(p['--accent']!) - lightnessOf(p['--accent-ink']!))
        expect(diff).toBeGreaterThan(0.55)
      }
    }
  })

  it('macht Designs im Hellen mindestens so sichtbar wie im Dunklen', () => {
    // Der Fehler, der das hier ausgeloest hat: im Tag-Modus war die Chroma
    // heruntergerechnet, und ein Design mit knapp 0.017 Chroma auf L 0.95 ist
    // von Weiss nicht zu unterscheiden.
    for (const theme of THEMES) {
      if (theme.groundChroma === 0) continue
      const night = chromaOf(paletteOf(theme, 'night')['--surface']!)
      const day = chromaOf(paletteOf(theme, 'day')['--surface']!)
      expect(day).toBeGreaterThanOrEqual(night)
    }
  })

  it('laesst Bedeutungsfarben vom Design unberuehrt', () => {
    // Gold muss in jedem Design nach Gold aussehen, sonst ist es Dekoration.
    const golds = new Set(THEMES.map((t) => paletteOf(t, 'night')['--gold']))
    expect(golds.size).toBe(1)
    const dangers = new Set(THEMES.map((t) => paletteOf(t, 'night')['--danger']))
    expect(dangers.size).toBe(1)
  })

  it('gibt dem Grunddesign spuerbar weniger Farbe als den bunten', () => {
    // Die Grundeinstellung soll zurueckhaltend bleiben — aber nicht farblos:
    // im Hellen war ein fast unbunter Akzent ein graues Nichts von Knopf.
    const base = chromaOf(paletteOf(DEFAULT_THEME, 'night')['--accent']!)
    const neon = chromaOf(paletteOf(findTheme('neonstadt')!, 'night')['--accent']!)
    expect(neon).toBeGreaterThan(base * 3)
    expect(base).toBeGreaterThan(0.03)
  })

  it('haelt jede Chroma im darstellbaren Bereich', () => {
    for (const theme of THEMES) {
      for (const mode of ['day', 'night'] as const) {
        for (const value of Object.values(paletteOf(theme, mode))) {
          if (!value.startsWith('oklch(')) continue
          expect(chromaOf(value)).toBeLessThan(0.35)
        }
      }
    }
  })
})

describe('Tag und Nacht', () => {
  it('folgt der Weltuhr', () => {
    expect(modeForTimeOfDay('dawn')).toBe('day')
    expect(modeForTimeOfDay('day')).toBe('day')
    expect(modeForTimeOfDay('dusk')).toBe('night')
    expect(modeForTimeOfDay('night')).toBe('night')
  })

  it('laesst sich fest vorgeben', () => {
    expect(resolveMode('day', 'night')).toBe('day')
    expect(resolveMode('night', 'day')).toBe('night')
    expect(resolveMode('auto', 'night')).toBe('night')
  })
})

describe('swatchesOf', () => {
  it('liefert drei unterscheidbare Farben je Design', () => {
    for (const theme of THEMES) {
      const s = swatchesOf(theme, 'night')
      expect(new Set([s.ground, s.accent, s.spot]).size).toBe(3)
    }
  })
})

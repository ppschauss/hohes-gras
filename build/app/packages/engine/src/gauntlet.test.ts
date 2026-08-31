import { describe, expect, it } from 'vitest'
import {
  dropsForRegion, gauntletGoldPerWin, gauntletIv, gauntletLevel, gauntletMaxBst,
  GAUNTLET_MILESTONES, GAUNTLET_XP_MULTIPLIER, gauntletXpMultiplier, milestoneAt, nextMilestone,
  rollGauntletDrops, splitDrops,
} from './gauntlet.js'

describe('Kampfzone', () => {
  it('faengt unter dem eigenen Durchschnitt an und zieht nach', () => {
    // Der Einstieg ist ein Aufwaermen: drei Level darunter.
    expect(gauntletLevel(40, 0, 500)).toBe(37)
    // Ab dreissig wieder auf Augenhoehe.
    expect(gauntletLevel(40, 30, 500)).toBe(40)
    expect(gauntletLevel(40, 100, 500)).toBe(47)
    // Die Reisegrenze gilt auch hier.
    expect(gauntletLevel(40, 500, 42)).toBe(42)
  })

  it('haelt die ersten Gegner klein — auch die, die kein Legendaerer sind', () => {
    /*
     * Gemeldet nach dem ersten Lauf: **Rayquaza als erster Gegner.** Der
     * Filter hatte auf den Fangwert gesetzt, und im Pack steht bei Rayquaza
     * 45 statt 3. Die Grundwertsumme ist das Mass, das wirklich traegt —
     * dieselbe Lehre wie in der Arena, wo Tauros auf "leicht" antrat.
     */
    expect(gauntletMaxBst(0)).toBe(400)
    expect(gauntletMaxBst(9)).toBe(400)
    expect(gauntletMaxBst(10)).toBe(470)
    expect(gauntletMaxBst(25)).toBe(540)
    // Rayquaza hat 680 und darf damit erst ab fuenfzig antreten.
    expect(gauntletMaxBst(50)).toBe(0)
    for (let s = 1; s < 60; s++) {
      const a = gauntletMaxBst(s - 1), b = gauntletMaxBst(s)
      if (a !== 0 && b !== 0) expect(b).toBeGreaterThanOrEqual(a)
    }
  })

  it('macht die Gegner mit der Serie staerker, aber nie ueber das Moegliche', () => {
    expect(gauntletIv(0)).toBe(8)
    expect(gauntletIv(100)).toBe(31)
    expect(gauntletIv(1000)).toBe(31)
    for (let s = 1; s < 200; s++) expect(gauntletIv(s)).toBeGreaterThanOrEqual(gauntletIv(s - 1))
  })

  it('zahlt je Sieg mehr, je laenger die Serie', () => {
    expect(gauntletGoldPerWin(0)).toBeLessThan(gauntletGoldPerWin(50))
  })

  describe('Stufen', () => {
    it('trifft nur genau auf der Stufe', () => {
      expect(milestoneAt(10)?.at).toBe(10)
      expect(milestoneAt(11)).toBeNull()
      expect(milestoneAt(0)).toBeNull()
    })

    it('nennt die naechste, und ueber hundert keine mehr', () => {
      expect(nextMilestone(0)?.at).toBe(10)
      expect(nextMilestone(10)?.at).toBe(15)
      expect(nextMilestone(100)).toBeNull()
    })

    it('steigt durchgehend an', () => {
      for (let i = 1; i < GAUNTLET_MILESTONES.length; i++) {
        const a = GAUNTLET_MILESTONES[i - 1]!, b = GAUNTLET_MILESTONES[i]!
        expect(b.at).toBeGreaterThan(a.at)
        expect(b.gold).toBeGreaterThan(a.gold)
        expect(b.materials).toBeGreaterThan(a.materials)
      }
    })

    it('heilt an jeder Stufe vollstaendig', () => {
      // Ohne das waeren fuenfzig unerreichbar; mit Heilung nach jedem Kampf
      // gaebe es kein Risiko. Die Stufen sind die Rastplaetze.
      expect(GAUNTLET_MILESTONES.every((m) => m.heals)).toBe(true)
    })
  })

  describe('Regionsbeute', () => {
    it('gibt jeder bekannten Region eigene Werkstoffe', () => {
      const kanto = dropsForRegion('kanto')
      const johto = dropsForRegion('johto')
      expect(kanto).not.toEqual(johto)
      expect(kanto.length).toBeGreaterThan(0)
    })

    it('faengt eine unbekannte Region auf', () => {
      expect(dropsForRegion('gibtsnicht').length).toBeGreaterThan(0)
    })

    it('verteilt die Menge vollstaendig, ohne Rest', () => {
      for (const total of [1, 3, 4, 7, 15, 35]) {
        const teile = splitDrops('kanto', total)
        expect(teile.reduce((s, d) => s + d.quantity, 0)).toBe(total)
        expect(teile.every((d) => d.quantity > 0)).toBe(true)
      }
    })

    it('gibt bei null nichts', () => {
      expect(splitDrops('kanto', 0)).toEqual([])
    })
  })
})

describe('Beute je Kampf', () => {
  /** Ein Wuerfel mit festen Werten — so laesst sich jeder Zweig genau treffen. */
  const rng = (werte: number[], pickIndex = 0) => {
    let i = 0
    return {
      next: () => werte[i++] ?? 1,
      int: (min: number) => min,
      pick: <T,>(items: readonly T[]) => items[pickIndex]!,
    }
  }

  it('gibt Baelle und Werkstoffe, wenn beide Wuerfe treffen', () => {
    const drops = rollGauntletDrops(rng([0, 0]), 'kanto', 0)
    expect(drops).toHaveLength(2)
    expect(drops[0]!.itemId).toBe('poke-ball')
    expect(dropsForRegion('kanto')).toContain(drops[1]!.itemId)
  })

  it('gibt nichts, wenn beide Wuerfe danebengehen', () => {
    expect(rollGauntletDrops(rng([1, 1]), 'kanto', 0)).toEqual([])
  })

  it('gibt mit der Serie bessere Baelle statt nur mehr davon', () => {
    // Zwanzig Poekebaelle mehr aendern nichts, drei Superbaelle schon.
    expect(rollGauntletDrops(rng([0, 1]), 'kanto', 0)[0]!.itemId).toBe('poke-ball')
    expect(rollGauntletDrops(rng([0, 1]), 'kanto', 20)[0]!.itemId).toBe('great-ball')
    expect(rollGauntletDrops(rng([0, 1]), 'kanto', 50)[0]!.itemId).toBe('ultra-ball')
  })

  it('nimmt die Werkstoffe der jeweiligen Region', () => {
    const kanto = rollGauntletDrops(rng([1, 0]), 'kanto', 0)[0]!
    const johto = rollGauntletDrops(rng([1, 0]), 'johto', 0)[0]!
    expect(dropsForRegion('kanto')).toContain(kanto.itemId)
    expect(dropsForRegion('johto')).toContain(johto.itemId)
    expect(kanto.itemId).not.toBe(johto.itemId)
  })
})

describe('Erfahrung', () => {
  it('flacht ueber die Serie ab, statt linear zu wachsen', () => {
    /*
     * Gemeldet: 24.529 EP aus 33 Kaempfen. Jeder Gegner hat eine eigene
     * Kennung, gilt also immer als erster Sieg — bei Faktor 2,5 waren das
     * 928 EP je Kampf, fuenfmal ein wiederholter Routentrainer, unbegrenzt oft.
     *
     * Ohne Abflachung waere eine Serie von zweihundert schlicht
     * zweihundertmal der erste Kampf.
     */
    const a = gauntletXpMultiplier(0)
    const b = gauntletXpMultiplier(50)
    const c = gauntletXpMultiplier(200)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
    expect(a).toBeCloseTo(GAUNTLET_XP_MULTIPLIER, 6)
  })

  it('bleibt immer positiv', () => {
    expect(gauntletXpMultiplier(10_000)).toBeGreaterThan(0)
    // Negative Staende gibt es nicht, sollen aber nichts kaputt machen.
    expect(gauntletXpMultiplier(-5)).toBeCloseTo(GAUNTLET_XP_MULTIPLIER, 6)
  })

  it('bleibt beim Einstieg ueber einem wiederholten Routentrainer', () => {
    // Der Vergleich, der zaehlt: die Kampfzone soll sich lohnen, aber nicht
    // die Arena und das Kaempfen auf der Route entwerten.
    expect(GAUNTLET_XP_MULTIPLIER).toBeGreaterThan(0.5)
    expect(GAUNTLET_XP_MULTIPLIER).toBeLessThan(2)
  })
})

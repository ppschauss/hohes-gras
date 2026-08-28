import { describe, expect, it } from 'vitest'
import type { AreaDef } from '@game/content'
import {
  LEVEL_CAP, areaBand, bandOffset, referenceLevel, regionOffset, shiftBand, shiftLevel,
} from './scaling.js'
import { ABSOLUTE_MAX_LEVEL } from './leveling.js'

const area = (spawns: Array<[number, number]>): AreaDef => ({
  spawns: spawns.map(([minLevel, maxLevel]) => ({ speciesId: 'x', weight: 1, minLevel, maxLevel })),
} as unknown as AreaDef)

describe('referenceLevel', () => {
  it('nimmt den Median bei ungerader Anzahl', () => {
    expect(referenceLevel([10, 30, 20])).toBe(20)
  })

  it('mittelt bei gerader Anzahl', () => {
    expect(referenceLevel([10, 20, 30, 40])).toBe(25)
  })

  it('laesst sich von einem einzelnen Ausreisser nicht mitziehen', () => {
    // Genau der Fall, um den es geht: ein getauschtes Pokemon auf Level 90
    // darf die Welt nicht fuer den Rest des Teams unspielbar machen.
    expect(referenceLevel([5, 5, 5, 5, 90])).toBe(5)
  })

  it('ist bei leerem Team null', () => {
    expect(referenceLevel([])).toBe(0)
  })

  it('ignoriert unsinnige Werte', () => {
    expect(referenceLevel([0, -3, 12, Number.NaN])).toBe(12)
  })
})

describe('areaBand', () => {
  it('spannt das Band ueber alle Spawns', () => {
    expect(areaBand(area([[2, 5], [3, 9], [1, 4]]))).toEqual({ min: 1, max: 9 })
  })

  it('bleibt bei einem Gebiet ohne Spawns brauchbar', () => {
    expect(areaBand(area([]))).toEqual({ min: 1, max: 1 })
  })
})

describe('bandOffset', () => {
  const band = { min: 2, max: 6 }

  it('laesst ein Gebiet in Ruhe, solange man darunter oder darin liegt', () => {
    expect(bandOffset(band, 0)).toBe(0)
    expect(bandOffset(band, 3)).toBe(0)
    expect(bandOffset(band, 6)).toBe(0)
  })

  it('hebt das Band an, sobald man darueber liegt', () => {
    expect(bandOffset(band, 7)).toBe(1)
    expect(bandOffset(band, 60)).toBe(54)
  })

  it('macht ein Gebiet nie leichter', () => {
    // Auch mit einem Level-1-Team bleibt der Silberberg der Silberberg.
    expect(bandOffset({ min: 84, max: 94 }, 1)).toBe(0)
  })

  it('stoesst nicht ueber die absolute Levelgrenze hinaus', () => {
    expect(bandOffset({ min: 84, max: 94 }, 100)).toBe(6)
    expect(bandOffset({ min: 84, max: 94 }, 99_999)).toBe(LEVEL_CAP - 94)
  })

  it('haelt die Bandbreite konstant', () => {
    const shifted = shiftBand(band, bandOffset(band, 50))
    expect(shifted.max - shifted.min).toBe(band.max - band.min)
    expect(shifted.max).toBe(50)
  })
})

describe('regionOffset', () => {
  const kanto = { min: 2, max: 6 }
  const johto = { min: 58, max: 64 }

  it('hebt eine Region auf das Niveau ihres Besuchers', () => {
    expect(regionOffset(kanto, 95)).toBe(89)
  })

  it('senkt sie auch — das ist der ganze Punkt', () => {
    // Ohne diese Richtung waere eine frei waehlbare Startregion eine Luege:
    // Johto beginnt bei Level 58, ein Anfaenger hat Level 5.
    expect(regionOffset(johto, 5)).toBe(-56)
  })

  it('laesst das schwaechste Gebiet nie unter Level 2 fallen', () => {
    const offset = regionOffset(johto, 1)
    expect(johto.min + offset).toBeGreaterThanOrEqual(2)
  })

  it('haelt die innere Steigung der Region', () => {
    // Der Silberberg bleibt haerter als Route 29, egal wann man kommt.
    const offset = regionOffset(johto, 20)
    const start = { min: 58 + offset, max: 64 + offset }
    const end = { min: 84 + offset, max: 94 + offset }
    expect(end.min).toBeGreaterThan(start.max)
  })

  it('respektiert die uebergebene Reisegrenze', () => {
    expect(johto.max + regionOffset(johto, 400, 150)).toBeLessThanOrEqual(150)
  })
})

describe('shiftLevel', () => {
  it('verschiebt und klemmt an beiden Enden', () => {
    expect(shiftLevel(10, 5)).toBe(15)
    expect(shiftLevel(98, 10)).toBe(108)
    expect(shiftLevel(ABSOLUTE_MAX_LEVEL - 2, 10)).toBe(LEVEL_CAP)
    expect(shiftLevel(3, -10)).toBe(1)
  })
})

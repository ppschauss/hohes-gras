import { describe, expect, it } from 'vitest'
import { sortCreatures, type SortableCreature } from './sortCreatures.js'

const c = (
  dexNumber: number, displayName: string, level: number,
  shiny = false, type = 'Normal',
): SortableCreature => ({ dexNumber, displayName, level, shiny, types: [{ name: type }] })

const names = (list: SortableCreature[]) => list.map((x) => x.displayName)

describe('Box sortieren', () => {
  const box = [
    c(25, 'Pikachu', 12, false, 'Elektro'),
    c(4, 'Glumanda', 30, false, 'Feuer'),
    c(1, 'Bisasam', 30, true, 'Pflanze'),
    c(150, 'Mewtu', 7, false, 'Psycho'),
  ]

  it('sortiert nach Nummer', () => {
    expect(names(sortCreatures(box, 'dex'))).toEqual(['Bisasam', 'Glumanda', 'Pikachu', 'Mewtu'])
  })
  it('sortiert nach Name', () => {
    expect(names(sortCreatures(box, 'name'))).toEqual(['Bisasam', 'Glumanda', 'Mewtu', 'Pikachu'])
  })
  it('sortiert nach Level, das hoechste zuerst', () => {
    expect(names(sortCreatures(box, 'level'))).toEqual(['Bisasam', 'Glumanda', 'Pikachu', 'Mewtu'])
  })
  it('sortiert nach Typ', () => {
    expect(names(sortCreatures(box, 'type'))).toEqual(['Pikachu', 'Glumanda', 'Bisasam', 'Mewtu'])
  })
  it('stellt Schillernde nach vorn', () => {
    expect(names(sortCreatures(box, 'shiny'))[0]).toBe('Bisasam')
  })

  it('dreht die Richtung, laesst den Ausgleich aber stehen', () => {
    // Zwei auf Level 30: umgedreht stehen sie hinten, untereinander aber
    // weiter nach Nummer — nicht in umgekehrter Reihenfolge.
    const auf = sortCreatures(box, 'level', true)
    expect(names(auf)).toEqual(['Mewtu', 'Pikachu', 'Bisasam', 'Glumanda'])
  })

  it('laesst die Vorlage unberuehrt', () => {
    const before = names(box)
    sortCreatures(box, 'name')
    expect(names(box)).toEqual(before)
  })
})

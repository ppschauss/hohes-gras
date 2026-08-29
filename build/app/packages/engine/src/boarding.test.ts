import { describe, expect, it } from 'vitest'
import {
  BOARDING_MAX_LEVELS, BOARDING_MS, boardingLevels, boardingProgress,
} from './boarding.js'

describe('Pension', () => {
  const start = 1_000_000

  it('rechnet den Fortschritt aus der Zeit', () => {
    expect(boardingProgress(start, start)).toBe(0)
    expect(boardingProgress(start, start + BOARDING_MS / 2)).toBeCloseTo(0.5, 5)
    expect(boardingProgress(start, start + BOARDING_MS)).toBe(1)
  })

  it('hoert nach einem Tag auf zu arbeiten', () => {
    // Drei Tage stehen lassen gibt nicht dreissig Level.
    expect(boardingProgress(start, start + BOARDING_MS * 3)).toBe(1)
    expect(boardingLevels(boardingProgress(start, start + BOARDING_MS * 3))).toBe(BOARDING_MAX_LEVELS)
  })

  it('gibt anteilig Level, auch beim vorzeitigen Abholen', () => {
    expect(boardingLevels(0)).toBe(0)
    expect(boardingLevels(0.5)).toBe(5)
    expect(boardingLevels(0.99)).toBe(9)
    expect(boardingLevels(1)).toBe(BOARDING_MAX_LEVELS)
  })

  it('bleibt bei einer Zeit vor dem Start bei null', () => {
    expect(boardingProgress(start, start - 5000)).toBe(0)
  })
})

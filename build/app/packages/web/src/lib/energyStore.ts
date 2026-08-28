import { create } from 'zustand'
import type { EnergyState } from '@game/shared'

/**
 * Der Energiestand, wie ihn die Kopfzeile zeigt.
 *
 * Bewusst ein eigener, winziger Speicher statt eines Feldes im Hauptspeicher:
 * `lib/api` schreibt hier hinein, sobald irgendeine Antwort einen Energiestand
 * enthaelt. Wuerde `lib/api` dafuer den Hauptspeicher importieren, entstuende
 * ein Importzyklus — der Hauptspeicher benutzt ja `lib/api`.
 */
interface EnergyStore {
  energy: EnergyState | null
  gold: number | null
  setEnergy: (energy: EnergyState) => void
  setGold: (gold: number) => void
}

export const useEnergy = create<EnergyStore>((set) => ({
  energy: null,
  gold: null,
  setEnergy: (energy) => set({ energy }),
  setGold: (gold) => set({ gold }),
}))

/** Erkennt einen Energiestand in einer beliebigen Antwort. */
export function looksLikeEnergy(value: unknown): value is EnergyState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.current === 'number' && typeof v.cap === 'number' && typeof v.perHour === 'number'
}

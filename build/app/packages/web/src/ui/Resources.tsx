import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { useEnergy } from '../lib/energyStore'
import { haptic } from '../lib/telegram'
import { useGame } from '../store'
import { Icon } from './Icon'

/**
 * Gold und Energie, immer sichtbar.
 *
 * Beide Zahlen entscheiden ständig darüber, was gerade geht — sie gehören
 * nicht auf einen eigenen Bildschirm, sondern in die Kopfzeile. Die Energie
 * zählt zwischen zwei Serverantworten selbst weiter: der Server schickt mit,
 * wann der nächste Punkt fällt, und ohne diese Fortschreibung wirkte die
 * Anzeige eingefroren, bis zufällig eine Antwort kommt.
 */
export function Resources() {
  const energy = useEnergy((s) => s.energy)
  const gold = useEnergy((s) => s.gold)
  const setScreen = useGame((s) => s.setScreen)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const current = energy ? project(energy.current, energy.cap, energy.nextPointAt, energy.perHour) : null

  return (
    <span className="res">
      {gold !== null && (
        <button type="button" className="res__chip res__chip--gold"
          onClick={() => { haptic.tap(); setScreen('shop') }}>
          <Icon name="gold" size={15} />
          <span className="num">{compact(gold)}</span>
          <span className="sr-only">{t('stat.gold')}</span>
        </button>
      )}
      {energy && current !== null && (
        <button type="button" className="res__chip res__chip--energy"
          onClick={() => { haptic.tap(); setScreen('energy') }}>
          <Icon name="energy" size={15} />
          {/* Gekaufte und erspielte Energie darf ueber die natuerliche Grenze
              hinaus liegen — sie verfaellt nicht. Angezeigt als Vorrat neben
              dem Balken, nicht als Zahl groesser als ihr eigenes Maximum. */}
          <span className="num">{Math.min(current, energy.cap)}</span>
          <span className="res__cap num">/{energy.cap}</span>
          {current > energy.cap && <span className="res__extra num">+{current - energy.cap}</span>}
          <span className="sr-only">{t('energy.label')}</span>
        </button>
      )}
    </span>
  )
}

/** Vierstellige Beträge kürzen — die Kopfzeile hat keinen Platz für 20.002. */
function compact(value: number): string {
  if (value < 10_000) return new Intl.NumberFormat('de-DE').format(value)
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value / 1000)}k`
}

function project(current: number, cap: number, nextAt: number | null, perHour: number): number {
  if (nextAt === null || current >= cap || perHour <= 0) return current
  const elapsed = Date.now() - nextAt
  if (elapsed < 0) return current
  return Math.min(cap, current + 1 + Math.floor(elapsed / (3_600_000 / perHour)))
}

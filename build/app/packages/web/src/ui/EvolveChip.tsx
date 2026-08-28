import { useState } from 'react'
import type { CreatureView } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'

interface Props {
  creature: CreatureView
  onDone?: () => void
}

/**
 * Entwickeln, direkt am Pokémon.
 *
 * Vorher lag das auf einem eigenen Reiter im Fortschritt: man musste wissen,
 * dass es ihn gibt, dorthin wechseln und sein Pokémon in einer Liste
 * wiederfinden — für eine Handlung, die genau ein Pokémon betrifft und die man
 * sieht, während man es ansieht. Jetzt fragt die Karte selbst.
 *
 * Der Zwischenschritt bleibt: eine Entwicklung ist unumkehrbar, und ein
 * Fehlgriff ist ein anderes Pokémon.
 */
export function EvolveChip({ creature: c, onDone }: Props) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = c.canEvolveTo[0]
  if (!target) return null

  if (!asking) {
    return (
      <button
        type="button"
        className="chip chip--evo chip--action"
        onClick={(e) => { e.stopPropagation(); haptic.tap(); setAsking(true) }}
      >
        {t('creature.canEvolve')}
      </button>
    )
  }

  const evolve = () => {
    setBusy(true); setError(null)
    void api.evolve(c.id, target.speciesId)
      .then(() => { haptic.success(); setAsking(false); onDone?.() })
      .catch((err: unknown) => {
        haptic.error()
        setError(err instanceof Error ? err.message : 'unknown')
      })
      .finally(() => setBusy(false))
  }

  return (
    <span className="evoAsk" onClick={(e) => e.stopPropagation()}>
      <span className="evoAsk__text">
        {t('creature.evolveAsk', { name: c.displayName, target: target.name })}
      </span>
      {error && <span className="evoAsk__error">{t(`error.${error}`)}</span>}
      <span className="evoAsk__buttons">
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={evolve}>
          {busy ? <span className="spinner" /> : t('app.yes')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
          onClick={() => { haptic.tap(); setAsking(false) }}>
          {t('app.no')}
        </button>
      </span>
    </span>
  )
}

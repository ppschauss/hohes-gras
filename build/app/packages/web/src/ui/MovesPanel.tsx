import type { MoveOption } from '@game/shared'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'

/**
 * Attacken einer Kreatur waehlen.
 *
 * Klappt unter der Kreaturenkarte auf, statt einen eigenen Bildschirm zu
 * oeffnen: man vergleicht dabei mit dem, was das Pokemon schon kann, und in
 * einer Mini-App ohne Zurueck-Taste ist jeder vermiedene Bildschirmwechsel ein
 * Gewinn.
 */
export function MovesPanel({ creatureId }: { creatureId: string }) {
  const moves = useAsync(() => api.moveSet(creatureId), [creatureId])
  const action = useAction()
  const d = moves.data

  if (moves.loading && !d) return <div className="skeleton skeleton--row" />
  if (!d) {
    return (
      <p className="notice" role="alert">
        {t(`error.${moves.error ?? 'generic'}`)}
      </p>
    )
  }

  const chosen = d.slots.map((m) => m.id)
  const full = chosen.length >= d.capacity

  const save = (next: string[]) => {
    haptic.tap()
    void action.run(() => api.setMoves(creatureId, next), (res) => moves.set(res))
  }

  const toggle = (move: MoveOption) => {
    if (move.selected) {
      // Ohne Attacke waere die Kreatur im Kampf handlungsunfaehig; die letzte
      // bleibt deshalb stehen.
      if (chosen.length <= 1) return
      save(chosen.filter((id) => id !== move.id))
      return
    }
    if (full) return
    save([...chosen, move.id])
  }

  return (
    <section className="moves">
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      <ol className="moves__slots" aria-label={t('moves.slots')}>
        {Array.from({ length: d.capacity }, (_, i) => {
          const move = d.slots[i]
          if (!move) {
            return <li key={`empty-${i}`} className="moves__slot moves__slot--empty">{t('moves.empty')}</li>
          }
          return (
            <li key={move.id} className="moves__slot">
              <button
                type="button"
                className="moves__slotBtn"
                disabled={action.busy || chosen.length <= 1}
                title={chosen.length <= 1 ? t('moves.needOne') : t('moves.remove', { name: move.name })}
                onClick={() => toggle(move)}
              >
                <span className="chip" style={{ '--chip': move.type.color } as React.CSSProperties}>
                  {move.type.name}
                </span>
                <span className="moves__name">{move.name}</span>
                <span className="moves__meta num">{summary(move)}</span>
                {chosen.length > 1 && <span className="moves__x" aria-hidden="true">×</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <p className="moves__hint">{full ? t('moves.fullHint') : t('moves.pickHint')}</p>

      <ul className="moves__list">
        {d.options.filter((m) => !m.selected).map((move) => (
          <li key={move.id}>
            <button
              type="button"
              className="moves__row"
              disabled={full || action.busy}
              onClick={() => toggle(move)}
            >
              <span className="chip" style={{ '--chip': move.type.color } as React.CSSProperties}>
                {move.type.name}
              </span>
              <span className="moves__text">
                <span className="moves__name">{move.name}</span>
                <span className="moves__meta num">
                  {summary(move)}
                  {move.level > 0 && ` · ${t('moves.fromLevel', { n: move.level })}`}
                </span>
              </span>
              <span className="moves__add" aria-hidden="true">{full ? '' : '+'}</span>
            </button>
          </li>
        ))}
        {d.options.every((m) => m.selected) && (
          <li><p className="center__body">{t('moves.allKnown')}</p></li>
        )}
      </ul>
    </section>
  )
}

/**
 * Eine Zeile Kennzahlen.
 *
 * Bei Angriffen zaehlt die Kategorie (physisch/spezial entscheidet, welcher
 * Wert zaehlt) und die Staerke. Bei Statusattacken saehe "Status · Status-
 * veraenderung" doppelt gemoppelt aus — dort steht nur die Wirkung.
 */
function summary(move: MoveOption): string {
  const kind = move.effect.split(':')[0]!
  const parts = move.category === 'status'
    ? [kind === 'none' ? t('moves.category.status') : t(`moves.effect.${kind}`)]
    : [t(`moves.category.${move.category}`), t('moves.power', { n: move.power })]
  parts.push(t('moves.accuracy', { n: move.accuracy }))
  parts.push(t('moves.pp', { n: move.pp }))
  return parts.join(' · ')
}

import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

/**
 * Die Tausch-Station.
 *
 * Elf Arten entwickeln sich nur beim Besitzerwechsel. Die Entwicklungsliste
 * zeigt, was *jetzt* geht — hier steht auch, was nicht geht und warum. Das ist
 * der eigentliche Zweck: dass dem Sichlor ein Metallmantel fehlt, erfährt man
 * sonst nirgends, und eine Entwicklung, die niemand sehen kann, gibt es nicht.
 */
export function TradeStationPanel() {
  const station = useAsync(() => api.tradeStation(), [])
  const action = useAction()
  const [done, setDone] = useState<{ from: string; to: string } | null>(null)
  const d = station.data

  const evolve = (creatureId: string, speciesId: string) => {
    haptic.tap()
    void action.run(() => api.evolve(creatureId, speciesId), (res) => {
      setDone({ from: res.fromName, to: res.creature.displayName })
      station.reload()
      haptic.success()
    })
  }

  return (
    <>
      <p className="explain">{t('station.explain')}</p>

      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {done && <p className="notice notice--ok">{t('evo.done', { from: done.from, to: done.to })}</p>}

      {d && (
        <p className="center__body num">
          {t('station.cables', { n: d.cables })}
          {!d.recipeUnlocked && ` · ${t('station.needResearch')}`}
        </p>
      )}

      {d && d.rows.length === 0
        ? <CenterState glyph="🔌" title={t('station.none.title')} body={t('station.none.body')} />
        : <div className="stack">
            {d?.rows.map((row) => (
              <article key={`${row.creatureId}:${row.targetSpeciesId}`} className="evoRow">
                <span className="evoRow__from">
                  <img src={row.sprite} alt="" width={56} height={56} className="pick__mon" />
                  <span className="evoRow__name">{row.name}</span>
                  <span className="num">{t('creature.level', { n: row.level })}</span>
                </span>
                <span className="evoRow__arrow" aria-hidden="true">→</span>
                <span className="evoRow__targets">
                  <button
                    type="button"
                    className="evoTarget"
                    disabled={action.busy || !row.ready}
                    onClick={() => evolve(row.creatureId, row.targetSpeciesId)}
                  >
                    <img src={row.targetSprite} alt="" width={48} height={48} className="pick__mon" />
                    <span>{row.targetName}</span>
                    {/* Was fehlt, steht am Ziel — nicht in einer Fußnote. */}
                    <span className="evoTarget__need">
                      {row.heldItem
                        ? t('station.needBoth', { item: row.heldItem.name, owned: row.heldItem.owned })
                        : t('station.needCable')}
                    </span>
                  </button>
                </span>
              </article>
            ))}
          </div>}
    </>
  )
}

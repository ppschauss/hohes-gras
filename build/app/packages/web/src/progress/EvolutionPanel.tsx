import { useState } from 'react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

export function EvolutionPanel() {
  const evolutions = useAsync(() => api.evolutions(), [])
  const action = useAction()
  const [done, setDone] = useState<{ from: string; to: string } | null>(null)

  const evolve = (creatureId: string, speciesId: string) => {
    haptic.tap()
    void action.run(() => api.evolve(creatureId, speciesId), (res) => {
      setDone({ from: res.fromName, to: res.creature.displayName })
      evolutions.reload()
      haptic.success()
    })
  }

  const d = evolutions.data

  return (
    <>
      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}
      {done && <p className="notice notice--ok">{t('evo.done', { from: done.from, to: done.to })}</p>}

      {d && d.candidates.length === 0
        ? <CenterState glyph="🔮" title={t('evo.none.title')} body={t('evo.none.body')} />
        : <div className="stack">
            {d?.candidates.map(({ creature, options }) => (
              <article key={creature.id} className="evoRow">
                <span className="evoRow__from">
                  <img src={creature.sprite} alt="" width={56} height={56} className="pick__mon" />
                  <span className="evoRow__name">{creature.displayName}</span>
                  <span className="num">{t('creature.level', { n: creature.level })}</span>
                </span>
                <span className="evoRow__arrow" aria-hidden="true">→</span>
                <span className="evoRow__targets">
                  {options.map((o) => (
                    <button key={o.speciesId} type="button" className="evoTarget"
                      disabled={action.busy} onClick={() => evolve(creature.id, o.speciesId)}>
                      <img src={o.sprite} alt="" width={48} height={48} className="pick__mon" />
                      <span className="evoTarget__name">{o.name}</span>
                      <span className="evoTarget__how">{t(`evo.how.${o.how}`)}</span>
                    </button>
                  ))}
                </span>
              </article>
            ))}
          </div>}
    </>
  )
}

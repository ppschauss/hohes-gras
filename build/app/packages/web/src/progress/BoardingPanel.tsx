import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type BoardingEntry } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

/**
 * Pension.
 *
 * Bis zu fünf Pokémon für einen Tag abgeben; sie sammeln durchgehend Erfahrung
 * und sind solange nicht verfügbar. Der Balken ist hier die eigentliche
 * Anzeige: er sagt, was schon verdient ist — und damit, was man beim
 * vorzeitigen Abholen mitnimmt.
 */
export function BoardingPanel() {
  const boarding = useAsync(() => api.boarding(), [])
  const box = useAsync(() => api.box(), [])
  const garden = useAsync(() => api.garden(), [])
  const action = useAction()
  const [note, setNote] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const d = boarding.data
  const inside = new Set((d?.entries ?? []).map((e) => e.creatureId))
  const candidates = [...(garden.data?.team ?? []), ...(box.data?.creatures ?? [])]
    .filter((c) => !inside.has(c.id))

  const reload = () => { boarding.reload(); box.reload(); garden.reload() }

  const drop = (creatureId: string) => {
    haptic.tap()
    setPicking(false)
    void action.run(() => api.dropBoarding(creatureId), (res) => {
      boarding.set(res.boarding); reload(); haptic.success()
    })
  }

  const pick = (e: BoardingEntry) => {
    haptic.tap()
    void action.run(() => api.pickBoarding(e.id), (res) => {
      boarding.set(res.boarding)
      const r = res.result
      setNote(r.levelsGained > 0
        ? t('boarding.picked', { name: r.name, n: r.levelsGained, level: r.newLevel })
        : t('boarding.pickedNothing', { name: r.name }))
      reload()
      haptic.success()
    })
  }

  if (!d) return <div className="skeleton skeleton--row" />

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {note && <p className="notice notice--ok" role="status">{note}</p>}

      <p className="explain">
        {t('boarding.explain', { n: d.slots, hours: d.hours, levels: d.maxLevels, energy: d.abortCost })}
      </p>

      {picking && (
        <section className="section">
          <h2>{t('boarding.pickWho')}</h2>
          <div className="switchList">
            {candidates.map((c) => (
              <button key={c.id} type="button" className="switchRow" disabled={action.busy}
                onClick={() => drop(c.id)}>
                <img src={c.sprite} alt="" width={40} height={40} />
                <span className="switchRow__text">
                  <span className="switchRow__name">{c.displayName}</span>
                  <span className="switchRow__hp num">
                    {t('creature.level', { n: c.level })}
                    {c.level >= d.levelCap ? ` · ${t('boarding.atCap')}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setPicking(false)}>
            {t('app.back')}
          </button>
        </section>
      )}

      {d.entries.length === 0
        ? <CenterState glyph="🏡" title={t('boarding.empty.title')} body={t('boarding.empty.body')} />
        : (
          <div className="stack">
            {d.entries.map((e) => (
              <article key={e.id} className="boarder">
                <img className="boarder__mon" src={e.sprite} alt="" width={48} height={48} />
                <div className="boarder__text">
                  <span className="boarder__name">{e.name}</span>
                  <span className="boarder__meta num">
                    {t('boarding.progress', {
                      have: e.levelsEarned, max: e.levelsMax, level: e.levelAtStart + e.levelsEarned,
                    })}
                  </span>
                  <span className="bar">
                    <span className="bar__fill bar__fill--xp" style={{ width: `${Math.round(e.progress * 100)}%` }} />
                  </span>
                  <span className="boarder__meta">
                    {e.ready ? t('boarding.ready') : t('boarding.readyAt', { at: whenLabel(e.readyAt) })}
                  </span>
                </div>
                <button type="button" className="btn btn--primary btn--sm" disabled={action.busy}
                  onClick={() => pick(e)}>
                  {e.ready ? t('boarding.collect') : t('boarding.collectEarly', { n: e.energyCost })}
                </button>
              </article>
            ))}
          </div>
        )}

      <button type="button" className="btn btn--primary btn--block"
        disabled={action.busy || d.used >= d.slots || candidates.length === 0}
        onClick={() => { haptic.tap(); setPicking(true) }}>
        {d.used >= d.slots ? t('boarding.full') : t('boarding.drop', { n: d.slots - d.used })}
      </button>
    </>
  )
}

function whenLabel(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return t('research.today', { time })
  if (days === 1) return t('research.tomorrow', { time })
  return t('research.inDays', { n: days, time })
}

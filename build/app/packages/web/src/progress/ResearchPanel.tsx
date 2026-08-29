import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type ResearchProjectView, type ResearchView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { ItemIcon } from '../ui/ItemIcon'

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const

/**
 * Labor: Forschung und Training.
 *
 * Zwei Zustände je Projekt und nicht mehr: es läuft, oder es lässt sich
 * starten. Was läuft, steht oben — das ist die Antwort auf „wie lange noch",
 * und danach fragt man hier am häufigsten.
 */
export function ResearchPanel() {
  const research = useAsync(() => api.research(), [])
  const box = useAsync(() => api.box(), [])
  const garden = useAsync(() => api.garden(), [])
  const action = useAction()
  const [note, setNote] = useState<string | null>(null)
  /** Welches Projekt gerade nach einem Pokémon fragt. */
  const [picking, setPicking] = useState<{ projectId: string; stat?: string } | null>(null)

  const d = research.data
  const candidates = [...(garden.data?.team ?? []), ...(box.data?.creatures ?? [])]

  const reload = () => { research.reload(); box.reload(); garden.reload() }

  const begin = (creatureId: string) => {
    if (!picking) return
    const p = picking
    haptic.tap()
    setPicking(null)
    void action.run(
      () => (p.stat
        ? api.trainCreature(creatureId, p.stat)
        : api.startResearch(p.projectId, creatureId)),
      (res) => { research.set(res.research); reload(); haptic.success() },
    )
  }

  const collect = (id: string) => {
    haptic.tap()
    void action.run(() => api.collectResearch(id), (res) => {
      research.set(res.research)
      const r = res.result
      setNote(r.training
        ? t('research.doneTraining', {
          name: r.creatureName ?? '', n: r.evGained, stat: t(`stat.${r.stat}`), xp: number(r.xpGained),
        })
        : t('research.doneProject', {
          name: t(`research.${r.projectId}`), xp: number(r.xpGained), who: r.creatureName ?? '—',
        }))
      reload()
      haptic.success()
    })
  }

  if (!d) return <div className="skeleton skeleton--row" />

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {note && <p className="notice notice--ok" role="status">{note}</p>}

      <p className="explain">{t('research.explain', { n: d.slots, used: d.used })}</p>
      {d.lab === 0 && <p className="notice" role="status">{t('research.needLab')}</p>}

      {/* Die Auswahl steht ganz oben, sobald sie offen ist: sonst tippt man
          auf „Erforschen" und der Bildschirm scheint nichts zu tun. */}
      {picking && (
        <section className="section">
          <h2>{t('research.pickCreature')}</h2>
          <p className="center__body">{t('research.pickHint')}</p>
          <div className="switchList">
            {candidates.map((c) => (
              <button key={c.id} type="button" className="switchRow" disabled={action.busy}
                onClick={() => begin(c.id)}>
                <img src={c.sprite} alt="" width={40} height={40} />
                <span className="switchRow__text">
                  <span className="switchRow__name">{c.displayName}</span>
                  <span className="switchRow__hp num">{t('creature.level', { n: c.level })}</span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setPicking(null)}>
            {t('app.back')}
          </button>
        </section>
      )}

      {d.running.length > 0 && (
        <section className="section">
          <h2>{t('research.running', { n: d.running.length, max: d.slots })}</h2>
          <div className="stack">
            {d.running.map((r) => (
              <article key={r.id} className="recipe">
                <div className="recipe__out">
                  <span className="recipe__name">
                    {r.training
                      ? t('research.trainingOf', { stat: t(`stat.${r.stat}`), name: r.creatureName ?? '—' })
                      : t(`research.${r.projectId}`)}
                    {!r.training && r.tier > 1 ? ` · ${t('research.tier', { n: r.tier })}` : ''}
                  </span>
                </div>
                <p className="recipe__meta num">
                  {r.ready ? t('research.ready') : t('research.readyAt', { at: whenLabel(r.readyAt) })}
                  {' · '}{t('research.xpFor', { n: number(r.xp), name: r.creatureName ?? '—' })}
                </p>
                <div className="row">
                  <button type="button" className="btn btn--primary btn--sm"
                    disabled={!r.ready || action.busy} onClick={() => collect(r.id)}>
                    {t('research.collect')}
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                    onClick={() => {
                      haptic.tap()
                      void action.run(() => api.abortResearch(r.id), (res) => { research.set(res.research); reload() })
                    }}>
                    {t('research.abort')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {d.trainingUnlocked && (
        <section className="section">
          <h2>{t('research.training')}</h2>
          <p className="center__body">
            {t('research.trainingHint', {
              n: d.evPerTraining, hours: d.training.hours, gold: number(d.training.gold),
            })}
          </p>
          <ul className="recipe__in">
            {d.training.inputs.map((i) => (
              <li key={i.itemId} className={i.have >= i.quantity ? 'recipe__have' : 'recipe__missing'}>
                <ItemIcon src={i.icon} category="material" size={20} />
                <span>{i.name}</span>
                <span className="num">{i.have}/{i.quantity}</span>
              </li>
            ))}
          </ul>
          <div className="chipRow">
            {STAT_KEYS.map((stat) => (
              <button key={stat} type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                onClick={() => { haptic.tap(); setPicking({ projectId: 'res-training', stat }) }}>
                {t(`stat.${stat}`)}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>{t('research.projects')}</h2>
        <div className="stack">
          {d.projects.map((p) => (
            <Project key={p.id} p={p} gold={d.gold} busy={action.busy} onStart={setPicking} />
          ))}
        </div>
      </section>
    </>
  )
}

function Project({ p, gold, busy, onStart }: {
  p: ResearchProjectView
  gold: number
  busy: boolean
  onStart: (v: { projectId: string }) => void
}) {
  return (
    <article className={`recipe${p.complete ? ' recipe--done' : ''}`}>
      <div className="recipe__out">
        <span className="recipe__name">{t(`research.${p.id}`)}</span>
        {p.tiers > 1 && (
          <span className="tag num">{p.done}/{p.tiers}</span>
        )}
      </div>
      <p className="recipe__meta">{t(`research.${p.id}.what`)}</p>
      {p.kind === 'bonus' && (
        <p className="recipe__meta num">
          {t('research.bonusNow', { now: fmt(p.bonusNow), next: fmt(p.bonusNext) })}
        </p>
      )}

      {p.complete
        ? <span className="tag tag--done">{t('research.complete')}</span>
        : (
          <>
            {/* Symbol, Name, Bestand — dieselbe Zeile wie im Handwerk. Ohne
                den Namen stand da ein Symbol und "3/6", und welcher Werkstoff
                gemeint war, musste man raten. */}
            <ul className="recipe__in">
              {p.inputs.map((i) => (
                <li key={i.itemId} className={i.have >= i.quantity ? 'recipe__have' : 'recipe__missing'}>
                  <ItemIcon src={i.icon} category="material" size={20} />
                  <span>{i.name}</span>
                  <span className="num">{i.have}/{i.quantity}</span>
                </li>
              ))}
              <li className={p.goldCost <= gold ? 'recipe__have' : 'recipe__missing'}>
                <span aria-hidden="true">🪙</span>
                <span>Gold</span>
                <span className="num">{number(p.goldCost)}</span>
              </li>
            </ul>
            <p className="recipe__meta num">
              {t('research.duration', { n: p.hours })} · {t('research.xp', { n: number(p.xp) })}
            </p>
            <button type="button" className="btn btn--primary btn--sm"
              disabled={busy || p.blockedReason !== null}
              onClick={() => { haptic.tap(); onStart({ projectId: p.id }) }}>
              {p.blockedReason ? t(`research.blocked.${p.blockedReason}`) : t('research.start')}
            </button>
          </>
        )}
    </article>
  )
}

/** Ganze Zahlen ohne Nachkomma, halbe mit — 2,5 Prozentpunkte sind 2,5. */
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '').replace('.', ','))

/** „heute 18:40" oder „morgen 06:10" — eine Uhrzeit ohne Datum wäre bei
 *  Projekten über Nacht mehrdeutig. */
function whenLabel(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((d.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return t('research.today', { time })
  if (days === 1) return t('research.tomorrow', { time })
  return t('research.inDays', { n: days, time })
}

export type { ResearchView }

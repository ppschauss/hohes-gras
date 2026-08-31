import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type ResearchProjectView, type ResearchView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { ItemIcon } from '../ui/ItemIcon'
import { Fold } from '../ui/Fold'
import { RESEARCH_CENTERS, centerOf } from '../lib/groups'

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const

/**
 * Fuenfzehn Projekte untereinander sind eine Liste, kein Baum.
 *
 * Die Unterteilung folgt dem, wonach man sucht: ein Rezept, das man
 * freischalten will, oder einen Bonus, den man heben will. "Offen" ist die
 * Ansicht, mit der man ankommt — alles, was jetzt noch etwas bringt.
 */
const FILTERS = ['open', 'recipe', 'bonus', 'done'] as const
type Filter = (typeof FILTERS)[number]

const matches = (p: ResearchProjectView, f: Filter): boolean => {
  if (f === 'done') return p.complete
  if (f === 'open') return !p.complete
  if (f === 'recipe') return p.kind === 'recipe' || p.kind === 'training'
  return p.kind === 'bonus'
}

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
  const [filter, setFilter] = useState<Filter>('open')

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
        <div className="sectionHead">
          <h2>{t('research.projects')}</h2>
          <span className="num">{d.projects.filter((p) => p.complete).length}/{d.projects.length}</span>
        </div>

        {/* Das <select> steht bewusst nicht in einem <label>: in der
            Telegram-WebView zaehlt der Tipp dort doppelt. */}
        <div className="picker picker--wide">
          <span className="picker__label" id="research-filter">{t('research.filter')}</span>
          <span className="picker__body">
            <select
              className="picker__select"
              aria-labelledby="research-filter"
              value={filter}
              onChange={(e) => { haptic.select(); setFilter(e.target.value as Filter) }}
            >
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {t(`research.filter.${f}`)} ({d.projects.filter((p) => matches(p, f)).length})
                </option>
              ))}
            </select>
          </span>
        </div>

        {/*
          * Vier Zentren statt einer Liste.
          *
          * Gefiltert wurde bisher nach Bauart — Rezept oder Bonus. Danach
          * sucht aber niemand: man sucht nach einem Gebiet, in dem man besser
          * werden will. Der Zustandsfilter oben bleibt, die Einteilung
          * darunter beantwortet die andere Frage.
          */}
        {(() => {
          const sichtbar = d.projects.filter((p) => matches(p, filter))
          if (sichtbar.length === 0) {
            return <p className="center__body">{t('research.filterEmpty')}</p>
          }
          const zentren = RESEARCH_CENTERS
            .map((c) => ({ id: c, projects: sichtbar.filter((p) => centerOf(p.id) === c) }))
            .filter((z) => z.projects.length > 0)
          return zentren.map((z) => (
            <Fold key={z.id}
              title={t(`research.center.${z.id}`)}
              count={z.projects.length}
              /* Unter "Noch offen" ist keines erforscht und unter "Erforscht"
                 alle — beide Male stuende hier dieselbe Zahl zweimal. */
              note={filter === 'open' || filter === 'done'
                ? undefined
                : t('research.doneOf', { n: z.projects.filter((p) => p.complete).length })}
              open={zentren.length === 1}
            >
              <div className="stack">
                {z.projects.map((p) => (
                  <Project key={p.id} p={p} gold={d.gold} busy={action.busy} onStart={setPicking} />
                ))}
              </div>
            </Fold>
          ))
        })()}
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

import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'

/** The guide's chapter view. The current chapter is shown large, the rest as a
 *  compact trail — the journey so far and the next step, not a quest log. */
export function StoryPanel() {
  const story = useAsync(() => api.story(), [])
  const action = useAction()

  const claim = (chapterId: string) => {
    haptic.tap()
    void action.run(() => api.claimChapter(chapterId), (res) => { story.set(res.story); haptic.success() })
  }

  const d = story.data
  // Ohne Wahl: die Region, in der das aktuelle Kapitel steht.
  const [regionId, setRegionId] = useState<string | null>(null)
  const regions = d?.regions ?? []
  /*
   * Ohne eigene Wahl die Region, in der man unterwegs ist.
   *
   * Vorher stand hier die Region des "laufenden Kapitels" — und das war das
   * erste unerreichte der ganzen Welt, also Kantos erstes. Wer in Hoenn
   * anfaengt, bekam eine verschlossene Region gezeigt und darueber einen
   * Willkommenstext fuer Kanto.
   */
  const shown = regions.find((r) => r.id === regionId)
    ?? regions.find((r) => r.entered)
    ?? regions.find((r) => r.id === d?.currentChapter?.regionId)
    ?? regions[0]
  const chapters = (d?.chapters ?? []).filter((c) => c.regionId === shown?.id)
  // Das laufende Kapitel *dieser* Region: das erste, das noch aussteht.
  const current = chapters.find((c) => !c.reached) ?? chapters[chapters.length - 1] ?? null

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      {current && (
        <section className="guide">
          <div className="guide__head">
            <span className="guide__avatar" aria-hidden="true">🧭</span>
            <div>
              <span className="section__eyebrow">{current.guide ?? t('story.guide')}</span>
              <h2>{current.title}</h2>
              <span className="num guide__chapter">
                {/* Innerhalb der Region gezaehlt: "Kapitel 1/21" waere die
                    Zahl einer Reise, die es so nicht mehr gibt. */}
                {t('story.chapter', { n: current.order % 100, total: chapters.length })}
              </span>
            </div>
          </div>
          <p className="guide__text">{current.text}</p>

          <ul className="area__reqs">
            {current.requirements.map((req, i) => (
              <li key={i} className={`req${req.met ? ' req--met' : ''}`}>
                <span className="req__mark" aria-hidden="true">{req.met ? '✓' : '·'}</span>
                <span>{t(`story.req.${req.kind}`, { have: req.have, need: req.need, label: req.label })}</span>
              </li>
            ))}
          </ul>

          {current.reached && !current.claimed && (
            <button type="button" className="btn btn--primary btn--block"
              disabled={action.busy} onClick={() => claim(current.id)}>
              {t('story.claim')} · {number(current.reward.gold)} 🪙
              {current.reward.itemName && ` + ${current.reward.quantity}× ${current.reward.itemName}`}
            </button>
          )}
        </section>
      )}

      {/* Eine Region auf einmal: einundzwanzig Kapitel untereinander sind
          keine Reise mehr, sondern eine Liste. */}
      {shown && regions.length > 1 && (
        <div className="picker picker--wide">
          <span className="picker__label" id="story-region">{t('map.region')}</span>
          <span className="picker__body">
            <select
              className="picker__select"
              aria-labelledby="story-region"
              value={shown.id}
              onChange={(e) => { haptic.select(); setRegionId(e.target.value) }}
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.entered && !r.cleared}>
                  {!r.entered && !r.cleared ? `🔒 ${r.name}` : `${r.name} · ${r.done}/${r.chapters}`}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}

      <ol className="chapterTrail">
        {chapters.map((c) => (
          <li key={c.id}
            className={`chapterStep${c.reached ? ' chapterStep--done' : ''}${c.isCurrent ? ' chapterStep--current' : ''}`}>
            <span className="chapterStep__num num">{c.order % 100}</span>
            <span className="chapterStep__text">
              <span className="chapterStep__title">{c.title}</span>
              {/* Was zu tun ist, stand nur beim aktuellen Kapitel. In der Liste
                  waren es nummerierte Titel ohne Auftrag — "Der Sammler" sagt
                  niemandem, was er sammeln soll. */}
              <span className="chapterStep__task">
                {c.requirements
                  .map((req) => t(`story.req.${req.kind}`, { have: req.have, need: req.need, label: req.label }))
                  .join(' · ')}
              </span>
            </span>
            <span className="chapterStep__state">
              {c.claimed
                ? <span className="tag tag--done">{t('story.claimed')}</span>
                : c.reached
                  ? <button type="button" className="btn btn--primary btn--sm"
                      disabled={action.busy} onClick={() => claim(c.id)}>{t('story.claim')}</button>
                  : null}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

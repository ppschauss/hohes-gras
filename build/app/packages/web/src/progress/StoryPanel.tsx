import { t } from '../i18n'
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
  const current = d?.currentChapter

  return (
    <>
      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}

      {current && (
        <section className="guide">
          <div className="guide__head">
            <span className="guide__avatar" aria-hidden="true">🧭</span>
            <div>
              <span className="section__eyebrow">{current.guide ?? t('story.guide')}</span>
              <h2>{current.title}</h2>
              <span className="num guide__chapter">
                {t('story.chapter', { n: current.order, total: d?.total ?? 0 })}
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

      <ol className="chapterTrail">
        {d?.chapters.map((c) => (
          <li key={c.id}
            className={`chapterStep${c.reached ? ' chapterStep--done' : ''}${c.isCurrent ? ' chapterStep--current' : ''}`}>
            <span className="chapterStep__num num">{c.order}</span>
            <span className="chapterStep__title">{c.title}</span>
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

import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type QuestView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { ItemIcon } from '../ui/ItemIcon'

/**
 * Tages- und Wochenaufgaben.
 *
 * Beide Sätze untereinander, der Tag zuerst — er ist der, der morgen weg ist.
 * Jede Aufgabe trägt ihre Belohnung sichtbar: eine Aufgabe, deren Lohn man
 * erst nach dem Abholen erfährt, ist eine Wette.
 */
export function QuestPanel({ compact = false }: { compact?: boolean }) {
  const quests = useAsync(() => api.quests(), [])
  const action = useAction()
  const [got, setGot] = useState<string | null>(null)

  const d = quests.data
  if (!d) return <div className="skeleton skeleton--row" />

  const collect = (q: QuestView) => {
    haptic.tap()
    void action.run(() => api.claimQuest(q.id), (res) => {
      quests.set(res.quests)
      setGot(t('quest.got', { gold: number(res.result.gold) }))
      haptic.success()
    })
  }

  const list = (title: string, items: QuestView[]) => (
    <section className="section">
      <div className="sectionHead">
        <h2>{title}</h2>
        <span className="num">{items.filter((q) => q.claimed).length}/{items.length}</span>
      </div>
      <div className="stack">
        {items.map((q) => (
          <article key={q.id} className={`quest${q.claimed ? ' quest--done' : ''}`}>
            <span className="quest__text">
              <span className="quest__title">{t(`quest.${q.id}`, { n: q.target })}</span>
              <span className="bar">
                <span className="bar__fill bar__fill--dex"
                  style={{ width: `${Math.min(100, (q.progress / q.target) * 100)}%` }} />
              </span>
              <span className="quest__meta num">
                {number(Math.min(q.progress, q.target))} / {number(q.target)}
                {' · '}🪙 {number(q.reward.gold)}
                {q.reward.items.map((i) => (
                  <span key={i.itemId} className="quest__item">
                    <ItemIcon src={i.icon} category="material" size={16} />
                    {i.quantity}×
                  </span>
                ))}
              </span>
            </span>
            <button type="button" className="btn btn--primary btn--sm"
              disabled={!q.complete || q.claimed || action.busy} onClick={() => collect(q)}>
              {q.claimed ? t('quest.claimed') : t('quest.claim')}
            </button>
          </article>
        ))}
      </div>
    </section>
  )

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {got && <p className="notice notice--ok" role="status">{got}</p>}
      {!compact && <p className="explain">{t('quest.explain')}</p>}
      {list(t('quest.daily'), d.daily)}
      {list(t('quest.weekly'), d.weekly)}
    </>
  )
}

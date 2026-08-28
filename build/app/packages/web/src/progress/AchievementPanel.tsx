import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'

export function AchievementPanel() {
  const achievements = useAsync(() => api.achievements(), [])
  const action = useAction()

  const claim = (id: string) => {
    haptic.tap()
    void action.run(() => api.claimAchievement(id), (res) => {
      achievements.set(res.achievements); haptic.success()
    })
  }

  const d = achievements.data

  return (
    <>
      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}
      {d && (
        <p className="center__body num">
          {t('achieve.progress', { unlocked: d.unlockedCount, total: d.totalCount })}
        </p>
      )}

      <div className="stack">
        {d?.visible.map((a) => {
          const percent = a.target > 0 ? Math.min(100, (a.progress / a.target) * 100) : 0
          return (
            <article key={a.id} className={`achievement${a.unlocked ? ' achievement--done' : ''}`}>
              <div className="achievement__text">
                <span className="achievement__name">{t(`achieve.name.${a.metric}`, { n: a.target })}</span>
                <span className="bar">
                  <span className="bar__fill bar__fill--dex" style={{ width: `${percent}%` }} />
                </span>
                <span className="achievement__meta num">{t('achieve.locked', { progress: a.progress, target: a.target })}</span>
              </div>
              {a.claimed
                ? <span className="tag tag--done">{t('achieve.claimed')}</span>
                : <button type="button" className="btn btn--primary btn--sm"
                    disabled={!a.unlocked || action.busy} onClick={() => claim(a.id)}>
                    {a.rewardGold} 🪙
                  </button>}
            </article>
          )
        })}
      </div>
    </>
  )
}

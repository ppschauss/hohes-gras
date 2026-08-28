import { useState } from 'react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number, untilLabel } from '../lib/format'

export function SeasonPanel() {
  const season = useAsync(() => api.season(), [])
  const action = useAction()
  const [claimed, setClaimed] = useState<string | null>(null)

  const claim = (tier: number) => {
    haptic.tap()
    void action.run(() => api.claimSeasonTier(tier), (res) => {
      season.set(res.season); setClaimed(res.label); haptic.success()
    })
  }

  const d = season.data
  const toNext = d?.nextTierPoints ? d.nextTierPoints - d.points : null

  return (
    <>
      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}
      {claimed && <p className="notice notice--ok">{claimed}</p>}

      {d && (
        <section className="seasonHead">
          <div>
            <span className="section__eyebrow">{d.seasonKey} · {t('season.endsIn', { n: untilLabel(d.endsAt) })}</span>
            <h2>{t('season.tier', { n: d.tier })}</h2>
            <p className="num">{t('season.points', { n: number(d.points) })}</p>
          </div>
          {toNext !== null && toNext > 0 && (
            <p className="center__body">{t('season.nextIn', { n: number(toNext), tier: d.tier + 1 })}</p>
          )}
        </section>
      )}

      <p className="explain">{t('season.explain')}</p>

      <ol className="seasonTrack">
        {d?.tiers.map((tier) => (
          <li key={tier.tier}
            className={`seasonTier${tier.reached ? ' seasonTier--reached' : ''}${tier.claimed ? ' seasonTier--claimed' : ''}`}>
            <span className="seasonTier__num num">{tier.tier}</span>
            <span className="seasonTier__reward">{tier.rewardLabel}</span>
            <span className="seasonTier__action">
              {tier.claimed
                ? <span className="tag tag--done">{t('season.claimed')}</span>
                : tier.reached
                  ? <button type="button" className="btn btn--primary btn--sm"
                      disabled={action.busy} onClick={() => claim(tier.tier)}>{t('season.claim')}</button>
                  : <span className="num seasonTier__locked">{number(tier.pointsRequired)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

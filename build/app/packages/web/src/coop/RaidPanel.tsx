import { useState } from 'react'
import type { RaidAttackResponse, RaidView } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number, untilLabel } from '../lib/format'
import { CenterState } from '../ui/States'

export function RaidPanel() {
  const raids = useAsync(() => api.raids(), [])
  const action = useAction()
  const [last, setLast] = useState<RaidAttackResponse | null>(null)

  const d = raids.data

  const summon = (tier: 1 | 3 | 5) => {
    haptic.tap()
    void action.run(() => api.summonRaid(tier), (next) => { raids.set(next); haptic.success() })
  }

  const attack = (raid: RaidView) => {
    haptic.tap()
    void action.run(() => api.attackRaid(raid.id), (res) => {
      setLast(res)
      raids.reload()
      haptic[res.defeated ? 'success' : 'tap']()
    })
  }

  if (d && !d.guild) {
    return <CenterState glyph="🛡️" title={t('raid.needGuild')} body={t('guild.none.body')} />
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      {last && (
        <section className={`harvest${last.defeated ? '' : ''}`}>
          <h3>{last.defeated ? t('raid.defeated') : t('raid.damage', { n: number(last.damage) })}</h3>
          <ul className="harvest__loot">
            {last.contributions.map((c) => (
              <li key={c.creatureId}>
                <span>{c.name}</span>
                {c.effectiveness > 1 && <span className="tag tag--level">×{c.effectiveness}</span>}
                <span className="num">{number(c.damage)}</span>
              </li>
            ))}
          </ul>
          {last.reward && (
            <>
              <p className="harvest__gold num">{t('raid.rewardGold', { n: number(last.reward.gold) })}</p>
              {last.reward.caught && last.reward.creature && (
                <p className="harvest__gold">{t('raid.rewardCaught', { name: last.reward.creature.displayName })}</p>
              )}
            </>
          )}
        </section>
      )}

      {d && d.open.length === 0
        ? <CenterState glyph="⚔️" title={t('raid.empty.title')} body={t('raid.empty.body')} />
        : <div className="stack">
            {d?.open.map((raid) => <RaidCard key={raid.id} raid={raid} busy={action.busy} onAttack={() => attack(raid)} />)}
          </div>}

      <section className="section">
        <h2>{t('raid.summon')}</h2>
        <div className="stack">
          {d?.tiers.map((spec) => (
            <article key={spec.tier} className="friend">
              <span className="friend__text">
                <span className="friend__name">{t('raid.tier', { n: spec.tier })}</span>
                <span className="friend__meta num">
                  {t('raid.tierInfo', {
                    min: spec.levelRange[0], max: spec.levelRange[1],
                    hours: spec.durationHours, gold: number(spec.goldPool),
                  })}
                </span>
              </span>
              <button type="button" className="btn btn--primary btn--sm" disabled={action.busy}
                onClick={() => summon(spec.tier as 1 | 3 | 5)}>{t('raid.summon')}</button>
            </article>
          ))}
        </div>
      </section>

      {d && d.recent.length > 0 && (
        <section className="section">
          <h2>{t('raid.recent')}</h2>
          <div className="stack">
            {d.recent.map((r) => (
              <article key={r.id} className="friend">
                <img src={r.sprite} alt="" width={36} height={36} className="pick__mon" />
                <span className="friend__text">
                  <span className="friend__name">{r.name}</span>
                  <span className="friend__meta num">{t('raid.tier', { n: r.tier })} · {r.participants.length} Trainer</span>
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function RaidCard({ raid, busy, onAttack }: { raid: RaidView; busy: boolean; onAttack: () => void }) {
  return (
    <article className="raidCard">
      <div className="raidCard__head">
        <img src={raid.sprite} alt="" width={64} height={64} className="raidCard__mon" />
        <div className="raidCard__text">
          <span className="raidCard__name">{raid.name}</span>
          <span className="raidCard__meta num">
            {t('raid.tier', { n: raid.tier })} · {t('creature.level', { n: raid.level })}
          </span>
          <span className="raidCard__types">
            {raid.types.map((ty) => (
              <span key={ty.id} className="chip" style={{ '--chip': ty.color } as React.CSSProperties}>{ty.name}</span>
            ))}
          </span>
        </div>
      </div>

      <div className="bar bar--lg">
        <span className="bar__fill bar__fill--danger" style={{ width: `${(1 - raid.progress) * 100}%` }} />
      </div>
      <p className="num raidCard__hp">{number(raid.hpLeft)} / {number(raid.hpMax)}</p>

      <div className="raidCard__foot">
        <span className="num">
          {t('raid.yourDamage', { n: number(raid.myDamage) })} · {t('raid.endsIn', { n: untilLabel(raid.expiresAt) })}
        </span>
        <button type="button" className="btn btn--primary btn--sm"
          disabled={busy || raid.attacksLeft <= 0 || raid.defeated} onClick={onAttack}>
          {raid.attacksLeft > 0 ? t('raid.attacksLeft', { n: raid.attacksLeft }) : t('raid.noAttacks')}
        </button>
      </div>

      {raid.participants.length > 0 && (
        <ul className="raidCard__party">
          {raid.participants.map((p) => (
            <li key={p.trainerId}>
              <span>{p.displayName}</span>
              <span className="num">{number(p.damage)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

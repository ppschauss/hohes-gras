import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type ArenaView } from '../lib/api'
import { number } from '../lib/format'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

/**
 * Trainingsarena.
 *
 * Der Bildschirm hat zwei Zustände und nicht mehr: kein Durchlauf — dann
 * stehen die drei Stufen zur Wahl; ein Durchlauf läuft — dann gibt es genau
 * einen Knopf, der weitergeht. Alles andere passiert im Kampf.
 */
export function ArenaScreen({ onBack, onBattle }: { onBack: () => void; onBattle: () => void }) {
  const arena = useAsync(() => api.arena(), [])
  const action = useAction()
  const d = arena.data

  const start = (tier: string) => {
    haptic.tap()
    void action.run(() => api.arenaStart(tier), (res) => { arena.set(res.arena); onBattle() })
  }

  const next = () => {
    haptic.tap()
    void action.run(() => api.arenaNext(), (res) => {
      arena.set(res.arena)
      if (res.battle) onBattle()
      else haptic.success()
    })
  }

  return (
    <Screen
      eyebrow={t('arena.eyebrow')}
      title={t('arena.title')}
      onBack={onBack}
      aside={d?.typeName ? <span className="tag">{d.typeName}</span> : null}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {d && (
          <p className="explain">
            {t('arena.explain', {
              type: d.typeName ?? '—',
              rounds: d.rounds,
              heal: d.healPercent,
              avg: d.averageLevel,
            })}
          </p>
        )}

        {/* Vor dem Antreten, nicht mittendrin: mit einem angeschlagenen Team
            sind vier Kaempfe nicht zu schaffen, und aus dem Kampf kommt man
            nur mit einer Niederlage wieder heraus. */}
        {d && !d.run && d.teamHealth < 60 && (
          <p className="notice" role="status">{t('arena.hurt', { n: d.teamHealth })}</p>
        )}

        {d?.run
          ? (
            <section className="section">
              <h2>{t('arena.running', { round: d.run.round, max: d.rounds })}</h2>
              <div className="bar">
                <span className="bar__fill" style={{ width: `${(d.run.wins / d.rounds) * 100}%` }} />
              </div>
              <div className="row">
                <button type="button" className="btn btn--primary" disabled={action.busy} onClick={next}>
                  {d.run.battleOpen ? t('arena.toBattle') : t('arena.next')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                  onClick={() => { haptic.tap(); void action.run(() => api.arenaAbandon(), (r) => arena.set(r.arena)) }}>
                  {t('arena.abandon')}
                </button>
              </div>
            </section>
          )
          : (
            <div className="stack">
              {d?.tiers.map((tier) => (
                <article key={tier.id} className="tierCard">
                  <div className="tierCard__head">
                    <span className="tierCard__name">{t(`arena.tier.${tier.id}`)}</span>
                    <span className="tierCard__levels num">
                      {t('arena.levels', { from: tier.levels[0] ?? 0, to: tier.levels[1] ?? 0 })}
                    </span>
                  </div>
                  <p className="tierCard__meta">
                    {t('arena.tierDelta', { n: tier.levelDelta })}
                    {' · '}{t('arena.perWin', { n: tier.goldPerWin })}
                    {' · '}{t('arena.xp', { n: tier.xpMultiplier })}
                  </p>
                  {/* Die Zahl, die man wirklich spuert: wie viele Pokemon im
                      ganzen Durchlauf zu besiegen sind. */}
                  <p className="tierCard__meta">
                    {t('arena.foes', { perBattle: tier.foesPerBattle, total: tier.foesTotal })}
                  </p>
                  <p className="tierCard__reward">
                    {t('arena.bonus', {
                      gold: number(tier.bonusGold),
                      items: tier.bonus.map((b) => `${b.quantity}× ${b.name}`).join(', '),
                    })}
                  </p>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm tierCard__go"
                    disabled={action.busy}
                    onClick={() => start(tier.id)}
                  >
                    {tier.clearedToday ? t('arena.again') : t('arena.enter')}
                  </button>
                </article>
              ))}
            </div>
          )}
      </main>
    </Screen>
  )
}

export type { ArenaView }

import { useState } from 'react'
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
  const [typ, setTyp] = useState<string | null>(null)
  const d = arena.data
  /** Der gewählte Typ des Tages; ohne Wahl der erste. */
  const gewaehlt = typ ?? d?.types[0]?.id ?? null
  const aktiv = d?.types.find((x) => x.id === gewaehlt) ?? null

  const start = (tier: string) => {
    haptic.tap()
    void action.run(() => api.arenaStart(tier, gewaehlt ?? undefined),
      (res) => { arena.set(res.arena); onBattle() })
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
      aside={aktiv?.name ? <span className="tag">{aktiv.name}</span> : null}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {/* Drei Typen am Tag statt einem: wer gegen den einen kein passendes
            Team hat, musste sonst bis morgen warten. */}
        {d && d.types.length > 1 && (
          <div className="segmented" role="tablist">
            {d.types.map((ty) => (
              <button key={ty.id} type="button" role="tab" aria-selected={ty.id === gewaehlt}
                className="segmented__btn"
                onClick={() => { haptic.select(); setTyp(ty.id) }}>
                {ty.name}
                {ty.clearedTiers.length > 0 && <span className="segmented__done"> ·{ty.clearedTiers.length}</span>}
              </button>
            ))}
          </div>
        )}

        {d && (
          <p className="explain">
            {t('arena.explain', {
              type: aktiv?.name ?? d.typeName ?? '—',
              rounds: d.rounds,
              heal: d.healPercent,
              avg: d.averageLevel,
              energy: d.energyCost,
            })}
          </p>
        )}

        {/* Vor dem Antreten, nicht mittendrin: mit einem angeschlagenen Team
            sind vier Kaempfe nicht zu schaffen, und aus dem Kampf kommt man
            nur mit einer Niederlage wieder heraus. */}
        {d && !d.run && d.teamHealth < 60 && (
          <p className="notice" role="status">{t('arena.hurt', { n: d.teamHealth, heal: d.healPercent })}</p>
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
                    {aktiv?.clearedTiers.includes(tier.id) ? t('arena.again') : t('arena.enter')}
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

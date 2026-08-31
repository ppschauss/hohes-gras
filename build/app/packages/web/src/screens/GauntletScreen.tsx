import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type GauntletSummary, type GauntletView } from '../lib/api'
import { number } from '../lib/format'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'
import { CenterState } from '../ui/States'
import { LootList } from '../ui/LootList'

/**
 * Kampfzone.
 *
 * Zwei Zustände wie bei der Arena: kein Lauf — dann steht die Wahl der Region;
 * ein Lauf läuft — dann gibt es genau einen Knopf, der weitergeht. Alles
 * andere passiert im Kampf.
 */
export function GauntletScreen({ onBack, onBattle }: { onBack: () => void; onBattle: () => void }) {
  const zone = useAsync(() => api.gauntlet(), [])
  const action = useAction()
  const [region, setRegion] = useState<string | null>(null)
  /** Die Abrechnung des letzten Laufs — sie soll auch stehen bleiben, wenn man
   *  freiwillig aufhoert und nicht erst im Kampfbildschirm auftaucht. */
  const [summary, setSummary] = useState<GauntletSummary | null>(null)
  const d = zone.data
  const gewaehlt = region ?? d?.regions[0]?.id ?? null
  const aktiv = d?.regions.find((r) => r.id === gewaehlt)

  const start = () => {
    if (!gewaehlt) return
    haptic.tap()
    void action.run(() => api.gauntletStart(gewaehlt), (res) => { zone.set(res.gauntlet); onBattle() })
  }

  return (
    <Screen
      eyebrow={t('gauntlet.eyebrow')}
      title={t('gauntlet.title')}
      onBack={onBack}
      aside={d?.run ? <span className="tag">{t('gauntlet.running', { n: d.run.streak })}</span> : null}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {d && <p className="explain">{t('gauntlet.explain', { n: d.energyCost })}</p>}

        {/* Was der letzte Lauf gebracht hat. Ohne das verschwindet alles stumm
            im Beutel, und eine Serie von dreissig fuehlt sich an wie nichts. */}
        {summary && (
          <div className="summary">
            <h3 className="summary__title">
              {t('gauntlet.summary', { n: summary.streak, region: summary.regionName })}
            </h3>
            <p className="num">
              {t('gauntlet.summaryTotals', { gold: number(summary.gold), xp: number(summary.xp) })}
            </p>
            <p className="center__body num">{t('gauntlet.best', { n: summary.best })}</p>
            <LootList items={summary.items} label={t('gauntlet.summaryLoot')} />
          </div>
        )}

        {d?.run
          ? (
            <section className="section">
              <h2>{t('gauntlet.running', { n: d.run.streak })}</h2>
              <p className="center__body">{d.run.regionName}</p>
              <p className="center__body num">
                {d.run.next
                  ? t('gauntlet.nextAt', {
                      n: d.run.next.at, gold: number(d.run.next.gold), mats: d.run.next.materials,
                    })
                  : t('gauntlet.noNext')}
              </p>
              <div className="row">
                <button type="button" className="btn btn--primary" disabled={action.busy} onClick={onBattle}>
                  {t('gauntlet.toBattle')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                  onClick={() => {
                    haptic.tap()
                    void action.run(() => api.gauntletAbandon(), (r) => {
                      zone.set(r.gauntlet); setSummary(r.summary)
                    })
                  }}>
                  {t('gauntlet.giveUp')}
                </button>
              </div>
            </section>
          )
          : d && d.regions.length === 0
            ? <CenterState glyph="🗺️" title={t('gauntlet.title')} body={t('gauntlet.noRegion')} />
            : (
              <>
                <section className="section">
                  <h2>{t('gauntlet.pickRegion')}</h2>
                  <div className="segmented" role="tablist">
                    {d?.regions.map((r) => (
                      <button key={r.id} type="button" role="tab" aria-selected={r.id === gewaehlt}
                        className="segmented__btn" onClick={() => { haptic.select(); setRegion(r.id) }}>
                        {r.name}
                      </button>
                    ))}
                  </div>

                  {aktiv && (
                    <>
                      <p className="center__body num">
                        {t('gauntlet.best', { n: aktiv.best })}
                        {' · '}{t('gauntlet.avgLevel', { n: d!.averageLevel })}
                        {' · '}{t('gauntlet.xp', { n: d!.xpMultiplier })}
                      </p>
                      {/* Was es hier gibt — der Grund, sich fuer eine Region zu
                          entscheiden statt fuer irgendeine. */}
                      <span className="section__eyebrow">{t('gauntlet.drops')}</span>
                      <ul className="loot__list">
                        {aktiv.drops.map((i) => (
                          <li key={i.itemId} className="loot__row">
                            {i.icon && <img src={i.icon} alt="" width={22} height={22} />}
                            <span className="loot__name">{i.name}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <button type="button" className="btn btn--primary btn--block"
                    disabled={!gewaehlt || action.busy} onClick={start}>
                    {t('gauntlet.enter')}
                  </button>
                </section>

                <section className="section">
                  <h2>{t('gauntlet.milestones')}</h2>
                  <ul className="loot__list">
                    {d?.milestones.map((m) => (
                      <li key={m.at} className="loot__row">
                        <span className="loot__name num">{m.at}</span>
                        <span className="loot__num num">
                          {number(m.gold)} Gold · {m.materials} Werkstoffe
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
      </main>
    </Screen>
  )
}

export type { GauntletView }

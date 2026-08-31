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

        {d && <p className="explain">{t('gauntlet.explain', { n: d.energyCost, heal: d.fullHealEvery })}</p>}

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
              {/* Der laufende Stand. Ohne ihn sieht man erst nach dem
                  Aufhoeren, was der Lauf eingebracht hat. */}
              <p className="center__body num">
                {t('gauntlet.soFar', {
                  n: d.run.defeated,
                  gold: number(d.run.gold),
                  xp: number(d.run.xp),
                })}
              </p>
              {/* Wie weit es noch ist — als Balken, nicht als Rechenaufgabe.
                  "Serie 33, naechste Stufe bei 50" verlangt vom Leser die
                  Subtraktion; ein Balken zeigt sie. */}
              {d.run.next && (
                <div className="bar bar--lg" role="img"
                  aria-label={t('gauntlet.toNext', { n: d.run.next.at - d.run.streak })}>
                  <span className="bar__fill bar__fill--xp"
                    style={{ width: `${fortschritt(d.run.streak, d.run.next.at)}%` }} />
                </div>
              )}
              <p className="center__body num">
                {d.run.next
                  ? `${t('gauntlet.toNext', { n: d.run.next.at - d.run.streak })} · ${t('gauntlet.nextAt', {
                      n: d.run.next.at, gold: number(d.run.next.gold), mats: d.run.next.materials,
                    })}`
                  : t('gauntlet.noNext')}
              </p>
              {/* Die Erholung haengt an einer eigenen Marke, nicht an den
                  Praemienstufen — das muss man vor dem naechsten Kampf wissen. */}
              <p className="center__body num">
                {t('gauntlet.toHeal', {
                  n: d.fullHealEvery - (d.run.streak % d.fullHealEvery),
                  every: d.fullHealEvery,
                })}
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
                            {/* Die Schwelle ist der eigentliche Anreiz: wer bei
                                zehn aufhoert, sieht nie, was bei fuenfzig liegt. */}
                            <span className="loot__num num">
                              {i.from > 0 ? t('gauntlet.dropFrom', { n: i.from }) : t('gauntlet.dropAlways')}
                            </span>
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

                {/* Die Stufen der gewaehlten Region, mit den Gegenstaenden
                    beim Namen. "7 Werkstoffe" sagt nicht, welche — und genau
                    danach entscheidet man, wie weit man laeuft. */}
                {aktiv && (
                  <section className="section">
                    <h2>{t('gauntlet.milestones')}</h2>
                    <ul className="stufen">
                      {aktiv.milestones.map((m) => (
                        <li key={m.at} className="stufe">
                          <span className="stufe__at num">{m.at}</span>
                          <span className="stufe__body">
                            <span className="stufe__gold num">
                              {t('gauntlet.milestoneGold', { n: number(m.gold) })}
                              {m.heals && <> · {t('gauntlet.milestoneHeals')}</>}
                            </span>
                            <span className="stufe__items">
                              {m.items.map((i) => (
                                <span key={i.itemId} className="stufe__item">
                                  {i.icon && <img src={i.icon} alt="" width={18} height={18} />}
                                  <span className="num">{i.quantity}×</span> {i.name}
                                </span>
                              ))}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
      </main>
    </Screen>
  )
}

export type { GauntletView }

/**
 * Wie weit die Serie zwischen der letzten und der naechsten Stufe steht.
 *
 * Von der vorigen Stufe aus gerechnet, nicht von null: sonst stuende der
 * Balken zwischen fuenfzig und hundert die halbe Zeit fast voll und bewegte
 * sich kaum noch.
 */
function fortschritt(streak: number, ziel: number): number {
  const vorher = MEILEN.filter((m) => m < ziel).pop() ?? 0
  const spanne = ziel - vorher
  if (spanne <= 0) return 100
  return Math.max(0, Math.min(100, ((streak - vorher) / spanne) * 100))
}

const MEILEN = [0, 10, 15, 25, 50, 100]

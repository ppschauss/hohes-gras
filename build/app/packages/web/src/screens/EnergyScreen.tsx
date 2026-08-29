import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

/**
 * Energie: Stand, Nachschub, Preise.
 *
 * Der Bildschirm beantwortet drei Fragen an einer Stelle — wie viel habe ich,
 * was kostet was, und wie komme ich an mehr. Ohne den dritten Teil waere die
 * Ressource eine Sperre; mit ihm ist sie eine Entscheidung.
 */
const COST_ORDER = ['care', 'explore', 'expedition', 'battle', 'duel', 'raid'] as const
const REWARD_ORDER = ['battleWon', 'duelWon', 'evolution', 'raidVictory', 'badge', 'areaCompleted'] as const

const format = (n: number): string => new Intl.NumberFormat('de-DE').format(n)

/** Punkte je Minute, auf eine Nachkommastelle — "2 pro Minute" ist greifbarer
 *  als "120 pro Stunde". */
const perMinute = (perHour: number): string =>
  new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(perHour / 60)

export function EnergyScreen({ onBack }: { onBack: () => void }) {
  const energy = useAsync(() => api.energy(), [])
  const action = useAction()
  const d = energy.data

  if (energy.loading && !d) {
    return <main className="content">{[0, 1].map((i) => <div key={i} className="skeleton skeleton--row" />)}</main>
  }

  return (
    <Screen
      eyebrow={t('energy.eyebrow')}
      title={t('energy.title')}
      onBack={onBack}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {d && (
          <section className="energyHero">
            <span className="energyHero__glyph" aria-hidden="true">⚡</span>
            <span className="energyHero__value num">{format(d.state.current)}</span>
            <span className="energyHero__cap num">/ {format(d.state.cap)}</span>
            <p className="energyHero__note">
              {d.state.current >= d.state.cap
                ? t('energy.full')
                : t('energy.regen', {
                    n: perMinute(d.state.perHour),
                    minutes: d.fillMinutes,
                  })}
            </p>
          </section>
        )}

        {d && (
          <section className="section">
            <h2>{t('energy.expand')}</h2>
            <article className="packRow">
              <span className="packRow__text">
                <span className="packRow__name">
                  {d.expansion.nextPrice === null
                    ? t('energy.expand.maxed')
                    : t('energy.expand.next', { n: d.expansion.stepSize, cap: d.state.cap + d.expansion.stepSize })}
                </span>
                <span className="packRow__meta num">
                  {t('energy.expand.steps', { done: d.expansion.steps, max: d.expansion.maxSteps })}
                </span>
              </span>
              {d.expansion.nextPrice !== null && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={action.busy || d.gold < d.expansion.nextPrice}
                  onClick={() => {
                    haptic.tap()
                    void action.run(() => api.expandEnergy(), (next) => energy.set(next))
                  }}
                >
                  🪙 {format(d.expansion.nextPrice)}
                </button>
              )}
            </article>
            <p className="explain">{t('energy.expand.hint')}</p>
          </section>
        )}

        <section className="section">
          <h2>{t('energy.buy')}</h2>
          {d && (
            <p className="explain">
              {t('energy.toGold', { limit: format(d.toGoldLimit), rate: d.toGoldRate })}
            </p>
          )}
          <div className="stack">
            {d?.packs.map((pack) => {
              const affordable = d.gold >= pack.gold
              // Was von dieser Packung sofort wieder zu Gold wuerde. Ein Kauf,
              // der zu 90 % in Gold zurueckfliesst, ist keiner — das gehoert
              // vor den Knopf und nicht in die Quittung.
              const toGold = Math.max(0, d.state.current + pack.energy - d.toGoldLimit)
              return (
                <article key={pack.id} className="packRow">
                  <span className="packRow__text">
                    <span className="packRow__name">{t('energy.pack', { n: pack.energy })}</span>
                    <span className="packRow__meta num">{t('energy.perPoint', { n: pack.pricePerPoint })}</span>
                    {toGold > 0 && (
                      <span className="packRow__warn">{t('energy.toGold.warn', { n: toGold })}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!affordable || action.busy}
                    onClick={() => {
                      haptic.tap()
                      void action.run(() => api.buyEnergy(pack.id), (next) => energy.set(next))
                    }}
                  >
                    🪙 {format(pack.gold)}
                  </button>
                </article>
              )
            })}
          </div>
        </section>

        <section className="section">
          <h2>{t('energy.costs')}</h2>
          <ul className="ledger">
            {COST_ORDER.filter((key) => d?.costs[key] !== undefined).map((key) => (
              <li key={key} className="ledger__row">
                <span className="ledger__text">
                  {t(`energy.cost.${key}`)}
                  <Note id={`energy.cost.${key}.note`} />
                </span>
                {/* Die Expedition kostet nach Dauer, nicht pauschal — eine
                    einzelne Zahl waere hier schlicht falsch. */}
                <span className="ledger__value ledger__value--out num">
                  {key === 'expedition' ? '−2 … −6' : `−${d!.costs[key]}`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="section">
          <h2>{t('energy.earn')}</h2>
          <ul className="ledger">
            {REWARD_ORDER.filter((key) => d?.rewards[key] !== undefined).map((key) => (
              <li key={key} className="ledger__row">
                <span className="ledger__text">
                  {t(`energy.reward.${key}`)}
                  <Note id={`energy.reward.${key}.note`} />
                </span>
                <span className="ledger__value ledger__value--in num">+{d!.rewards[key]}</span>
              </li>
            ))}
          </ul>
          <p className="explain">{t('energy.explain', { limit: format(d?.toGoldLimit ?? 0) })}</p>
        </section>
      </main>
    </Screen>
  )
}

/**
 * Die Einschränkung unter einer Zeile.
 *
 * Die Zahlen allein logen nicht, sie sagten nur die halbe Wahrheit: "+4 für
 * einen gewonnenen Kampf" stimmt genau einmal je Gegner, "+15 fürs Entwickeln"
 * zehnmal am Tag. Wer danach plant, plant falsch.
 *
 * Fehlt der Schlüssel, gibt `t` ihn zurück — dann steht hier nichts.
 */
function Note({ id }: { id: string }) {
  const text = t(id)
  if (text === id) return null
  return <span className="ledger__note">{text}</span>
}

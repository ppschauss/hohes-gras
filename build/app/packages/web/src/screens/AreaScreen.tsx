import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

interface Props {
  onBack: () => void
  onSafari: () => void
  onBattle: () => void
}

/** What you can do where you are standing. The video's original put Safari,
 *  Training and the gym behind one area card; this keeps that shape. */
export function AreaScreen({ onBack, onSafari, onBattle }: Props) {
  const opponents = useAsync(() => api.opponents(), [])
  const garden = useAsync(() => api.garden(), [])
  const spawns = useAsync(() => api.areaSpawns(), [])
  const action = useAction()

  const data = opponents.data
  const teamFainted = (garden.data?.team.length ?? 0) > 0
    && (garden.data?.team ?? []).every((c) => c.hpCurrent <= 0)
  const hurt = (garden.data?.team ?? []).some((c) => c.hpCurrent < c.hpMax)

  const heal = () => {
    haptic.tap()
    void action.run(() => api.healTeam(), () => { garden.reload(); haptic.success() })
  }

  const defeated = data?.trainers.filter((x) => x.defeated).length ?? 0
  // Dieselbe Rechnung wie auf dem Server: drei Gold je Level der Verletzten.
  const healCost = (garden.data?.team ?? [])
    .filter((c) => c.hpCurrent < c.hpMax)
    .reduce((sum, c) => sum + c.level * 3, 0)

  return (
    <Screen
      eyebrow={t('area.title')}
      title={data?.areaName ?? ''}
      onBack={onBack}
      aside={data && <span className="num">{defeated}/{data.trainers.length} · {t('area.trainers')}</span>}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
        {teamFainted && <p className="notice" role="alert">{t('battle.teamFainted')}</p>}

        <nav className="menu">
          <button type="button" className="menu__row" onClick={() => { haptic.tap(); onSafari() }}>
            <span className="menu__icon" aria-hidden="true">🌾</span>
            <span className="menu__text">
              <span className="menu__title">{t('area.safari')}</span>
              <span className="menu__hint">{t('area.safari.hint')}</span>
            </span>
            <span className="menu__aside" aria-hidden="true">›</span>
          </button>

          <button type="button" className="menu__row" onClick={() => { haptic.tap(); onBattle() }}
            disabled={(data?.trainers.length ?? 0) === 0 && !data?.gym}>
            <span className="menu__icon" aria-hidden="true">⚔️</span>
            <span className="menu__text">
              <span className="menu__title">{t('area.trainers')}</span>
              <span className="menu__hint">{t('area.trainers.hint')}</span>
            </span>
            <span className="menu__aside">
              {data && <span className="tag">{defeated}/{data.trainers.length}</span>}
            </span>
          </button>

          {data?.gym && (
            <button type="button" className="menu__row" onClick={() => { haptic.tap(); onBattle() }}>
              <span className="menu__icon" aria-hidden="true">🏅</span>
              <span className="menu__text">
                <span className="menu__title">{data.gym.name}</span>
                <span className="menu__hint">{t('area.gym.hint')}</span>
              </span>
              <span className="menu__aside">
                {data.gym.badgeEarned
                  ? <span className="tag tag--done">{t('battle.badgeEarned')}</span>
                  : <span className="tag tag--soon">{t('area.gym')}</span>}
              </span>
            </button>
          )}
        </nav>

        {/* Der bezahlte Weg neben dem Poke-Center: dort ist Heilen kostenlos,
            aber mit Wartezeit. Der Preis gehoert deshalb auf den Knopf — ohne
            ihn sieht das hier aus, als umginge es die Abklingzeit gratis. */}
        {hurt && (
          <button type="button" className="btn btn--ghost btn--block" onClick={heal} disabled={action.busy}>
            {t('battle.heal')}
            {healCost > 0 && <span className="btn__note num">{t('battle.healCost', { n: healCost })}</span>}
          </button>
        )}

        {/* Wer hier lebt.
            Gemeldet: man sah nie, was ein Gebiet ueberhaupt hergibt. Gezeigt
            wird, was man hier schon gesehen hat — der Rest bleibt eine Zahl,
            sonst waere das Entdecken vorweggenommen. */}
        {spawns.data && (
          <section className="section">
            <div className="sectionHead">
              <h2>{t('area.spawns')}</h2>
              <span className="num">
                {t('area.spawns.count', {
                  known: spawns.data.species.length,
                  total: spawns.data.total,
                  caught: spawns.data.caught,
                })}
              </span>
            </div>

            {spawns.data.species.length === 0
              ? <p className="center__body">{t('area.spawns.none')}</p>
              : (
                <div className="stack">
                  {spawns.data.species.map((s) => (
                    <article key={s.speciesId}
                      className={`spawn${s.availableNow ? '' : ' spawn--off'}${s.known ? '' : ' spawn--unknown'}`}>
                      {/* Unbekanntes bleibt ohne Bild: dass da etwas ist, sagt
                          die Zeile — was es ist, findet man selbst heraus. */}
                      {s.known
                        ? <img className="spawn__mon" src={s.sprite ?? ''} alt="" width={40} height={40} />
                        : <span className="spawn__mon spawn__mon--hidden" aria-hidden="true">?</span>}
                      <span className="spawn__text">
                        <span className="spawn__name">
                          {s.known ? s.name : t('area.spawns.hidden')}
                          {s.caught && <span className="tag tag--done">{t('area.spawns.caught')}</span>}
                        </span>
                        <span className="spawn__meta num">
                          {t('creature.levelRange', { from: s.minLevel, to: s.maxLevel })}
                          {/* Wann es ueberhaupt erscheint — die Auskunft, ohne
                              die man nicht weiss, wann sich Suchen lohnt. */}
                          {/* Bedingungen sind Listen: "nur nachts oder abends". */}
                          {s.timeOfDay?.length
                            ? ` · ${t('area.spawns.onlyAt', { when: joinOr(s.timeOfDay.map((x) => t(`time.${x}`))) })}`
                            : null}
                          {s.weather?.length
                            ? ` · ${t('area.spawns.onlyAt', { when: joinOr(s.weather.map((x) => t(`weather.${x}`))) })}`
                            : null}
                          {!s.availableNow && !s.timeOfDay?.length && !s.weather?.length
                            && ` · ${t('area.spawns.later')}`}
                        </span>
                      </span>
                      <span className="spawn__chance num">
                        {s.availableNow ? `${s.chance} %` : '—'}
                      </span>
                    </article>
                  ))}
                </div>
              )}

            {spawns.data.unknown > 0 && (
              <p className="chain__hint">{t('area.spawns.unknownHint', { n: spawns.data.unknown })}</p>
            )}
          </section>
        )}
      </main>
    </Screen>
  )
}

/** „Regen oder Sturm" statt „rain,storm". */
function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} ${t('app.or')} ${parts[parts.length - 1]}`
}

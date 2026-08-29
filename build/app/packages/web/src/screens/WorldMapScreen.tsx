import { useState } from 'react'
import type { AreaView, UnlockRequirement } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

interface Props {
  onBack: () => void
  onEnterArea: () => void
}

export function WorldMapScreen({ onBack, onEnterArea }: Props) {
  const world = useAsync(() => api.world(), [])
  const action = useAction()
  // Ohne Wahl zeigt die Karte die Region, in der man gerade steht.
  const [regionId, setRegionId] = useState<string | null>(null)

  const regions = world.data?.regions ?? []
  const currentRegion = regions.find((r) => r.areas.some((a) => a.isCurrent))
  const shown = regions.find((r) => r.id === regionId) ?? currentRegion ?? regions[0]

  const travel = (area: AreaView) => {
    haptic.tap()
    if (area.isCurrent) { onEnterArea(); return }
    void action.run(() => api.travel(area.id), (next) => { world.set(next); haptic.success(); onEnterArea() })
  }

  return (
    <Screen
      eyebrow={t('map.eyebrow')}
      title={t('map.title')}
      onBack={onBack}
      aside={world.data && (
        <span>
          {t(`weather.${world.data.clock.weather}`)} · <b>{t(`time.${world.data.clock.timeOfDay}`)}</b>
        </span>
      )}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {world.data && (
          <section className="travelCap">
            <div className="travelCap__head">
              <span className="travelCap__title">{t('map.cap.title')}</span>
              <span className="travelCap__value num">
                {t('map.cap.value', { n: world.data.travel.cap })}
              </span>
            </div>
            <span className="bar bar--lg">
              <span
                className="bar__fill bar__fill--dex"
                style={{ width: `${(world.data.travel.clearedRegions / Math.max(1, world.data.travel.totalRegions)) * 100}%` }}
              />
            </span>
            <p className="travelCap__hint">
              {world.data.travel.nextCap === null
                ? t('map.cap.done', { n: world.data.travel.cap })
                : t('map.cap.next', {
                    cleared: world.data.travel.clearedRegions,
                    total: world.data.travel.totalRegions,
                    next: world.data.travel.nextCap,
                  })}
            </p>
          </section>
        )}

        {world.data && (
          <label className="switch">
            <span className="switch__text">
              <span>{t('map.scaling.title')}</span>
              <span className="switch__hint">
                {world.data.levelScaling
                  ? t('map.scaling.on', { n: world.data.referenceLevel })
                  : t('map.scaling.off')}
              </span>
            </span>
            <input
              type="checkbox"
              checked={world.data.levelScaling}
              disabled={action.busy}
              onChange={(e) => {
                haptic.select()
                void action.run(() => api.setLevelScaling(e.target.checked), (next) => world.set(next))
              }}
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        )}

        {world.loading && !world.data
          ? [0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)
          : shown && (
            <section className="section">
              {/* Ein Auswahlfeld statt aller Regionen untereinander: mit drei
                  Regionen und 38 Gebieten war die Karte eine einzige lange
                  Rolle. Verschlossene Regionen stehen mit Schloss darin und
                  lassen sich nicht waehlen. */}
              <div className="picker picker--wide">
                <span className="picker__label" id="region-picker">{t('map.region')}</span>
                <span className="picker__body">
                  <select
                    className="picker__select"
                    aria-labelledby="region-picker"
                    value={shown.id}
                    onChange={(e) => { haptic.select(); setRegionId(e.target.value) }}
                  >
                    {world.data!.regions.map((r) => (
                      <option key={r.id} value={r.id} disabled={r.locked}>
                        {r.locked ? `🔒 ${r.name}` : r.cleared ? `✓ ${r.name}` : r.name}
                      </option>
                    ))}
                  </select>
                </span>
              </div>

              <div>
                <span className="section__eyebrow">{shown.tagline}</span>
                <h2>{shown.name}</h2>
              </div>

              {shown.locked && <p className="notice" role="status">{t('map.region.locked')}</p>}

              <div className="stack">
                {shown.areas.map((area) => (
                  <AreaRow key={area.id} area={area} busy={action.busy} onTravel={() => travel(area)} />
                ))}
              </div>
            </section>
          )}
      </main>
    </Screen>
  )
}

function AreaRow({ area, busy, onTravel }: { area: AreaView; busy: boolean; onTravel: () => void }) {
  const complete = area.speciesHere > 0 && area.caughtHere >= area.speciesHere

  return (
    <article className={`area${area.unlocked ? '' : ' area--locked'}${area.isCurrent ? ' area--current' : ''}`}>
      <button
        type="button"
        className="area__main"
        onClick={onTravel}
        disabled={!area.unlocked || busy}
      >
        <span className="area__index num">{String(area.order).padStart(2, '0')}</span>
        <span className="area__text">
          <span className="area__head">
            <span className="area__name">{area.name}</span>
            {complete && <span className="tag tag--done">{t('map.done')}</span>}
            {area.isCurrent && <span className="tag tag--active">{t('map.current')}</span>}
          </span>
          <span className="area__desc">{area.description}</span>

          {area.unlocked ? (
            <span className="area__stats">
              <span className="num">{t('map.levels', { min: area.levels.min, max: area.levels.max })}</span>
              {area.levelBoost !== 0 && (
                <span
                  className="tag tag--scaled"
                  title={t(area.levelBoost > 0 ? 'map.scaling.boostHint' : 'map.scaling.lowerHint')}
                >
                  {area.levelBoost > 0
                    ? t('map.scaling.boost', { n: area.levelBoost })
                    : t('map.scaling.lower', { n: -area.levelBoost })}
                </span>
              )}
              <span aria-hidden="true">·</span>
              <span className="num">{t('map.caught', { caught: area.caughtHere, total: area.speciesHere })}</span>
              <span aria-hidden="true">·</span>
              <span className="num">{t('map.spawnableNow', { n: area.spawnableNow })}</span>
              {area.gymId && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className={area.gymCleared ? 'area__gym area__gym--done' : 'area__gym'}>
                    {area.gymCleared ? t('map.gymCleared') : t('map.gym')}
                  </span>
                </>
              )}
            </span>
          ) : (
            <ul className="area__reqs">
              {area.requirements.map((req, i) => <RequirementRow key={i} req={req} />)}
            </ul>
          )}
        </span>
        {area.unlocked && <span className="area__go" aria-hidden="true">›</span>}
      </button>
    </article>
  )
}

/** A locked door has to say what it wants. Each requirement shows its own
 *  progress, so the player knows which one to work on next. */
function RequirementRow({ req }: { req: UnlockRequirement }) {
  return (
    <li className={`req${req.met ? ' req--met' : ''}`}>
      <span className="req__mark" aria-hidden="true">{req.met ? '✓' : '·'}</span>
      <span>{t(`map.req.${req.kind}`, { have: req.have, need: req.need, label: req.label })}</span>
    </li>
  )
}

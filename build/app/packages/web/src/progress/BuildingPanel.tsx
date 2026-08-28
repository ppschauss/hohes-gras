import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'

export function BuildingPanel() {
  const buildings = useAsync(() => api.buildings(), [])
  const action = useAction()

  const upgrade = (id: string) => {
    haptic.tap()
    void action.run(() => api.upgradeBuilding(id), (res) => { buildings.set(res.buildings); haptic.success() })
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      <p className="num">🪙 {number(buildings.data?.gold ?? 0)}</p>

      <div className="stack">
        {buildings.data?.buildings.map((b) => (
          <article key={b.id} className="building">
            <div className="building__head">
              <span className="building__name">{t(`build.name.${b.id}`)}</span>
              <span className="building__level num">
                {b.level === 0 ? t('build.notBuilt') : t('build.level', { n: b.level, max: b.maxLevel })}
              </span>
            </div>

            <div className="building__pips" aria-hidden="true">
              {Array.from({ length: b.maxLevel }, (_, i) => (
                <span key={i} className={`pip${i < b.level ? ' pip--on' : ''}`} />
              ))}
            </div>

            {b.level > 0 && (
              <p className="building__effect">{t(`build.effect.${b.effectKind}`, { n: b.currentEffect })}</p>
            )}
            {b.nextEffect !== null && (
              <p className="building__next">
                {t('build.next')}: {t(`build.effect.${b.effectKind}`, { n: b.nextEffect })}
              </p>
            )}

            <button type="button" className="btn btn--buy btn--sm building__btn"
              disabled={b.maxed || !b.affordable || action.busy} onClick={() => upgrade(b.id)}>
              {b.maxed ? t('build.maxed') : t('build.cost', { n: number(b.upgradeCost ?? 0) })}
            </button>
          </article>
        ))}
      </div>
    </>
  )
}

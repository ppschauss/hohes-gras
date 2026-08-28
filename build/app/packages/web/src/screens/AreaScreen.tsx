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

        {hurt && (
          <button type="button" className="btn btn--ghost btn--block" onClick={heal} disabled={action.busy}>
            {t('battle.heal')}
          </button>
        )}
      </main>
    </Screen>
  )
}

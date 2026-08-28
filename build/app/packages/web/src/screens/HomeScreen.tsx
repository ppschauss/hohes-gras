import type { Bootstrap } from '@game/shared'
import type { TodayTask } from '../lib/api'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAsync } from '../lib/useAsync'
import { useGame, type Screen } from '../store'
import { Icon, type IconName } from '../ui/Icon'
import { Resources } from '../ui/Resources'

/**
 * Der Startbildschirm.
 *
 * Vorher eine Liste von acht immer gleichen Türen. Die Frage, mit der man eine
 * Mini-App öffnet, ist aber nicht "welche Räume gibt es", sondern "hat sich
 * etwas getan" — und die beantwortete der alte Bildschirm nur, indem man alle
 * acht Türen der Reihe nach aufmachte.
 *
 * Jetzt steht oben, was fertig ist. Ist nichts fertig, sagt er auch das, statt
 * eine leere Zeile zu zeigen. Die Räume darunter sind ein Raster statt einer
 * Liste: acht Ziele in vier Zeilen Höhe, nicht in acht.
 */
interface Destination {
  screen: Screen
  icon: IconName
  labelKey: string
  feature: string
}

const DESTINATIONS: Destination[] = [
  { screen: 'garden', icon: 'garden', labelKey: 'menu.garden.title', feature: 'garden' },
  { screen: 'map', icon: 'map', labelKey: 'menu.map.title', feature: 'worldmap' },
  { screen: 'teams', icon: 'team', labelKey: 'menu.teams.title', feature: 'teams' },
  { screen: 'plots', icon: 'plots', labelKey: 'menu.plots.title', feature: 'plots' },
  { screen: 'expeditions', icon: 'expedition', labelKey: 'menu.expeditions.title', feature: 'safari' },
  { screen: 'eggs', icon: 'egg', labelKey: 'menu.eggs.title', feature: 'safari' },
  { screen: 'center', icon: 'center', labelKey: 'menu.center.title', feature: 'center' },
  { screen: 'shop', icon: 'shop', labelKey: 'menu.shop.title', feature: 'shop' },
  { screen: 'coop', icon: 'guild', labelKey: 'menu.coop.title', feature: 'guilds' },
  { screen: 'progress', icon: 'progress', labelKey: 'menu.progress.title', feature: 'story' },
  { screen: 'friends', icon: 'friends', labelKey: 'menu.friends.title', feature: 'social' },
  { screen: 'energy', icon: 'energy', labelKey: 'menu.energy.title', feature: 'energy' },
  { screen: 'themes', icon: 'spark', labelKey: 'menu.themes.title', feature: 'themes' },
]

const TASK_ICONS: Record<TodayTask['kind'], IconName> = {
  expedition: 'expedition',
  plot_harvest: 'plots',
  plot_tend: 'plots',
  center: 'center',
  egg: 'egg',
  pvp: 'guild',
  raid: 'guild',
  care: 'garden',
}

export function HomeScreen({ boot }: { boot: Bootstrap }) {
  const setScreen = useGame((s) => s.setScreen)
  const today = useAsync(() => api.today(), [])
  const tasks = today.data?.tasks ?? []

  const go = (screen: Screen) => { haptic.tap(); setScreen(screen) }

  return (
    <>
      <header className="appbar appbar--home">
        <span className="appbar__text">
          <span className="appbar__title">{t('home.greeting', { name: boot.trainer.displayName })}</span>
          <span className="appbar__eyebrow">
            {t(`time.${boot.clock.timeOfDay}`)} · {t(`weather.${boot.clock.weather}`)}
          </span>
        </span>
        <Resources />
      </header>

      <main className="content">
        <section className="today">
          <h2 className="today__head">{t('home.now')}</h2>

          {today.loading && !today.data
            ? <div className="skeleton skeleton--row" />
            : tasks.length === 0
              ? (
                <p className="today__quiet">
                  <Icon name="check" size={18} />
                  {t('home.allDone')}
                </p>
              )
              : (
                <div className="today__list">
                  {tasks.map((task) => (
                    <button
                      key={task.kind}
                      type="button"
                      className="task"
                      onClick={() => go(task.screen as Screen)}
                    >
                      <span className="task__icon"><Icon name={TASK_ICONS[task.kind]} size={20} /></span>
                      <span className="task__text">
                        <span className="task__title">{t(`home.task.${task.kind}`, { n: task.count })}</span>
                        <span className="task__hint">{t(`home.taskHint.${task.kind}`)}</span>
                      </span>
                      {task.count > 0 && <span className="task__count num">{task.count}</span>}
                      <Icon name="chevron" size={16} className="task__go" />
                    </button>
                  ))}
                </div>
              )}
        </section>

        {today.data && (
          <section className="journey" aria-label={t('home.journey')}>
            <span className="journey__cell">
              <span className="journey__label">{t('home.area')}</span>
              <span className="journey__value">{today.data.journey.areaName ?? t('home.nowhere')}</span>
            </span>
            <span className="journey__cell">
              <span className="journey__label">{t('home.dex')}</span>
              <span className="journey__value num">
                {today.data.journey.dexCaught}<span className="journey__of">/{today.data.journey.dexTotal}</span>
              </span>
            </span>
            <span className="journey__cell">
              <span className="journey__label">{t('home.badges')}</span>
              <span className="journey__value num">
                {today.data.journey.badges}<span className="journey__of">/{today.data.journey.badgeTotal}</span>
              </span>
            </span>
          </section>
        )}

        <nav className="grid" aria-label={t('app.title')}>
          {DESTINATIONS.map((d) => {
            const enabled = boot.features[d.feature] === true
            return (
              <button
                key={d.screen}
                type="button"
                className="tile"
                disabled={!enabled}
                onClick={() => go(d.screen)}
              >
                <Icon name={d.icon} size={24} />
                <span className="tile__label">{t(d.labelKey)}</span>
              </button>
            )
          })}
        </nav>
      </main>
    </>
  )
}

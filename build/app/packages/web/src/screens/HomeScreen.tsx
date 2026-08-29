import { useState } from 'react'
import type { Bootstrap } from '@game/shared'
import type { LoginView, TodayTask } from '../lib/api'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { untilLabel } from '../lib/format'
import { useGame, type Screen } from '../store'
import { Icon, type IconName } from '../ui/Icon'
import { DESTINATIONS } from '../ui/destinations'
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
  const login = useAsync(() => api.login(), [])
  const claim = useAction()
  const [got, setGot] = useState<{ label: string; bonus: boolean } | null>(null)

  const collect = () => {
    haptic.tap()
    void claim.run(() => api.claimLogin(), (res) => {
      login.set(res.state)
      setGot({ label: res.label, bonus: res.bonus })
      haptic.success()
    })
  }

  const go = (screen: Screen) => { haptic.tap(); setScreen(screen) }

  return (
    <>
      <header className="appbar appbar--home">
        <span className="appbar__text">
          <span className="appbar__title">{t('home.greeting', { name: boot.trainer.displayName })}</span>
          <span className="appbar__eyebrow">
            {t(`time.${boot.clock.timeOfDay}`)} · {t(`weather.${boot.clock.weather}`)}
            {' · '}
            {t('clock.next', {
              what: t(`time.${boot.clock.nextTimeOfDay}`),
              when: untilLabel(boot.clock.nextTimeOfDayAt),
            })}
          </span>
        </span>
        <Resources />
      </header>

      <main className="content content--home">
        {login.data && <LoginCard data={login.data} busy={claim.busy} got={got} onClaim={collect} />}

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

        {/* Am Rechner traegt die Seitenleiste dieselben Ziele — dann waere das
            Raster hier eine zweite Navigation mit denselben dreizehn Woertern. */}
        <nav className="grid grid--menu" aria-label={t('app.title')}>
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

/**
 * Die Anmeldeleiter.
 *
 * Nur die laufende Woche steht als Kacheln da — achtundzwanzig Felder auf
 * einem Telefon waeren Konfetti. Die Wochenpraemie traegt einen Funken, weil
 * sie der Grund ist, die Kette nicht abreissen zu lassen.
 */
function LoginCard(
  { data, busy, got, onClaim }:
  { data: LoginView; busy: boolean; got: { label: string; bonus: boolean } | null; onClaim: () => void },
) {
  const week = Math.floor((data.nextDay - 1) / data.weekDays)
  const days = data.days.slice(week * data.weekDays, (week + 1) * data.weekDays)

  return (
    <section className="daily">
      <div className="daily__head">
        <span className="daily__text">
          <span className="daily__title">{t('login.title')}</span>
          <span className="daily__meta">
            {t('login.progress', { day: data.nextDay, max: data.cycleDays })}
            {data.streak > 0 && ` · ${t('login.streak', { n: data.streak })}`}
          </span>
        </span>
        {data.claimable && (
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={onClaim}>
            {t('login.claim')}
          </button>
        )}
      </div>

      <div className="daily__week">
        {days.map((d) => (
          <span
            key={d.day}
            className={`daily__day${d.claimed ? ' daily__day--done' : ''}`
              + `${d.isNext ? ' daily__day--next' : ''}${d.bonus ? ' daily__day--bonus' : ''}`}
            title={d.label}
          >
            <span className="daily__num num">{d.bonus ? '✦' : d.day}</span>
          </span>
        ))}
      </div>

      {got
        ? <p className="daily__note daily__note--ok">{t(got.bonus ? 'login.gotBonus' : 'login.got', { what: got.label })}</p>
        : data.claimable
          ? <p className="daily__note">{t('login.waiting', { what: data.days[data.nextDay - 1]?.label ?? '' })}</p>
          : <p className="daily__note">{t('login.done')}</p>}
    </section>
  )
}

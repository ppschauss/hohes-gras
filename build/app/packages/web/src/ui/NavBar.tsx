import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import type { Screen } from '../store'
import { Icon, type IconName } from './Icon'

interface NavDef {
  screen: Screen
  labelKey: string
  icon: IconName
  /** Unterbildschirme, bei denen dieser Eintrag als aktiv gilt. */
  covers: Screen[]
}

/**
 * Die Navigation des Spiels.
 *
 * Fuenf Ziele, weil mehr in einer Telegram-Leiste nicht lesbar bleibt. Alles,
 * was seltener gebraucht wird — Shop, Eier, Gilde, Fortschritt, Energie —
 * haengt am Startbildschirm statt hier.
 */
export const NAV: NavDef[] = [
  { screen: 'home', labelKey: 'nav.home', icon: 'home', covers: ['shop', 'eggs', 'coop', 'progress', 'energy', 'center', 'plots', 'themes'] },
  { screen: 'garden', labelKey: 'nav.garden', icon: 'garden', covers: ['dex'] },
  { screen: 'map', labelKey: 'nav.map', icon: 'map', covers: ['area', 'safari', 'battle', 'expeditions'] },
  { screen: 'teams', labelKey: 'nav.teams', icon: 'team', covers: ['box'] },
  { screen: 'friends', labelKey: 'nav.friends', icon: 'friends', covers: [] },
]

const sectionOf = (screen: Screen): Screen =>
  NAV.find((n) => n.screen === screen || n.covers.includes(screen))?.screen ?? 'home'

interface Props {
  active: Screen
  onChange: (screen: Screen) => void
}

export function NavBar({ active, onChange }: Props) {
  const section = sectionOf(active)
  return (
    <nav className="tabbar" aria-label={t('app.title')}>
      {NAV.map((item) => {
        const current = section === item.screen
        return (
          <button
            key={item.screen}
            type="button"
            className="tabbar__btn"
            aria-current={current ? 'page' : undefined}
            onClick={() => {
              if (active === item.screen) return
              haptic.select()
              onChange(item.screen)
            }}
          >
            <Icon name={item.icon} size={22} />
            <span className="tabbar__label">{t(item.labelKey)}</span>
          </button>
        )
      })}
    </nav>
  )
}

export { sectionOf }

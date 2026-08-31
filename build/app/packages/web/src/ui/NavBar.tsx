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
  {
    screen: 'home', labelKey: 'nav.home', icon: 'home',
    // Expeditionen, Arena und Kampfzone erreicht man ueber den Start, nicht
    // ueber die Karte. Die Expeditionen standen hier unter `map` und liessen
    // deshalb die Weltkarte aufleuchten — in der Seitenleiste sogar beide
    // Eintraege zugleich. Genau so gemeldet.
    covers: ['shop', 'eggs', 'coop', 'progress', 'energy', 'center', 'plots', 'themes',
      'expeditions', 'arena', 'gauntlet', 'changelog'],
  },
  { screen: 'garden', labelKey: 'nav.garden', icon: 'garden', covers: ['dex'] },
  { screen: 'map', labelKey: 'nav.map', icon: 'map', covers: ['area', 'safari'] },
  { screen: 'teams', labelKey: 'nav.teams', icon: 'team', covers: ['box'] },
  { screen: 'friends', labelKey: 'nav.friends', icon: 'friends', covers: [] },
]

/**
 * Bildschirme, die zu keinem festen Bereich gehoeren.
 *
 * Ein Kampf kann aus einem Gebiet kommen, aus der Arena oder aus der
 * Kampfzone. Fest unter der Karte eingetragen liess er waehrend eines
 * Kampfzonen-Laufs die Weltkarte aufleuchten. Woher er kam, weiss nur der
 * Verlauf — also fragt er ihn.
 */
const OHNE_HEIMAT: Screen[] = ['battle']

const direkt = (screen: Screen): Screen | null =>
  NAV.find((n) => n.screen === screen || n.covers.includes(screen))?.screen ?? null

const sectionOf = (screen: Screen, history: readonly Screen[] = []): Screen => {
  if (OHNE_HEIMAT.includes(screen)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const vorher = history[i]
      if (vorher && !OHNE_HEIMAT.includes(vorher)) return sectionOf(vorher)
    }
  }
  return direkt(screen) ?? 'home'
}

interface Props {
  active: Screen
  history?: readonly Screen[]
  onChange: (screen: Screen) => void
}

export function NavBar({ active, history = [], onChange }: Props) {
  const section = sectionOf(active, history)
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

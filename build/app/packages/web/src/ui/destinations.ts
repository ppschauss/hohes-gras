import type { Screen } from '../store'
import type { IconName } from './Icon'

export interface Destination {
  screen: Screen
  icon: IconName
  labelKey: string
  feature: string
}

/**
 * Alle Ziele des Spiels, an einem Ort.
 *
 * Zwei Navigationen nutzen dieselbe Liste: das Raster auf dem Telefon und die
 * Seitenleiste am Rechner. Zwei Kopien hiessen zwei Wahrheiten — die eine
 * bekommt einen neuen Bereich, die andere nicht.
 */
export const DESTINATIONS: Destination[] = [
  { screen: 'garden', icon: 'garden', labelKey: 'menu.garden.title', feature: 'garden' },
  { screen: 'map', icon: 'map', labelKey: 'menu.map.title', feature: 'worldmap' },
  { screen: 'teams', icon: 'team', labelKey: 'menu.teams.title', feature: 'teams' },
  { screen: 'plots', icon: 'plots', labelKey: 'menu.plots.title', feature: 'plots' },
  { screen: 'expeditions', icon: 'expedition', labelKey: 'menu.expeditions.title', feature: 'safari' },
  { screen: 'eggs', icon: 'egg', labelKey: 'menu.eggs.title', feature: 'safari' },
  { screen: 'arena', icon: 'spark', labelKey: 'menu.arena.title', feature: 'battle' },
  { screen: 'gauntlet', icon: 'trophy', labelKey: 'menu.gauntlet.title', feature: 'battle' },
  { screen: 'center', icon: 'center', labelKey: 'menu.center.title', feature: 'center' },
  { screen: 'shop', icon: 'shop', labelKey: 'menu.shop.title', feature: 'shop' },
  { screen: 'bag', icon: 'bag', labelKey: 'menu.bag.title', feature: 'shop' },
  { screen: 'coop', icon: 'guild', labelKey: 'menu.coop.title', feature: 'guilds' },
  { screen: 'progress', icon: 'progress', labelKey: 'menu.progress.title', feature: 'story' },
  { screen: 'base', icon: 'lab', labelKey: 'menu.base.title', feature: 'story' },
  { screen: 'records', icon: 'trophy', labelKey: 'menu.records.title', feature: 'story' },
  { screen: 'friends', icon: 'friends', labelKey: 'menu.friends.title', feature: 'social' },
  { screen: 'energy', icon: 'energy', labelKey: 'menu.energy.title', feature: 'energy' },
  { screen: 'themes', icon: 'spark', labelKey: 'menu.themes.title', feature: 'themes' },
]

/**
 * Wie die Ziele in der Seitenleiste gruppiert sind.
 *
 * Auf dem Telefon ist die Reihenfolge egal — dreizehn Kacheln sind ein Feld,
 * das man ueberblickt. Untereinander gelesen braucht dieselbe Liste eine
 * Gliederung, sonst ist sie eine Aufzaehlung ohne Gefaelle.
 */
export const NAV_GROUPS: Array<{ labelKey: string; screens: Screen[] }> = [
  { labelKey: 'nav.group.play', screens: ['garden', 'map', 'plots', 'expeditions'] },
  { labelKey: 'nav.group.team', screens: ['teams', 'arena', 'gauntlet', 'center', 'eggs'] },
  { labelKey: 'nav.group.build', screens: ['base', 'shop', 'bag'] },
  { labelKey: 'nav.group.world', screens: ['friends', 'coop'] },
  { labelKey: 'nav.group.you', screens: ['progress', 'records', 'energy', 'themes'] },
]

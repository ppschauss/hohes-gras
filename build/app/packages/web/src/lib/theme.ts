import { create } from 'zustand'
import {
  DEFAULT_THEME, findTheme, paletteOf, resolveMode,
  type ThemeMode, type ThemeSetting,
} from '@game/engine'

/**
 * Das getragene Design auf die Seite schreiben.
 *
 * Die Palette landet als CSS-Variablen auf `:root` und überschreibt damit die
 * Grundwerte aus `styles.css`. Nichts anderes muss davon wissen: jede Regel im
 * Stylesheet liest ohnehin nur Variablen.
 */
interface ThemeStore {
  themeId: string
  setting: ThemeSetting
  mode: ThemeMode
  apply: (themeId: string, setting: ThemeSetting, timeOfDay: string) => void
}

export const useTheme = create<ThemeStore>((set) => ({
  themeId: DEFAULT_THEME.id,
  setting: 'auto',
  mode: 'night',
  apply: (themeId, setting, timeOfDay) => {
    const theme = findTheme(themeId) ?? DEFAULT_THEME
    const mode = resolveMode(setting, timeOfDay)
    const root = document.documentElement

    for (const [name, value] of Object.entries(paletteOf(theme, mode))) {
      root.style.setProperty(name, value)
    }
    // Für die wenigen Stellen, an denen CSS selbst wissen muss, ob es hell
    // oder dunkel ist — Bildkulissen, Umschläge, `color-scheme`.
    root.dataset.mode = mode
    root.dataset.theme = theme.id
    root.style.colorScheme = mode === 'day' ? 'light' : 'dark'

    set({ themeId: theme.id, setting, mode })
  },
}))

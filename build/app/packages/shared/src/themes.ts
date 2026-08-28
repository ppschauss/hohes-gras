import { z } from 'zod'

/**
 * Designs, wie der Client sie sieht.
 *
 * Die Palette rechnet der Server nicht aus — das macht der Client aus den
 * Parametern, weil er sie ohnehin bei jedem Moduswechsel neu braucht. Über die
 * Leitung geht nur, was der Server weiß: was es gibt, was es kostet, was dir
 * gehört.
 */
export const ThemeViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  group: z.enum(['basis', 'typ', 'region', 'anime']),
  price: z.number().int().min(0),
  owned: z.boolean(),
  active: z.boolean(),
  /** Zwei Farbwerte für die Vorschau, im gerade gültigen Modus. */
  preview: z.object({ ground: z.string(), accent: z.string(), spot: z.string() }),
})
export type ThemeView = z.infer<typeof ThemeViewSchema>

export const ThemesStateSchema = z.object({
  themes: z.array(ThemeViewSchema),
  gold: z.number().int().min(0),
  activeId: z.string(),
  mode: z.enum(['auto', 'day', 'night']),
  /** Was 'auto' gerade bedeutet — für die Beschriftung im UI. */
  resolvedMode: z.enum(['day', 'night']),
})
export type ThemesState = z.infer<typeof ThemesStateSchema>

export const BuyThemeRequestSchema = z.object({ themeId: z.string() })
export const SetThemeRequestSchema = z.object({ themeId: z.string() })
export const SetThemeModeRequestSchema = z.object({ mode: z.enum(['auto', 'day', 'night']) })

/** Thin, typed wrapper over the Telegram WebApp bridge.
 *
 *  Everything the app needs from Telegram goes through here, so running in a
 *  plain browser during development is a matter of one `isAvailable` check
 *  rather than optional chaining scattered through the components. */

interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
  header_bg_color?: string
}

interface TelegramWebApp {
  initData: string
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } }
  version: string
  platform: string
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  viewportStableHeight: number
  isExpanded: boolean
  ready: () => void
  expand: () => void
  close: () => void
  disableVerticalSwipes?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  onEvent: (event: string, handler: () => void) => void
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
    selectionChanged: () => void
  }
}

declare global {
  interface Window { Telegram?: { WebApp?: TelegramWebApp } }
}

const webApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp

export const isAvailable = (): boolean => Boolean(webApp()?.initData !== undefined)

export const initData = (): string => webApp()?.initData ?? ''

export const platform = (): string => webApp()?.platform ?? 'browser'

export const colorScheme = (): 'light' | 'dark' => webApp()?.colorScheme ?? 'dark'

/** Copy Telegram's palette into CSS custom properties so the app matches the
 *  surrounding client instead of fighting it. */
export function applyTheme(): void {
  const app = webApp()
  const root = document.documentElement
  root.dataset.theme = app?.colorScheme ?? 'dark'
  if (!app) return
  const map: Record<keyof TelegramThemeParams, string> = {
    bg_color: '--tg-bg',
    text_color: '--tg-text',
    hint_color: '--tg-hint',
    link_color: '--tg-link',
    button_color: '--tg-button',
    button_text_color: '--tg-button-text',
    secondary_bg_color: '--tg-secondary-bg',
    header_bg_color: '--tg-header-bg',
  }
  for (const [key, cssVar] of Object.entries(map)) {
    const value = app.themeParams[key as keyof TelegramThemeParams]
    if (value) root.style.setProperty(cssVar, value)
  }
}

/**
 * Pin the app height to Telegram's stable viewport.
 *
 * `100dvh` cannot be trusted inside the Telegram client: the value changes
 * while the Mini App expands and while the on-screen keyboard opens, which
 * pushes the bottom navigation out of sight. `viewportStableHeight` is the
 * height that excludes those transient states, and it is the only reliable
 * number to lay out against. Outside Telegram we fall back to `100dvh`.
 */
function applyViewportHeight(): void {
  const app = webApp()
  const root = document.documentElement
  const stable = app?.viewportStableHeight
  root.style.setProperty('--app-h', stable && stable > 0 ? `${stable}px` : '100dvh')
}

export function ready(): void {
  const app = webApp()
  if (!app) {
    applyViewportHeight()
    return
  }
  app.ready()
  app.expand()
  // Without this, a downward drag inside the game closes the Mini App — which
  // is exactly what happens when someone scrolls a long list.
  app.disableVerticalSwipes?.()
  applyTheme()
  applyViewportHeight()
  app.onEvent('themeChanged', applyTheme)
  app.onEvent('viewportChanged', applyViewportHeight)
}

export const haptic = {
  tap: () => webApp()?.HapticFeedback?.impactOccurred('light'),
  success: () => webApp()?.HapticFeedback?.notificationOccurred('success'),
  error: () => webApp()?.HapticFeedback?.notificationOccurred('error'),
  select: () => webApp()?.HapticFeedback?.selectionChanged(),
}

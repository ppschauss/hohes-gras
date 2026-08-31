import { create } from 'zustand'
import type { Bootstrap, Trainer } from '@game/shared'
import { api, ApiFailure, hasToken, setToken } from './lib/api'
import { initData, isAvailable } from './lib/telegram'
import { setLocale } from './i18n'
import { useEnergy } from './lib/energyStore'
import { useTheme } from './lib/theme'

/**
 * Alle Bildschirme des Spiels.
 *
 * Frueher lag darueber noch eine Ebene aus fuenf Reitern, von denen vier leer
 * waren. Die ist weg: was uebrig bleibt, ist das Spiel, und die Navigation
 * zeigt direkt auf seine Bereiche.
 */
export const SCREENS = [
  'home', 'garden', 'box', 'teams', 'dex', 'shop', 'map', 'area', 'safari',
  'battle', 'expeditions', 'eggs', 'friends', 'coop', 'progress', 'energy', 'center', 'plots', 'themes',
  'arena', 'gauntlet',
  'bag',
  // Basis (Ausbau, Labor, Werkstatt) und Erfolge (Erfolge, Saison, Rangliste):
  // beides stand vorher als Reiter im Fortschritt und ging dort unter.
  'base', 'records', 'changelog',
] as const
export type Screen = (typeof SCREENS)[number]

const isScreen = (value: string): value is Screen => (SCREENS as readonly string[]).includes(value)

/**
 * Bildschirm aus dem URL-Fragment.
 *
 * Telegram kann die Mini-App an einer bestimmten Stelle oeffnen
 * (`?startapp=garden`), und eine Erinnerung "dein Team hat Hunger" ist nur
 * dann etwas wert, wenn ein Tipp darauf im Garten landet statt im Menue.
 */
export function screenFromLocation(): Screen {
  const raw = window.location.hash.replace(/^#/, '')
  return isScreen(raw) ? raw : 'home'
}

export type AuthPhase =
  | { status: 'booting' }
  | { status: 'needs_link'; message: string | null }
  | { status: 'ready' }
  | { status: 'failed'; code: string; detail: Record<string, unknown> }

interface GameState {
  auth: AuthPhase
  boot: Bootstrap | null
  screen: Screen
  /**
   * Woher man kam.
   *
   * Vorher trug jeder Bildschirm sein Zurück fest im Router: die Box führte
   * immer zu den Teams, die Expeditionen immer zur Karte — auch wenn man sie
   * vom Startbildschirm aus geöffnet hatte. Zurück landete dann irgendwo, wo
   * man nie war. Der Stapel merkt sich stattdessen den Weg.
   */
  history: Screen[]
  submitting: boolean

  start: () => Promise<void>
  refresh: () => Promise<void>
  setScreen: (screen: Screen) => void
  /** Einen Schritt zurück — oder zum Start, wenn der Stapel leer ist. */
  goBack: () => void
  submitLinkCode: (code: string) => Promise<void>
  signOut: () => void
  syncScreenFromLocation: () => void
}

/** Central store. Deliberately small: server state lives on the server, and the
 *  client keeps only what the shell needs to decide what to render. Feature
 *  slices fetch their own data when their tab opens. */
export const useGame = create<GameState>((set, get) => ({
  auth: { status: 'booting' },
  boot: null,
  screen: screenFromLocation(),
  history: [],
  submitting: false,

  async start() {
    // Im Browser gibt es kein initData. Ein gespeicherter Token aus einem
    // frueheren Besuch zaehlt trotzdem — sonst waere jeder Aufruf eine neue
    // Anmeldung.
    if (!isAvailable()) {
      if (hasToken()) {
        try {
          const boot = await api.state()
          applyTrainer(set, boot)
          return
        } catch {
          setToken(null)
        }
      }
      set({ auth: { status: 'needs_link', message: null } })
      return
    }
    // A session from a previous open is still good; skip the round trip.
    if (hasToken()) {
      try {
        const boot = await api.state()
        applyTrainer(set, boot)
        return
      } catch {
        setToken(null)
      }
    }
    await authenticate(set, get)
  },

  async refresh() {
    try {
      const boot = await api.state()
      applyTrainer(set, boot)
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) await get().start()
    }
  },

  setScreen: (screen) => {
    const current = get().screen
    if (current === screen) return
    writeHash(screen)
    set({
      screen,
      // Der Start ist der Boden: von dort führt Zurück aus der App heraus,
      // nicht in einen Kreis. Mehr als zehn Schritte merkt sich niemand.
      history: screen === 'home' ? [] : [...get().history, current].slice(-10),
    })
  },

  goBack: () => {
    const stack = [...get().history]
    const previous = stack.pop() ?? 'home'
    writeHash(previous)
    set({ screen: previous, history: stack })
  },

  async submitLinkCode(code) {
    set({ submitting: true })
    try {
      const res = await api.redeemLink(code)
      // Im Browser dauerhaft ablegen: es gibt keine zweite Quelle, aus der
      // sich die Anmeldung nachholen liesse.
      setToken(res.token, true)
      const boot = await api.state()
      applyTrainer(set, boot)
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : 'network'
      set({ auth: { status: 'needs_link', message: code } })
    } finally {
      set({ submitting: false })
    }
  },

  signOut() {
    setToken(null)
    set({ auth: { status: 'needs_link', message: null }, boot: null })
  },

  syncScreenFromLocation: () => set({ screen: screenFromLocation(), history: [] }),
}))

function writeHash(screen: Screen): void {
  const hash = screen === 'home' ? '' : `#${screen}`
  if (window.location.hash !== hash) {
    window.history.replaceState(null, '', hash || window.location.pathname)
  }
}

type Setter = (partial: Partial<GameState>) => void

async function authenticate(set: Setter, get: () => GameState): Promise<void> {
  try {
    const res = await api.authenticate(initData())
    setToken(res.token)
    const boot = await api.state()
    applyTrainer(set, boot)
  } catch (err) {
    if (err instanceof ApiFailure) {
      set({ auth: { status: 'failed', code: err.code, detail: err.detail } })
      return
    }
    set({ auth: { status: 'failed', code: 'network', detail: {} } })
  }
}

function applyTrainer(set: Setter, boot: Bootstrap): void {
  setLocale(boot.trainer.locale)
  // Gold steht im Startzustand; ohne diese Zeile bliebe die Kopfzeile leer,
  // bis zufaellig eine Antwort mit Goldstand kommt.
  useEnergy.getState().setGold(boot.trainer.gold)
  // Design und Modus haengen am Trainer und an der Weltuhr: beides kommt mit
  // dem Startzustand, also wird hier angewandt und nicht in einem Bildschirm.
  useTheme.getState().apply(boot.trainer.themeId, boot.trainer.themeMode, boot.clock.timeOfDay)
  set({ boot, auth: { status: 'ready' } })
}

export const selectTrainer = (s: GameState): Trainer | null => s.boot?.trainer ?? null

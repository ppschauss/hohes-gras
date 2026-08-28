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
  | { status: 'needs_invite'; message: string | null }
  | { status: 'ready' }
  | { status: 'failed'; code: string; detail: Record<string, unknown> }

interface GameState {
  auth: AuthPhase
  boot: Bootstrap | null
  screen: Screen
  submitting: boolean

  start: () => Promise<void>
  submitInvite: (code: string) => Promise<void>
  refresh: () => Promise<void>
  setScreen: (screen: Screen) => void
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

  async submitInvite(code) {
    set({ submitting: true })
    try {
      const res = await api.authenticate(initData(), code.trim().toUpperCase())
      setToken(res.token)
      const boot = await api.state()
      applyTrainer(set, boot)
    } catch (err) {
      set({ auth: inviteErrorPhase(err) })
    } finally {
      set({ submitting: false })
    }
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
    const hash = screen === 'home' ? '' : `#${screen}`
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash || window.location.pathname)
    }
    set({ screen })
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

  syncScreenFromLocation: () => set({ screen: screenFromLocation() }),
}))

type Setter = (partial: Partial<GameState>) => void

async function authenticate(set: Setter, get: () => GameState): Promise<void> {
  try {
    const res = await api.authenticate(initData())
    setToken(res.token)
    const boot = await api.state()
    applyTrainer(set, boot)
  } catch (err) {
    if (err instanceof ApiFailure && (err.code === 'invite_required' || err.code === 'invite_invalid')) {
      set({ auth: inviteErrorPhase(err) })
      return
    }
    if (err instanceof ApiFailure) {
      set({ auth: { status: 'failed', code: err.code, detail: err.detail } })
      return
    }
    set({ auth: { status: 'failed', code: 'network', detail: {} } })
  }
}

function inviteErrorPhase(err: unknown): AuthPhase {
  if (err instanceof ApiFailure) {
    if (err.code === 'invite_required') return { status: 'needs_invite', message: null }
    if (err.code === 'invite_invalid') {
      const reason = String(err.detail.reason ?? 'unknown')
      return { status: 'needs_invite', message: `auth.invalid.${reason}` }
    }
    if (err.code === 'banned') return { status: 'failed', code: 'banned', detail: {} }
    return { status: 'failed', code: err.code, detail: err.detail }
  }
  return { status: 'failed', code: 'network', detail: {} }
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

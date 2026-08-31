import { describe, expect, it } from 'vitest'
import {
  CARE_PACING, CARE_WINDOW_LIMIT, CARE_WINDOW_MS, DUEL_PACING, EXPLORE_PACING, MIN_GAP_MS,
  RHYTHM_PENALTY_MS, RHYTHM_SAMPLES, checkPacing, looksAutomated,
} from './pacing.js'

const T0 = 1_700_000_000_000

/**
 * Zeitpunkte mit vorgegebenen Abstaenden, optional mit Streuung.
 *
 * Die Streuung kommt aus einem festen Kongruenzgenerator: sie muss zufaellig
 * *aussehen*, aber bei jedem Lauf gleich sein — sonst prueft der Test mal die
 * eine und mal die andere Zahlenfolge.
 */
function series(count: number, gap: number, jitter = 0, seedStart = T0): number[] {
  let seed = 987_654_321
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
    return seed / 2_147_483_648
  }
  const out: number[] = []
  let at = seedStart
  for (let i = 0; i < count; i++) {
    at += gap + (jitter === 0 ? 0 : Math.round((rand() * 2 - 1) * jitter))
    out.push(at)
  }
  return out
}

describe('checkPacing — Fenster', () => {
  it('laesst 99 Aktionen durch und lehnt die hundertunderste ab', () => {
    // Mit Streuung, sonst schlaegt die Rhythmuspruefung zu — was sie soll.
    const history = series(CARE_WINDOW_LIMIT - 1, 1_000, 300)
    const now = history[history.length - 1]! + 1_000
    expect(checkPacing(history, now, CARE_PACING).ok).toBe(true)

    const full = series(CARE_WINDOW_LIMIT, 1_000, 300)
    const after = full[full.length - 1]! + 1_000
    const verdict = checkPacing(full, after, CARE_PACING)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('window')
  })

  it('nennt, wann wieder ein Platz frei wird', () => {
    const full = series(CARE_WINDOW_LIMIT, 1_000, 300)
    const now = full[full.length - 1]! + 1_000
    const verdict = checkPacing(full, now, CARE_PACING)
    if (verdict.ok || verdict.reason !== 'window') throw new Error('Fenster erwartet')
    // Der aelteste zaehlende Eintrag faellt nach 15 Minuten heraus.
    expect(verdict.retryAfterMs).toBe(full[0]! + CARE_WINDOW_MS - now)
    expect(verdict.limit).toBe(CARE_WINDOW_LIMIT)
  })

  it('vergisst alles ausserhalb des Fensters', () => {
    const old = series(CARE_WINDOW_LIMIT, 1_000, 300)
    const now = old[old.length - 1]! + CARE_WINDOW_MS + 1
    expect(checkPacing(old, now, CARE_PACING).ok).toBe(true)
  })

  it('kennt beim Erkunden kein Fenster', () => {
    const many = series(500, 1_000, 300)
    const now = many[many.length - 1]! + 1_000
    expect(checkPacing(many, now, EXPLORE_PACING).ok).toBe(true)
  })
})

describe('checkPacing — Mindestabstand', () => {
  it('lehnt zwei Klicks unterhalb des Mindestabstands ab', () => {
    const verdict = checkPacing([T0], T0 + MIN_GAP_MS - 1, CARE_PACING)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('too_fast')
    expect(verdict.retryAfterMs).toBe(1)
  })

  it('laesst genau den Mindestabstand zu', () => {
    expect(checkPacing([T0], T0 + MIN_GAP_MS, CARE_PACING).ok).toBe(true)
  })

  it('bleibt bei leerer Vorgeschichte offen', () => {
    expect(checkPacing([], T0, CARE_PACING).ok).toBe(true)
  })
})

describe('Duelle: Abstand trennt Hand von Automat', () => {
  /*
   * Der Abstand lag zuerst bei anderthalb Sekunden. Gemessen im Betrieb
   * standen beide Vielspieler staendig an dieser Wand — ihr kleinster
   * *erfolgreicher* Abstand war 1.530 und 1.791 ms — und lasen "Immer mit der
   * Ruhe", obwohl sie von Hand spielten. Genau so wurde es gemeldet.
   */
  it('laesst eine schnelle Hand durch', () => {
    // Zwei Duelle in siebenhundert Millisekunden: zackig, aber menschlich.
    expect(checkPacing([T0], T0 + 700, DUEL_PACING, 0).ok).toBe(true)
  })

  it('haelt das auf, was den Riegel noetig machte', () => {
    // Gemessen waren es acht Duelle je Sekunde, Median 92 ms.
    const urteil = checkPacing([T0], T0 + 92, DUEL_PACING, 0)
    expect(urteil.ok).toBe(false)
    expect(urteil.ok === false && urteil.reason).toBe('too_fast')
  })

  it('deckelt die Menge weiter ueber das Fenster, nicht ueber den Abstand', () => {
    // Dreissig in einer Viertelstunde bleiben dreissig, egal wie zackig.
    const viele = Array.from({ length: DUEL_PACING.limit! }, (_, i) => T0 + i * 700)
    const urteil = checkPacing(viele, T0 + DUEL_PACING.limit! * 700 + 5_000, DUEL_PACING, 0)
    expect(urteil.ok).toBe(false)
    expect(urteil.ok === false && urteil.reason).toBe('window')
  })
})

describe('looksAutomated', () => {
  it('erkennt einen metronomischen Takt', () => {
    expect(looksAutomated(series(RHYTHM_SAMPLES + 1, 400))).toBe(true)
  })

  it('haelt menschliches Tippen mit Streuung fuer echt', () => {
    // ±120 ms Schwankung — das untere Ende dessen, was eine Hand produziert.
    expect(looksAutomated(series(RHYTHM_SAMPLES + 1, 400, 120))).toBe(false)
  })

  it('braucht genug Datenpunkte, bevor es urteilt', () => {
    expect(looksAutomated(series(RHYTHM_SAMPLES, 400))).toBe(false)
  })

  it('laesst gleichmaessiges, aber langsames Spiel in Ruhe', () => {
    // Alle zehn Sekunden exakt: kein Skript-Verdacht, weil kein Vorteil.
    expect(looksAutomated(series(20, 10_000))).toBe(false)
  })
})

describe('checkPacing — Rhythmus', () => {
  it('bremst eine maschinelle Folge mit Zwangspause', () => {
    const history = series(RHYTHM_SAMPLES + 1, 400)
    const now = history[history.length - 1]! + 400
    const verdict = checkPacing(history, now, CARE_PACING)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('rhythm')
    expect(verdict.retryAfterMs).toBe(RHYTHM_PENALTY_MS)
  })

  it('greift auch beim Erkunden, wo es kein Fenster gibt', () => {
    const history = series(RHYTHM_SAMPLES + 1, 500)
    const now = history[history.length - 1]! + 500
    const verdict = checkPacing(history, now, EXPLORE_PACING)
    expect(verdict.ok).toBe(false)
  })

  it('laesst denselben Spieler nach etwas Unregelmaessigkeit weitermachen', () => {
    const history = series(RHYTHM_SAMPLES + 1, 400, 150)
    const now = history[history.length - 1]! + 700
    expect(checkPacing(history, now, CARE_PACING).ok).toBe(true)
  })

  it('haelt schnelles Tippen einer echten Hand fuer echt', () => {
    // Gemessen an einem echten Spieler, der so schnell getippt hat, wie es
    // geht: 218 ms Mittel, 33,5 ms Streuung. Die alte Schwelle von 35 ms hat
    // ihn als Skript eingestuft und fuer eine Viertelstunde gesperrt.
    const gaps = [294, 202, 228, 238, 208, 182, 199, 192, 245, 211, 226, 197]
    const history = [T0]
    for (const g of gaps) history.push(history[history.length - 1]! + g)
    expect(looksAutomated(history)).toBe(false)
    expect(checkPacing(history, history[history.length - 1]! + 210, CARE_PACING).ok).toBe(true)
  })

  it('laesst eine abgegoltene Serie nicht ein zweites Mal ausloesen', () => {
    // Der Kern des Fehlers: ein abgewiesener Versuch wird nicht mitgeschrieben.
    // Ohne diese Abgrenzung sieht die Probe nach der Pause dieselben Abstaende
    // und weist wieder ab — dreissig angekuendigte Sekunden wurden so zu einer
    // Viertelstunde.
    const history = series(RHYTHM_SAMPLES + 1, 400)
    const caughtAt = history[history.length - 1]! + 400
    expect(checkPacing(history, caughtAt, CARE_PACING).ok).toBe(false)

    const penaltyEnd = caughtAt + RHYTHM_PENALTY_MS
    expect(checkPacing(history, penaltyEnd + 1, CARE_PACING, penaltyEnd).ok).toBe(true)
  })

  it('faengt eine Maschine nach der Pause wieder ein', () => {
    // Abgegolten heisst nicht begnadigt: wer weitermacht wie vorher, sammelt
    // neue Abstaende und faellt erneut auf.
    const first = series(RHYTHM_SAMPLES + 1, 400)
    const penaltyEnd = first[first.length - 1]! + 400 + RHYTHM_PENALTY_MS
    const after = series(RHYTHM_SAMPLES + 1, 400, 0, penaltyEnd + 400)
    const history = [...first, ...after]
    const now = after[after.length - 1]! + 400
    const verdict = checkPacing(history, now, CARE_PACING, penaltyEnd)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('rhythm')
  })
})

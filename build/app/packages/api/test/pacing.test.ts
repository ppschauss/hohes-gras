import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CARE_WINDOW_LIMIT, MIN_GAP_MS } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  // Energie ist hier nicht die Schranke, die geprueft wird.
  h.ctx.db.prepare('UPDATE trainers SET energy = 9000 WHERE id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })

/** Vergangene Aktionen einspielen, statt sie in Echtzeit zu klicken. */
function seedPulse(bucket: string, gaps: number[], endingAt = Date.now() - 2_000): void {
  const stmt = h.ctx.db.prepare('INSERT INTO action_pulse (trainer_id, bucket, at) VALUES (?, ?, ?)')
  let at = endingAt
  for (const gap of [...gaps].reverse()) { stmt.run(trainerId, bucket, at); at -= gap }
}

const pulseCount = (bucket: string): number =>
  (h.ctx.db.prepare('SELECT COUNT(*) n FROM action_pulse WHERE trainer_id = ? AND bucket = ?')
    .get(trainerId, bucket) as { n: number }).n

const care = () => h.post('/api/garden/care', { action: 'rest' }, token)
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Taktkontrolle bei der Pflege', () => {
  it('laesst normales Spiel durch und protokolliert jeden Takt', async () => {
    // Echte Pausen dazwischen: der Test ist sonst selbst die Maschine, gegen
    // die hier geschuetzt wird.
    for (let i = 0; i < 5; i++) {
      h.resetRateLimits()
      expect((await care()).status).toBe(200)
      await wait(230)
    }
    expect(pulseCount('care')).toBe(5)
  })

  it('weist einen Doppeltipp ab, ohne die Zaehlung zu verfaelschen', async () => {
    h.resetRateLimits()
    expect((await care()).status).toBe(200)
    h.resetRateLimits()
    // Sofort hinterher: schneller als eine Hand.
    expect((await care()).status).toBe(429)
    expect(pulseCount('care')).toBe(1)
  })

  it('deckelt bei 100 Aktionen in 15 Minuten', async () => {
    // 99 unregelmaessige Aktionen in der Vergangenheit: die hundertste geht
    // noch, die hundertunderste nicht.
    seedPulse('care', Array.from({ length: 99 }, (_, i) => 2_000 + (i % 7) * 130))
    h.resetRateLimits()
    expect((await care()).status).toBe(200)

    h.resetRateLimits()
    const over = await care()
    expect(over.status).toBe(429)
    expect(over.body.error).toBe('rate_limited')
    expect(over.body.detail.reason).toBe('window')
    expect(over.body.detail.limit).toBe(CARE_WINDOW_LIMIT)
    expect(over.body.detail.retryAfter).toBeGreaterThan(0)
  })

  it('vergisst Aktionen, die aelter als das Fenster sind', async () => {
    seedPulse('care', Array.from({ length: 120 }, (_, i) => 2_000 + (i % 5) * 90),
      Date.now() - 16 * 60_000)
    h.resetRateLimits()
    expect((await care()).status).toBe(200)
  })

  it('weist zwei Klicks unterhalb des Mindestabstands ab', async () => {
    seedPulse('care', [1_000], Date.now() - Math.floor(MIN_GAP_MS / 3))
    h.resetRateLimits()
    const r = await care()
    expect(r.status).toBe(429)
    expect(r.body.detail.reason).toBe('too_fast')
  })

  it('erkennt einen maschinellen Takt und verhaengt eine Pause', async () => {
    // Exakt gleiche Abstaende — kein Mensch klickt so.
    seedPulse('care', Array(14).fill(400))
    h.resetRateLimits()
    const r = await care()
    expect(r.status).toBe(429)
    expect(r.body.detail.reason).toBe('rhythm')
    expect(r.body.detail.retryAfter).toBe(30)
  })

  it('haelt menschliches Tippen mit Streuung fuer echt', async () => {
    seedPulse('care', [420, 610, 380, 720, 455, 900, 340, 530, 660, 410])
    h.resetRateLimits()
    expect((await care()).status).toBe(200)
  })

  it('kostet ein abgewiesener Versuch weder Energie noch Beeren', async () => {
    const energyBefore = (await h.get('/api/energy', token)).body.state.current
    const bagBefore = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry')?.quantity ?? 0

    seedPulse('care', Array(14).fill(400))
    h.resetRateLimits()
    expect((await h.post('/api/garden/care', { action: 'feed' }, token)).status).toBe(429)

    expect((await h.get('/api/energy', token)).body.state.current).toBe(energyBefore)
    const bagAfter = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry')?.quantity ?? 0
    expect(bagAfter).toBe(bagBefore)
    // Der abgewiesene Versuch belegt auch keinen Platz im Fenster.
    expect(pulseCount('care')).toBe(14)
  })

  it('haelt die Eimer von Pflege und Erkundung auseinander', async () => {
    seedPulse('care', Array.from({ length: 120 }, () => 2_000 + Math.floor(Math.random() * 300)))
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    // Pflege ist dicht, Erkunden nicht.
    expect((await care()).status).toBe(429)
    h.resetRateLimits()
    expect((await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)).status).toBe(200)
  })

  it('bremst auch beim Erkunden einen maschinellen Takt', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    seedPulse('explore', Array(14).fill(350))
    h.resetRateLimits()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(429)
    expect(r.body.detail.reason).toBe('rhythm')
  })

  it('meldet nach der Zwangspause die verbleibende Zeit, nicht wieder dreissig Sekunden', async () => {
    // Der Fehler, den ein Mitspieler gemeldet hat: angekuendigt waren dreissig
    // Sekunden, gedauert hat es Minuten. Ursache war, dass ein abgewiesener
    // Versuch nicht mitgeschrieben wird — dieselben Abstaende loesten dieselbe
    // Pause immer wieder aus, bis sie aus dem Viertelstundenfenster fielen.
    seedPulse('care', Array(14).fill(400))
    h.resetRateLimits()
    const first = await care()
    expect(first.status).toBe(429)
    expect(first.body.detail.retryAfter).toBe(30)

    // Die Pause ist gespeichert und ueberlebt den abgebrochenen Vorgang.
    const row = h.ctx.db
      .prepare('SELECT until FROM pacing_penalties WHERE trainer_id = ? AND bucket = ?')
      .get(trainerId, 'care') as { until: number } | undefined
    expect(row).toBeTruthy()

    // Ein zweiter Versuch bekommt weniger Zeit genannt, nicht wieder dreissig.
    h.resetRateLimits()
    const second = await care()
    expect(second.status).toBe(429)
    expect(second.body.detail.retryAfter).toBeLessThanOrEqual(30)

    // Und nach Ablauf geht es weiter — ohne dass eine Viertelstunde vergeht.
    h.ctx.db.prepare('UPDATE pacing_penalties SET until = ? WHERE trainer_id = ?')
      .run(Date.now() - 1, trainerId)
    h.resetRateLimits()
    expect((await care()).status).toBe(200)
  })

  it('protokolliert das Muster, statt es im Rollback zu verlieren', async () => {
    // Das Protokoll ist die einzige Moeglichkeit, die Schwelle spaeter zu
    // ueberpruefen. Innerhalb der Transaktion nahm der Rollback es mit — der
    // Eintrag fehlte deshalb ausgerechnet in jedem echten Fall.
    seedPulse('care', Array(14).fill(400))
    h.resetRateLimits()
    expect((await care()).status).toBe(429)

    const n = h.ctx.db
      .prepare("SELECT COUNT(*) n FROM event_log WHERE trainer_id = ? AND kind = 'pacing.rhythm'")
      .get(trainerId) as { n: number }
    expect(n.n).toBe(1)
  })

  it('haelt schnelles Tippen einer echten Hand fuer echt', async () => {
    // Abstaende eines echten Spielers, so schnell getippt, wie es geht.
    seedPulse('care', [294, 202, 228, 238, 208, 182, 199, 192, 245, 211, 226, 197])
    h.resetRateLimits()
    expect((await care()).status).toBe(200)
  })

  it('kennt beim Erkunden aber kein Mengenlimit', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    seedPulse('explore', Array.from({ length: 300 }, (_, i) => 1_000 + (i % 9) * 120))
    h.resetRateLimits()
    expect((await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)).status).toBe(200)
  })
})

describe('Pflegestation', () => {
  const build = (level: number) => {
    for (let i = 0; i < level; i++) {
      h.ctx.db.prepare(
        `INSERT INTO buildings (trainer_id, building_id, level, built_at)
         VALUES (?, 'care-station', ?, ?)
         ON CONFLICT(trainer_id, building_id) DO UPDATE SET level = excluded.level`,
      ).run(trainerId, i + 1, Date.now())
    }
  }

  it('hebt das Fenster um fuenfzig je Stufe', async () => {
    // Ohne Ausbau ist bei hundert Schluss.
    // Unregelmaessige Abstaende: gleichmaessige waeren ein Skript, und dann
    // pruefte der Test die Rhythmusschranke statt der Mengenschranke.
    seedPulse('care', Array.from({ length: CARE_WINDOW_LIMIT }, (_, i) => 1_500 + (i % 13) * 140))
    h.resetRateLimits()
    const blocked = await care()
    expect(blocked.status).toBe(429)
    expect(blocked.body.detail.reason).toBe('window')
    expect(blocked.body.detail.limit).toBe(CARE_WINDOW_LIMIT)

    build(2)
    h.resetRateLimits()
    const after = await care()
    expect(after.status).toBe(200)
  })

  it('meldet die neue Grenze auch in der Ablehnung', async () => {
    build(1)
    seedPulse('care', Array.from({ length: CARE_WINDOW_LIMIT + 50 }, (_, i) => 1_500 + (i % 11) * 90))
    h.resetRateLimits()
    const r = await care()
    expect(r.status).toBe(429)
    expect(r.body.detail.limit).toBe(CARE_WINDOW_LIMIT + 50)
  })

  it('kauft keinen Freibrief fuer Automatik', async () => {
    // Die Station hebt die Menge, nicht den Takt: eine maschinelle Folge faellt
    // weiter auf.
    build(5)
    seedPulse('care', Array(14).fill(400))
    h.resetRateLimits()
    const r = await care()
    expect(r.status).toBe(429)
    expect(r.body.detail.reason).toBe('rhythm')
  })
})

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
    seedPulse('care', Array(10).fill(400))
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

    seedPulse('care', Array(10).fill(400))
    h.resetRateLimits()
    expect((await h.post('/api/garden/care', { action: 'feed' }, token)).status).toBe(429)

    expect((await h.get('/api/energy', token)).body.state.current).toBe(energyBefore)
    const bagAfter = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry')?.quantity ?? 0
    expect(bagAfter).toBe(bagBefore)
    // Der abgewiesene Versuch belegt auch keinen Platz im Fenster.
    expect(pulseCount('care')).toBe(10)
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
    seedPulse('explore', Array(10).fill(350))
    h.resetRateLimits()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(429)
    expect(r.body.detail.reason).toBe('rhythm')
  })

  it('kennt beim Erkunden aber kein Mengenlimit', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    seedPulse('explore', Array.from({ length: 300 }, (_, i) => 1_000 + (i % 9) * 120))
    h.resetRateLimits()
    expect((await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)).status).toBe(200)
  })
})

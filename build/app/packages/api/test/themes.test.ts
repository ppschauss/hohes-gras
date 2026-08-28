import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THEME, findTheme } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  h.ctx.db.prepare('UPDATE trainers SET gold = 200000 WHERE id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })

const themes = async () => (await h.get('/api/themes', token)).body
const find = (state: any, id: string) => state.themes.find((t: any) => t.id === id)

describe('Designs', () => {
  it('gibt jedem das Grunddesign, ohne dass es gekauft wurde', async () => {
    const d = await themes()
    const base = find(d, DEFAULT_THEME.id)
    expect(base.owned).toBe(true)
    expect(base.active).toBe(true)
    expect(base.price).toBe(0)
    expect(d.activeId).toBe(DEFAULT_THEME.id)
  })

  it('liefert zu jedem Design eine Vorschau aus drei Farben', async () => {
    const d = await themes()
    for (const theme of d.themes) {
      expect(theme.preview.ground).toMatch(/^oklch\(/)
      expect(theme.preview.accent).toMatch(/^oklch\(/)
      expect(theme.preview.spot).toMatch(/^oklch\(/)
    }
  })

  it('kauft ein Design, zieht Gold ab und traegt es sofort', async () => {
    const price = findTheme('flamme')!.price
    const before = (await h.get('/api/bag', token)).body.gold

    const r = await h.post('/api/themes/buy', { themeId: 'flamme' }, token)
    expect(r.status).toBe(200)
    expect(find(r.body, 'flamme').owned).toBe(true)
    expect(find(r.body, 'flamme').active).toBe(true)
    expect(r.body.activeId).toBe('flamme')
    expect((await h.get('/api/bag', token)).body.gold).toBe(before - price)
  })

  it('kauft dasselbe Design kein zweites Mal', async () => {
    await h.post('/api/themes/buy', { themeId: 'flamme' }, token)
    h.resetRateLimits()
    const again = await h.post('/api/themes/buy', { themeId: 'flamme' }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_owned')
  })

  it('weist einen Kauf ohne Gold ab', async () => {
    h.ctx.db.prepare('UPDATE trainers SET gold = 10 WHERE id = ?').run(trainerId)
    const r = await h.post('/api/themes/buy', { themeId: 'champion' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_funds')
  })

  it('weist ein unbekanntes Design ab', async () => {
    expect((await h.post('/api/themes/buy', { themeId: 'regenbogen' }, token)).status).toBe(404)
  })

  it('traegt nur, was einem gehoert', async () => {
    const r = await h.post('/api/themes/wear', { themeId: 'champion' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_owned')
  })

  it('wechselt zwischen gekauften Designs hin und her', async () => {
    await h.post('/api/themes/buy', { themeId: 'flamme' }, token)
    h.resetRateLimits()
    await h.post('/api/themes/buy', { themeId: 'welle' }, token)
    h.resetRateLimits()

    const back = await h.post('/api/themes/wear', { themeId: 'flamme' }, token)
    expect(back.body.activeId).toBe('flamme')
    // Das andere bleibt im Besitz.
    expect(find(back.body, 'welle').owned).toBe(true)
    expect(find(back.body, 'welle').active).toBe(false)
  })

  it('merkt sich Design und Modus im Startzustand', async () => {
    await h.post('/api/themes/buy', { themeId: 'sakura' }, token)
    h.resetRateLimits()
    await h.post('/api/themes/mode', { mode: 'night' }, token)

    const state = await h.get('/api/state', token)
    expect(state.body.trainer.themeId).toBe('sakura')
    expect(state.body.trainer.themeMode).toBe('night')
  })

  it('loest den automatischen Modus gegen die Weltuhr auf', async () => {
    const auto = await themes()
    expect(auto.mode).toBe('auto')
    expect(['day', 'night']).toContain(auto.resolvedMode)

    h.resetRateLimits()
    const fixed = await h.post('/api/themes/mode', { mode: 'day' }, token)
    expect(fixed.body.mode).toBe('day')
    expect(fixed.body.resolvedMode).toBe('day')
  })

  it('weist einen unbekannten Modus ab', async () => {
    expect((await h.post('/api/themes/mode', { mode: 'daemmerung' }, token)).status).toBe(400)
  })
})

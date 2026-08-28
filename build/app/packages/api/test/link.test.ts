import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
})
afterEach(async () => { await h.close() })

const newCode = async (): Promise<string> => {
  h.resetRateLimits()
  const r = await h.post('/api/auth/link/code', {}, token)
  expect(r.status).toBe(200)
  return r.body.code
}
const redeem = (code: string) => {
  h.resetRateLimits()
  return h.post('/api/auth/link/redeem', { code })
}

describe('Browser verbinden', () => {
  it('gibt einen lesbaren Code aus', async () => {
    const code = await newCode()
    // Vier plus vier, ohne verwechselbare Zeichen: der Code wird abgetippt.
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/)
    expect(code).not.toMatch(/[OI01]/)
  })

  it('tauscht den Code gegen eine gueltige Sitzung', async () => {
    const r = await redeem(await newCode())
    expect(r.status).toBe(200)
    expect(r.body.trainer.id).toBe(trainerId)

    // Und die Sitzung taugt wirklich fuer das Spiel, nicht nur fuer die Antwort.
    h.resetRateLimits()
    const state = await h.get('/api/state', r.body.token)
    expect(state.status).toBe(200)
    expect(state.body.trainer.id).toBe(trainerId)
  })

  it('nimmt ihn auch klein geschrieben und ohne Bindestrich an', async () => {
    const code = await newCode()
    const r = await redeem(code.toLowerCase().replace('-', ''))
    expect(r.status).toBe(200)
  })

  it('laesst denselben Code kein zweites Mal gelten', async () => {
    const code = await newCode()
    expect((await redeem(code)).status).toBe(200)
    const again = await redeem(code)
    expect(again.status).toBe(400)
    expect(again.body.error).toBe('link_invalid')
  })

  it('entwertet den alten Code, sobald ein neuer ausgestellt wird', async () => {
    // Wer dreimal tippt, weil nichts zu passieren scheint, soll nicht drei
    // offene Tueren hinterlassen.
    const first = await newCode()
    await newCode()
    expect((await redeem(first)).status).toBe(400)
  })

  it('laesst einen abgelaufenen Code verfallen', async () => {
    const code = await newCode()
    h.ctx.db.prepare('UPDATE link_codes SET expires_at = ?').run(Date.now() - 1)
    expect((await redeem(code)).status).toBe(400)
  })

  it('weist Unsinn ab, ohne zu verraten warum', async () => {
    const r = await redeem('ZZZZ-ZZZZ')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('link_invalid')
    // Kein Hinweis, ob der Code unbekannt, abgelaufen oder verbraucht ist.
    expect(JSON.stringify(r.body.detail ?? {})).toBe('{}')
  })

  it('haelt einen gesperrten Trainer auch mit gueltigem Code drausen', async () => {
    const code = await newCode()
    h.ctx.db.prepare('UPDATE trainers SET is_banned = 1 WHERE id = ?').run(trainerId)
    expect((await redeem(code)).status).toBe(403)
  })

  it('gibt ohne Anmeldung keinen Code heraus', async () => {
    h.resetRateLimits()
    expect((await h.post('/api/auth/link/code', {})).status).toBe(401)
  })
})

describe('Verbundene Geraete', () => {
  it('zeigt die eigene Sitzung als aktuelle', async () => {
    const r = await h.get('/api/sessions', token)
    expect(r.status).toBe(200)
    expect(r.body.sessions).toHaveLength(1)
    expect(r.body.sessions[0].current).toBe(true)
    expect(r.body.sessions[0].kind).toBe('telegram')
  })

  it('fuehrt eine eingeloeste Browsersitzung mit auf', async () => {
    const redeemed = await redeem(await newCode())
    h.resetRateLimits()
    const r = await h.get('/api/sessions', token)
    expect(r.body.sessions).toHaveLength(2)
    const browser = r.body.sessions.find((s: any) => s.kind === 'browser')
    expect(browser).toBeTruthy()
    expect(browser.current).toBe(false)

    // Aus Sicht der Browsersitzung ist sie selbst die aktuelle.
    h.resetRateLimits()
    const fromBrowser = await h.get('/api/sessions', redeemed.body.token)
    expect(fromBrowser.body.sessions.find((s: any) => s.kind === 'browser').current).toBe(true)
  })

  it('sammelt nicht je App-Start eine neue Sitzung an', async () => {
    // Gemessener Zustand vor der Korrektur: 304 Sitzungen bei vier Geraeten.
    // Die Mini-App meldet sich bei jedem Oeffnen neu an; die alte Sitzung
    // blieb dabei liegen.
    for (let i = 0; i < 5; i++) {
      h.resetRateLimits()
      const again = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
      expect(again.status).toBe(200)
      token = again.body.token
    }
    h.resetRateLimits()
    const r = await h.get('/api/sessions', token)
    expect(r.body.sessions).toHaveLength(1)
    expect(r.body.sessions[0].current).toBe(true)
  })

  it('fasst dabei nur dasselbe Geraet zusammen', async () => {
    // Zwei Browsersitzungen sind zwei Geraete, auch wenn beide 'node' melden:
    // eine Zusammenfassung waere hier ein Rauswurf.
    await redeem(await newCode())
    await redeem(await newCode())
    h.resetRateLimits()
    const r = await h.get('/api/sessions', token)
    expect(r.body.sessions.filter((s: any) => s.kind === 'browser')).toHaveLength(2)
  })

  it('beendet eine Sitzung sofort und endgueltig', async () => {
    const redeemed = await redeem(await newCode())
    h.resetRateLimits()
    const before = await h.get('/api/sessions', token)
    const browserId = before.body.sessions.find((s: any) => s.kind === 'browser').id

    h.resetRateLimits()
    expect((await h.del(`/api/sessions/${browserId}`, token)).status).toBe(200)

    // Der Token der beendeten Sitzung ist ab sofort wertlos.
    h.resetRateLimits()
    expect((await h.get('/api/state', redeemed.body.token)).status).toBe(401)
  })

  it('laesst niemanden fremde Sitzungen abmelden', async () => {
    const other = await h.addTrainer(222, 'Gary')
    h.resetRateLimits()
    const mine = (await h.get('/api/sessions', token)).body.sessions[0].id

    h.resetRateLimits()
    const r = await h.del(`/api/sessions/${mine}`, other.token)
    expect(r.status).toBe(404)

    // Und meine Sitzung lebt noch.
    h.resetRateLimits()
    expect((await h.get('/api/state', token)).status).toBe(200)
  })

  it('meldet alle anderen ab und behaelt die eigene', async () => {
    const a = await redeem(await newCode())
    const b = await redeem(await newCode())

    h.resetRateLimits()
    const r = await h.post('/api/sessions/revoke-others', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.removed).toBe(2)
    expect(r.body.sessions).toHaveLength(1)

    h.resetRateLimits()
    expect((await h.get('/api/state', token)).status).toBe(200)
    h.resetRateLimits()
    expect((await h.get('/api/state', a.body.token)).status).toBe(401)
    h.resetRateLimits()
    expect((await h.get('/api/state', b.body.token)).status).toBe(401)
  })
})

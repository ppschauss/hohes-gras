import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInvite } from '../src/repos/invites.js'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp

beforeEach(async () => { h = await makeTestApp() })
afterEach(async () => { await h.close() })

const userA = { id: 111, first_name: 'Ash', username: 'ash', language_code: 'de' }
const userB = { id: 222, first_name: 'Misty', username: 'misty', language_code: 'de' }

describe('GET /api/health', () => {
  it('antwortet ohne Anmeldung', async () => {
    const r = await h.get('/api/health')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.species).toBe(h.ctx.registry.speciesCount)
  })
})

describe('POST /api/auth/session', () => {
  it('macht den allerersten Trainer zum Admin, ohne Einladung', async () => {
    const r = await h.post('/api/auth/session', { initData: signInitData(userA) })
    expect(r.status).toBe(200)
    expect(r.body.isNewTrainer).toBe(true)
    expect(r.body.trainer.isAdmin).toBe(true)
    expect(r.body.trainer.trainerCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(r.body.token).toBeTypeOf('string')
  })

  it('verlangt vom zweiten Trainer eine Einladung', async () => {
    await h.post('/api/auth/session', { initData: signInitData(userA) })
    const r = await h.post('/api/auth/session', { initData: signInitData(userB) })
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('invite_required')
  })

  it('laesst den zweiten Trainer mit gueltigem Code herein', async () => {
    await h.post('/api/auth/session', { initData: signInitData(userA) })
    const invite = createInvite(h.ctx.db, { createdBy: null, maxUses: 1 })
    const r = await h.post('/api/auth/session', { initData: signInitData(userB), inviteCode: invite.code })
    expect(r.status).toBe(200)
    expect(r.body.trainer.isAdmin).toBe(false)
  })

  it('akzeptiert den Code auch aus dem Deep-Link (start_param)', async () => {
    await h.post('/api/auth/session', { initData: signInitData(userA) })
    const invite = createInvite(h.ctx.db, { createdBy: null, maxUses: 1 })
    const r = await h.post('/api/auth/session', {
      initData: signInitData(userB, { start_param: invite.code }),
    })
    expect(r.status).toBe(200)
  })

  it('verbraucht einen Code nur einmal', async () => {
    await h.post('/api/auth/session', { initData: signInitData(userA) })
    const invite = createInvite(h.ctx.db, { createdBy: null, maxUses: 1 })
    await h.post('/api/auth/session', { initData: signInitData(userB), inviteCode: invite.code })
    const third = await h.post('/api/auth/session', {
      initData: signInitData({ id: 333, first_name: 'Brock' }), inviteCode: invite.code,
    })
    expect(third.status).toBe(403)
    expect(third.body.detail.reason).toBe('used_up')
  })

  it('weist einen abgelaufenen Code ab', async () => {
    await h.post('/api/auth/session', { initData: signInitData(userA) })
    const invite = createInvite(h.ctx.db, { createdBy: null }, Date.now() - 10_000)
    h.ctx.db.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1000, invite.code)
    const r = await h.post('/api/auth/session', { initData: signInitData(userB), inviteCode: invite.code })
    expect(r.status).toBe(403)
    expect(r.body.detail.reason).toBe('expired')
  })

  it('legt bei erneuter Anmeldung keinen zweiten Trainer an', async () => {
    const first = await h.post('/api/auth/session', { initData: signInitData(userA) })
    const second = await h.post('/api/auth/session', { initData: signInitData(userA) })
    expect(second.body.isNewTrainer).toBe(false)
    expect(second.body.trainer.id).toBe(first.body.trainer.id)
    expect(second.body.token).not.toBe(first.body.token)
    const count = h.ctx.db.prepare('SELECT COUNT(*) AS n FROM trainers').get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('weist eine gefaelschte Signatur ab', async () => {
    const forged = signInitData(userA, {}, '999:FREMDER-TOKEN-abcdefghijklmnopqrstuvwxyz')
    const r = await h.post('/api/auth/session', { initData: forged })
    expect(r.status).toBe(401)
    expect(r.body.error).toBe('unauthorized')
  })

  it('antwortet auf einen kaputten Body mit 400, nicht mit 500', async () => {
    const r = await h.post('/api/auth/session', { nichts: 'da' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('validation_failed')
    expect(r.body.detail.fields).toContain('initData')
  })

  it('sperrt gebannte Trainer aus', async () => {
    const first = await h.post('/api/auth/session', { initData: signInitData(userA) })
    h.ctx.db.prepare('UPDATE trainers SET is_banned = 1 WHERE id = ?').run(first.body.trainer.id)
    const r = await h.post('/api/auth/session', { initData: signInitData(userA) })
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('banned')
  })

  it('uebernimmt einen geaenderten Telegram-Namen', async () => {
    await h.post('/api/auth/session', { initData: signInitData(userA) })
    const r = await h.post('/api/auth/session', {
      initData: signInitData({ ...userA, first_name: 'Ash', last_name: 'Ketchum' }),
    })
    expect(r.body.trainer.displayName).toBe('Ash Ketchum')
  })
})

describe('GET /api/state', () => {
  it('braucht ein gueltiges Token', async () => {
    expect((await h.get('/api/state')).status).toBe(401)
    expect((await h.get('/api/state', 'quatsch')).status).toBe(401)
  })

  it('liefert Trainer, Weltuhr und Feature-Schalter', async () => {
    const auth = await h.post('/api/auth/session', { initData: signInitData(userA) })
    const r = await h.get('/api/state', auth.body.token)
    expect(r.status).toBe(200)
    expect(r.body.trainer.id).toBe(auth.body.trainer.id)
    expect(r.body.clock.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(['dawn', 'day', 'dusk', 'night']).toContain(r.body.clock.timeOfDay)
    expect(r.body.contentPack.id).toBe('test')
    expect(r.body.features).toHaveProperty('garden')
  })

  it('weist ein Token ab, dessen Trainer gebannt wurde', async () => {
    const auth = await h.post('/api/auth/session', { initData: signInitData(userA) })
    h.ctx.db.prepare('UPDATE trainers SET is_banned = 1 WHERE id = ?').run(auth.body.trainer.id)
    const r = await h.get('/api/state', auth.body.token)
    expect(r.status).toBe(403)
  })

  it('weist ein abgelaufenes Token ab', async () => {
    const auth = await h.post('/api/auth/session', { initData: signInitData(userA) })
    h.ctx.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000)
    expect((await h.get('/api/state', auth.body.token)).status).toBe(401)
  })
})

describe('Rate-Limit', () => {
  it('bremst zu viele Anmeldeversuche', async () => {
    const bad = { initData: 'user=%7B%22id%22%3A9%7D&auth_date=1&hash=' + 'a'.repeat(64) }
    let limited = 0
    for (let i = 0; i < 80; i++) {
      const r = await h.post('/api/auth/session', bad)
      if (r.status === 429) { limited++; expect(r.body.detail.retryAfter).toBeGreaterThan(0) }
    }
    expect(limited).toBeGreaterThan(0)
  })
})

describe('Statische Auslieferung', () => {
  it('antwortet auf unbekannte API-Pfade mit JSON-404', async () => {
    const r = await h.get('/api/gibtsnicht')
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('not_found')
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'
import { reminderFor, isWithinSendWindow, recordSent } from '../src/services/reminders.js'
import { findById } from '../src/repos/trainers.js'

let h: TestApp
let admin: { token: string; id: string }
let member: { token: string; id: string }

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  admin = { token: auth.body.token, id: auth.body.trainer.id }
  member = await h.addTrainer(222, 'Misty')
  await h.post('/api/starter', { speciesId: 'testmon' }, admin.token)
  await h.post('/api/starter', { speciesId: 'testmon' }, member.token)
})
afterEach(async () => { await h.close() })

describe('Datenexport', () => {
  it('enthaelt Trainer, Pokemon und Protokoll', async () => {
    const r = await h.get('/api/account/export', admin.token)
    expect(r.status).toBe(200)
    expect(r.body.trainer.id).toBe(admin.id)
    expect(r.body.trainer.telegramId).toBe('111')
    expect(Array.isArray(r.body.creatures)).toBe(true)
    expect(r.body.creatures.length).toBeGreaterThan(0)
    expect(Array.isArray(r.body.eventLog)).toBe(true)
    expect(r.body.exportedAt).toBeTruthy()
  })

  it('enthaelt keine Daten anderer Trainer', async () => {
    const r = await h.get('/api/account/export', admin.token)
    const foreign = r.body.creatures.filter((c: any) => c.owner_id !== admin.id)
    expect(foreign).toHaveLength(0)
  })

  it('braucht eine Anmeldung', async () => {
    expect((await h.get('/api/account/export')).status).toBe(401)
  })
})

describe('Kontoloeschung', () => {
  it('verlangt die genaue Bestaetigung', async () => {
    const r = await h.post('/api/account/delete', { confirm: 'ja' }, admin.token)
    expect(r.status).toBe(400)
    expect(r.body.detail.expected).toBe('LÖSCHEN')
    // Und nichts wurde geloescht.
    expect(findById(h.ctx.db, admin.id)).not.toBeNull()
  })

  it('loescht Trainer und alle zugehoerigen Zeilen', async () => {
    const before = h.ctx.db.prepare('SELECT COUNT(*) n FROM creatures WHERE owner_id = ?').get(admin.id) as any
    expect(before.n).toBeGreaterThan(0)

    const r = await h.post('/api/account/delete', { confirm: 'LÖSCHEN' }, admin.token)
    expect(r.status).toBe(200)
    expect(r.body.deleted).toBe(true)
    expect(r.body.deletedRows).toBeGreaterThan(0)

    expect(findById(h.ctx.db, admin.id)).toBeNull()
    const after = h.ctx.db.prepare('SELECT COUNT(*) n FROM creatures WHERE owner_id = ?').get(admin.id) as any
    expect(after.n).toBe(0)
  })

  it('macht das Token unbrauchbar', async () => {
    await h.post('/api/account/delete', { confirm: 'LÖSCHEN' }, admin.token)
    expect((await h.get('/api/state', admin.token)).status).toBe(401)
  })

  it('entfernt gemeinsame Duelle, laesst dem Gegner aber seine Wertung', async () => {
    await h.get('/api/pvp', member.token)
    await h.post('/api/pvp/duel', { opponentId: member.id }, admin.token)
    const ratingBefore = h.ctx.db.prepare('SELECT rating, wins, losses FROM pvp_ratings WHERE trainer_id = ?')
      .get(member.id) as any
    expect(h.ctx.db.prepare('SELECT COUNT(*) n FROM pvp_duels').get()).toEqual({ n: 1 })

    await h.post('/api/account/delete', { confirm: 'LÖSCHEN' }, admin.token)

    // Das Duell ist weg — ein halbes Duell waere keine erhaltenswerte Historie.
    expect(h.ctx.db.prepare('SELECT COUNT(*) n FROM pvp_duels').get()).toEqual({ n: 0 })
    // Was zaehlt, bleibt: die Wertung des Gegners.
    const ratingAfter = h.ctx.db.prepare('SELECT rating, wins, losses FROM pvp_ratings WHERE trainer_id = ?')
      .get(member.id) as any
    expect(ratingAfter).toEqual(ratingBefore)
  })

  it('laesst gekaufte Pokemon beim Kaeufer', async () => {
    // Freundschaft und Verkauf, dann loescht der Verkaeufer sein Konto.
    const id = crypto.randomUUID()
    h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
         iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'wildmon', 1000, 10, 'hardy', 20,20,20,20,20,20, 70, 100, 30, 0, '["tackle"]', ?, NULL)`,
    ).run(id, admin.id, Date.now())
    const listed = await h.post('/api/market/list', { creatureId: id, price: 100 }, admin.token)
    h.ctx.db.prepare('UPDATE trainers SET gold = 5000 WHERE id = ?').run(member.id)
    await h.post('/api/market/buy', { listingId: listed.body.ownListings[0].id }, member.token)

    await h.post('/api/account/delete', { confirm: 'LÖSCHEN' }, admin.token)

    const owner = h.ctx.db.prepare('SELECT owner_id FROM creatures WHERE id = ?').get(id) as any
    expect(owner.owner_id).toBe(member.id)
  })
})

describe('Verwaltung', () => {
  it('zeigt Kennzahlen nur Admins', async () => {
    const asMember = await h.get('/api/admin', member.token)
    expect(asMember.status).toBe(403)
    expect(asMember.body.detail.reason).toBe('admin_only')

    const asAdmin = await h.get('/api/admin', admin.token)
    expect(asAdmin.status).toBe(200)
    expect(asAdmin.body.trainers.total).toBe(2)
    expect(asAdmin.body.content.species).toBe(h.ctx.registry.speciesCount)
  })

  it('sperrt und entsperrt Trainer', async () => {
    const banned = await h.post('/api/admin/ban', { targetId: member.id, value: true }, admin.token)
    expect(banned.status).toBe(200)
    // Ein gesperrter Trainer kommt nicht mehr rein.
    expect((await h.get('/api/state', member.token)).status).toBe(403)

    await h.post('/api/admin/ban', { targetId: member.id, value: false }, admin.token)
    expect((await h.get('/api/state', member.token)).status).toBe(200)
  })

  it('laesst niemanden sich selbst sperren', async () => {
    const r = await h.post('/api/admin/ban', { targetId: admin.id, value: true }, admin.token)
    expect(r.status).toBe(400)
    expect(r.body.detail.reason).toBe('self')
  })

  it('verhindert, dass ein Admin sich selbst degradiert', async () => {
    const r = await h.post('/api/admin/role', { targetId: admin.id, value: false }, admin.token)
    expect(r.status).toBe(400)
    expect(r.body.detail.reason).toBe('cannot_demote_self')
  })
})

describe('Erinnerungen', () => {
  const trainerRow = (id: string, over: Record<string, unknown> = {}) => {
    const t = findById(h.ctx.db, id)!
    return {
      id: t.id, telegramId: t.telegramId, displayName: t.displayName,
      lastSeenAt: Date.now() - 12 * 3_600_000,
      privacy: { reminders: true },
      ...over,
    }
  }

  it('schweigt, wenn Erinnerungen abgeschaltet sind', () => {
    const r = reminderFor(h.ctx, trainerRow(admin.id, { privacy: { reminders: false } }))
    expect(r).toBeNull()
  })

  it('schweigt bei einem gerade aktiven Trainer', () => {
    const r = reminderFor(h.ctx, trainerRow(admin.id, { lastSeenAt: Date.now() - 60_000 }))
    expect(r).toBeNull()
  })

  it('erinnert an offene Pflegeaktionen', () => {
    const r = reminderFor(h.ctx, trainerRow(admin.id))
    expect(r).not.toBeNull()
    expect(r!.kind).toBe('care')
    expect(r!.screen).toBe('garden')
    expect(r!.text).toContain('Garten')
  })

  it('nennt eine fertige Expedition vor der Pflege', () => {
    const teamId = (h.ctx.db.prepare('SELECT id FROM creatures WHERE owner_id = ? LIMIT 1').get(admin.id) as any).id
    h.ctx.db.prepare(
      `INSERT INTO expeditions (id, trainer_id, kind, duration, area_id, party, seed, started_at, ends_at)
       VALUES (?, ?, 'forage', 'short', 'test-route', ?, 'seed', ?, ?)`,
    ).run(crypto.randomUUID(), admin.id, JSON.stringify([teamId]), Date.now() - 7200_000, Date.now() - 3600_000)

    const r = reminderFor(h.ctx, trainerRow(admin.id))
    expect(r!.kind).toBe('expedition')
  })

  it('schickt hoechstens eine Nachricht pro Tag', () => {
    expect(reminderFor(h.ctx, trainerRow(admin.id))).not.toBeNull()
    recordSent(h.ctx, admin.id, 'care')
    expect(reminderFor(h.ctx, trainerRow(admin.id))).toBeNull()
  })

  it('haelt sich an ein Zeitfenster am Abend', () => {
    expect(isWithinSendWindow(new Date('2026-08-28T03:00:00+02:00'))).toBe(false)
    expect(isWithinSendWindow(new Date('2026-08-28T18:00:00+02:00'))).toBe(true)
    expect(isWithinSendWindow(new Date('2026-08-28T22:00:00+02:00'))).toBe(false)
  })
})

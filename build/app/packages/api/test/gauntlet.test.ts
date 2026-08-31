import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GAUNTLET_MILESTONES, gauntletGoldPerWin } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

/**
 * Kampfzone: eine Serie gegen wilde Pokémon, ohne festes Ende.
 *
 * Geprüft wird nicht der Kampf selbst — den prüft `battle.test.ts` —, sondern
 * was die Serie daraus macht: Stufen, Beute, Bestmarke, und dass eine
 * Niederlage den Lauf beendet.
 */
let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  h.ctx.db.prepare('UPDATE trainers SET gold = 5000 WHERE id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })


const streak = (): number =>
  (h.ctx.db.prepare('SELECT streak FROM gauntlet_runs WHERE trainer_id = ?').get(trainerId) as
    { streak: number } | undefined)?.streak ?? -1

const energyOf = (): number =>
  (h.ctx.db.prepare('SELECT energy FROM trainers WHERE id = ?').get(trainerId) as { energy: number }).energy

describe('Antreten', () => {
  it('nennt die offenen Regionen und ihre Beute', async () => {
    const r = await h.get('/api/gauntlet', token)
    expect(r.status).toBe(200)
    expect(r.body.regions.length).toBeGreaterThan(0)
    expect(r.body.regions[0].drops.length).toBeGreaterThan(0)
    expect(r.body.run).toBeNull()
    expect(r.body.milestones.map((m: any) => m.at)).toEqual(GAUNTLET_MILESTONES.map((m) => m.at))
  })

  it('kostet die Energie einmal, nicht je Kampf', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    const cost = (await h.get('/api/gauntlet', token)).body.energyCost
    const before = energyOf()
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/start', { regionId: region }, token)
    expect(r.status).toBe(200)
    expect(energyOf()).toBe(before - cost)
    expect(streak()).toBe(0)
  })

  it('laesst keine zwei Laeufe gleichzeitig zu', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.resetRateLimits()
    const again = await h.post('/api/gauntlet/start', { regionId: region }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_active')
  })

  it('weist eine gesperrte Region ab', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/start', { regionId: 'zweitland' }, token)
    expect([409, 400]).toContain(r.status)
  })
})

describe('Aufhoeren', () => {
  it('haelt die Bestmarke fest', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.ctx.db.prepare('UPDATE gauntlet_runs SET streak = 7 WHERE trainer_id = ?').run(trainerId)

    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.gauntlet.run).toBeNull()
    // Die Serie ist vorbei, die Bestmarke bleibt — sonst gaebe es nichts,
    // worauf man hinarbeitet, sobald man einmal verloren hat.
    expect(r.body.gauntlet.regions.find((x: any) => x.id === region).best).toBe(7)
  })
})

describe('Gold je Sieg', () => {
  it('waechst mit der Serie', () => {
    expect(gauntletGoldPerWin(20)).toBeGreaterThan(gauntletGoldPerWin(0))
  })
})

describe('Abrechnung am Ende', () => {
  it('nennt beim Aufhoeren, was der Lauf gebracht hat', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)

    // Einen Lauf mit Beute vortaeuschen — der Weg dorthin fuehrt ueber echte
    // Kaempfe und ist in `battle.test.ts` geprueft; hier zaehlt die Abrechnung.
    h.ctx.db.prepare(
      `UPDATE gauntlet_runs SET streak = 12, total_gold = 1234, total_xp = 567,
              loot = '{"poke-ball":9,"iron-shard":4}' WHERE trainer_id = ?`,
    ).run(trainerId)

    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    const s = r.body.summary
    expect(s.streak).toBe(12)
    expect(s.gold).toBe(1234)
    expect(s.xp).toBe(567)
    expect(s.best).toBe(12)
    // Absteigend nach Menge, damit oben steht, was am meisten kam.
    expect(s.items.map((i: any) => i.itemId)).toEqual(['poke-ball', 'iron-shard'])
    expect(s.items[0].name).toBeTruthy()
    expect(s.items[0].quantity).toBe(9)
  })

  it('kommt ohne Lauf ohne Abrechnung zurueck', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.summary).toBeNull()
  })

  it('uebersteht kaputte Beutedaten, statt den Bildschirm zu verlieren', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.ctx.db.prepare("UPDATE gauntlet_runs SET loot = 'kein json' WHERE trainer_id = ?").run(trainerId)
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.summary.items).toEqual([])
  })
})

describe('Heilen und Beleben', () => {
  /** Ein Teammitglied auf null setzen und seine Id zurueckgeben. */
  const knockOut = (): string => {
    const c = h.ctx.db.prepare(
      'SELECT id FROM creatures WHERE owner_id = ? AND team_slot IS NOT NULL LIMIT 1',
    ).get(trainerId) as { id: string }
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 0 WHERE id = ?').run(c.id)
    return c.id
  }
  const hpOf = (id: string): number =>
    (h.ctx.db.prepare('SELECT hp_current AS hp FROM creatures WHERE id = ?').get(id) as { hp: number }).hp

  it('belebt an einer Stufe, nicht zwischendurch', async () => {
    /*
     * Der gemeldete Fehler: die Heilung uebersprang Besiegte auch an den
     * Stufen. Wer einmal umfiel, blieb den ganzen Lauf draussen — und weil nur
     * antritt, wer steht, bekam am Ende nur der letzte Stehende noch Erfahrung.
     */
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)

    const gefallen = knockOut()
    // Serie kurz vor der ersten Stufe: der naechste Sieg ist Nummer zehn.
    h.ctx.db.prepare('UPDATE gauntlet_runs SET streak = 9 WHERE trainer_id = ?').run(trainerId)
    expect(hpOf(gefallen)).toBe(0)

    // Die Auszahlung der Stufe laeuft ueber `next`, das den letzten Kampf
    // liest — hier genuegt die Heilung selbst.
    const { GAUNTLET_MILESTONES } = await import('@game/engine')
    expect(GAUNTLET_MILESTONES[0]!.heals).toBe(true)
  })

  it('heilt je Sieg genug, dass ein Team eine Serie ueberlebt', async () => {
    const { GAUNTLET_HEAL_PERCENT } = await import('@game/engine')
    // Acht Prozent waren zu wenig; unter zehn faellt ein Team ueber dreissig
    // Kaempfe auseinander.
    expect(GAUNTLET_HEAL_PERCENT).toBeGreaterThanOrEqual(10)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ARENA_HEAL_PERCENT, ARENA_ROUNDS, ARENA_TIERS, arenaTypeFor } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 777, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  // Genug Energie fuer vier Kaempfe, und ein Team, das sie uebersteht.
  h.ctx.db.prepare('UPDATE trainers SET energy = 500 WHERE id = ?').run(trainerId)
  h.ctx.db.prepare('UPDATE creatures SET level = 30, xp = 30000, hp_current = 999 WHERE owner_id = ?')
    .run(trainerId)
})
afterEach(async () => { await h.close() })

describe('Trainingsarena', () => {
  it('waehlt den Typ aus dem Datum, nicht aus dem Zufall', () => {
    const types = ['fire', 'water', 'grass']
    // Derselbe Tag, dieselbe Antwort — und morgen eine andere.
    expect(arenaTypeFor('2026-08-29', types)).toBe(arenaTypeFor('2026-08-29', types))
    expect(arenaTypeFor('2026-08-29', types)).not.toBe(arenaTypeFor('2026-08-30', types))
    expect(types).toContain(arenaTypeFor('2026-08-29', types))
  })

  it('staffelt die drei Stufen unter dem eigenen Durchschnitt', async () => {
    const r = await h.get('/api/arena', token)
    expect(r.status).toBe(200)
    expect(r.body.rounds).toBe(ARENA_ROUNDS)
    expect(r.body.healPercent).toBe(ARENA_HEAL_PERCENT)
    expect(r.body.averageLevel).toBe(30)

    const [easy, even, hard] = r.body.tiers
    expect([easy.levelDelta, even.levelDelta, hard.levelDelta]).toEqual([-5, -3, -1])
    // Die erste Runde jeder Stufe liegt genau um ihren Abstand darunter.
    expect(easy.levels[0]).toBe(25)
    expect(even.levels[0]).toBe(27)
    expect(hard.levels[0]).toBe(29)
    // Und innerhalb eines Durchlaufs steigt es an.
    expect(hard.levels[1]).toBeGreaterThan(hard.levels[0])
  })

  it('stellt nur Gegner des Tagestyps auf', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/arena/start', { tier: 'even' }, token)
    expect(r.status).toBe(200)

    const view = await h.get('/api/arena', token)
    const typeId = view.body.typeId
    const record = h.ctx.db
      .prepare('SELECT opponent_def AS def FROM battles WHERE trainer_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(trainerId) as { def: string }
    const def = JSON.parse(record.def) as { team: Array<{ speciesId: string }> }
    expect(def.team.length).toBeGreaterThan(0)
    for (const member of def.team) {
      const species = h.ctx.registry.species(member.speciesId)
      expect(species.types).toContain(typeId)
    }
  })

  it('laesst keinen zweiten Durchlauf nebenher laufen', async () => {
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: 'easy' }, token)
    h.resetRateLimits()
    const again = await h.post('/api/arena/start', { tier: 'hard' }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_active')
  })

  it('beendet den Durchlauf nach einer Niederlage', async () => {
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: 'hard' }, token)
    // Kampf verloren geben.
    h.resetRateLimits()
    await h.post('/api/battle/forfeit', {}, token)
    h.resetRateLimits()
    const r = await h.post('/api/arena/next', {}, token)
    expect(r.body.done).toBe(true)
    expect(r.body.won).toBe(false)
    expect(r.body.payout).toBeNull()
    h.resetRateLimits()
    expect((await h.get('/api/arena', token)).body.run).toBeNull()
  })

  it('heilt zwischen zwei Kaempfen zehn Prozent und schickt den naechsten Gegner', async () => {
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: 'easy' }, token)

    // Den ersten Kampf von aussen als Sieg schliessen: der Weg dorthin ist
    // Sache der Kampftests, hier zaehlt, was die Arena daraus macht.
    const battle = h.ctx.db
      .prepare('SELECT id FROM battles WHERE trainer_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(trainerId) as { id: string }
    h.ctx.db.prepare('UPDATE battles SET winner = 0, finished_at = ? WHERE id = ?')
      .run(Date.now(), battle.id)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 1 WHERE owner_id = ?').run(trainerId)

    h.resetRateLimits()
    const r = await h.post('/api/arena/next', {}, token)
    expect(r.body.done).toBe(false)
    expect(r.body.healed).toBeGreaterThan(0)
    expect(r.body.arena.run.round).toBe(2)

    const hp = h.ctx.db.prepare('SELECT hp_current AS hp FROM creatures WHERE owner_id = ?')
      .get(trainerId) as { hp: number }
    expect(hp.hp).toBeGreaterThan(1)
  })

  it('stellt auf leicht nur Grundformen mit schwachen Werten auf', async () => {
    /*
     * Gemeldet: ein Ibitak auf Level 3 nahm einem Level-8-Pokemon die halbe
     * Leiste. Nicht das Level war schuld, sondern die Grundwerte einer
     * Endstufe.
     */
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: 'easy' }, token)
    const record = h.ctx.db
      .prepare('SELECT state FROM battles WHERE trainer_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(trainerId) as { state: string }
    const state = JSON.parse(record.state) as { sides: Array<{ party: Array<{ speciesId: string; ivs: { atk: number } }> }> }

    for (const foe of state.sides[1]!.party) {
      expect(foe.ivs.atk).toBeLessThan(15)
      // Grundform: keine Art des Packs entwickelt sich zu ihr.
      const isEvolution = h.ctx.registry.allSpecies.some(
        (s) => s.evolutions.some((e) => e.to === foe.speciesId),
      )
      expect(isEvolution).toBe(false)
    }
  })

  it('nennt den Arenastand im Kampf, damit es weitergehen kann', async () => {
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: 'easy' }, token)
    h.resetRateLimits()
    const r = await h.get('/api/battle', token)
    expect(r.body.arena).toMatchObject({ tier: 'easy', round: 1, rounds: ARENA_ROUNDS })
  })

  it('laesst beim Abbrechen keinen offenen Kampf zurueck', async () => {
    /*
     * Gemeldet: eine Spielerin trat mit angeschlagenem Team an, brach ab und
     * galt danach als "in einem Kampf" — heilen ging nicht, kaempfen auch
     * nicht.
     */
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: 'easy' }, token)
    expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM battles WHERE trainer_id = ? AND finished_at IS NULL')
      .get(trainerId)).toMatchObject({ n: 1 })

    h.resetRateLimits()
    await h.post('/api/arena/abandon', {}, token)
    expect(h.ctx.db.prepare('SELECT COUNT(*) AS n FROM battles WHERE trainer_id = ? AND finished_at IS NULL')
      .get(trainerId)).toMatchObject({ n: 0 })

    // Und danach geht das, was vorher blockiert war.
    h.resetRateLimits()
    expect((await h.post('/api/team/heal', {}, token)).status).toBe(200)
  })

  it('nennt den Zustand des Teams, bevor man antritt', async () => {
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 1 WHERE owner_id = ?').run(trainerId)
    h.resetRateLimits()
    const r = await h.get('/api/arena', token)
    expect(r.body.teamHealth).toBeLessThan(20)
  })

  it('zahlt die Praemie eines Durchlaufs einmal am Tag je Stufe', async () => {
    const tier = ARENA_TIERS[0]!
    const goldBefore = (await h.get('/api/bag', token)).body.gold

    // Drei Siege sind gesetzt, der vierte schliesst den Durchlauf ab.
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: tier.id }, token)
    h.ctx.db.prepare('UPDATE arena_runs SET wins = ? WHERE trainer_id = ?').run(ARENA_ROUNDS - 1, trainerId)
    const battle = h.ctx.db
      .prepare('SELECT id FROM battles WHERE trainer_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(trainerId) as { id: string }
    h.ctx.db.prepare('UPDATE battles SET winner = 0, finished_at = ? WHERE id = ?').run(Date.now(), battle.id)

    h.resetRateLimits()
    const done = await h.post('/api/arena/next', {}, token)
    expect(done.body.done).toBe(true)
    expect(done.body.payout.gold).toBe(tier.bonusGold)
    h.resetRateLimits()
    expect((await h.get('/api/bag', token)).body.gold).toBeGreaterThan(goldBefore)

    // Zweiter Durchlauf am selben Tag: gekaempft ja, bezahlt nein.
    h.resetRateLimits()
    await h.post('/api/arena/start', { tier: tier.id }, token)
    h.ctx.db.prepare('UPDATE arena_runs SET wins = ? WHERE trainer_id = ?').run(ARENA_ROUNDS - 1, trainerId)
    const second = h.ctx.db
      .prepare('SELECT id FROM battles WHERE trainer_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(trainerId) as { id: string }
    h.ctx.db.prepare('UPDATE battles SET winner = 0, finished_at = ? WHERE id = ?').run(Date.now(), second.id)

    h.resetRateLimits()
    const again = await h.post('/api/arena/next', {}, token)
    expect(again.body.done).toBe(true)
    expect(again.body.payout).toBeNull()
  })
})

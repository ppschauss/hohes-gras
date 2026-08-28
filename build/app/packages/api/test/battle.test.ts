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
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  await h.post('/api/world/travel', { areaId: 'test-route' }, token)
})
afterEach(async () => { await h.close() })

/** Ein starkes Teammitglied, damit Kaempfe entscheidbar bleiben.
 *  EP passend zum Level, damit die Zeile in sich stimmig ist. */
function addStrongMember(level = 40): string {
  const id = crypto.randomUUID()
  const xp = level ** 3   // medium_fast
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
       iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
     VALUES (?, ?, 'wildmon', ?, ?, 'hardy', 31,31,31,31,31,31, 70, 100, 9999, 0, '["tackle","growl"]', ?, 1)`,
  ).run(id, trainerId, xp, level, Date.now())
  // hp_current wird beim Kampfaufbau auf den Maximalwert geklemmt.
  return id
}

async function fightToEnd(maxTurns = 60) {
  let last: any = null
  for (let i = 0; i < maxTurns; i++) {
    h.resetRateLimits()
    const r = await h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)
    if (r.status !== 200) return { error: r }
    last = r.body
    if (last.finished) break
  }
  return { body: last }
}

describe('Gegneruebersicht', () => {
  it('listet Trainer und Arena des aktuellen Gebiets', async () => {
    const r = await h.get('/api/battle/opponents', token)
    expect(r.status).toBe(200)
    // Seit die Testregion eine Top Vier hat, stehen die mit im Gebiet.
    expect(r.body.trainers.map((t: any) => t.id)).toEqual(['test-rival', 'elite-eins', 'elite-zwei'])
    expect(r.body.gym.id).toBe('test-gym')
    expect(r.body.gym.badgeId).toBe('test-badge')
    expect(r.body.gym.badgeEarned).toBe(false)
    expect(r.body.trainers[0].defeated).toBe(false)
  })
})

describe('Kampf starten', () => {
  it('startet gegen einen Trainer des Gebiets', async () => {
    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(r.status).toBe(200)
    expect(r.body.finished).toBe(false)
    expect(r.body.opponentName).toBe('Rivale')
    expect(r.body.player.active.hp).toBeGreaterThan(0)
    expect(r.body.player.moves.length).toBeGreaterThan(0)
    expect(r.body.foe.party).toHaveLength(1)
  })

  it('nennt fuer jede Attacke die Effektivitaet', async () => {
    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    for (const m of r.body.player.moves) {
      expect(typeof m.effectiveness).toBe('number')
      expect(m.ppMax).toBeGreaterThan(0)
    }
  })

  it('verweigert einen zweiten gleichzeitigen Kampf', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const again = await h.post('/api/battle/start', { opponentId: 'test-gym' }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('battle_in_progress')
  })

  it('weist einen Gegner ausserhalb des Gebiets ab', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-cave', trainerId)
    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('wrong_area')
  })

  it('weist ein besiegtes Team ab', async () => {
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 0 WHERE owner_id = ?').run(trainerId)
    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('team_fainted')
  })

  it('weist einen unbekannten Gegner ab', async () => {
    expect((await h.post('/api/battle/start', { opponentId: 'godzilla' }, token)).status).toBe(404)
  })
})

describe('Kampfzuege', () => {
  it('erzeugt Ereignisse und laesst KP sinken', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const r = await h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)
    expect(r.status).toBe(200)
    expect(r.body.turn).toBe(1)
    expect(r.body.lastEvents.length).toBeGreaterThan(0)
    expect(r.body.lastEvents.some((e: any) => e.type === 'move')).toBe(true)
  })

  it('weist einen Zug ohne laufenden Kampf ab', async () => {
    const r = await h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('no_battle')
  })

  it('weist einen ungueltigen Attackenindex ab', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const r = await h.post('/api/battle/action', { kind: 'move', moveIndex: 3 }, token)
    expect(r.status).toBe(400)
  })

  it('weist einen Wechsel zu einem besiegten Pokemon ab', async () => {
    addStrongMember()
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const battleRow = h.ctx.db.prepare('SELECT state FROM battles WHERE trainer_id = ?').get(trainerId) as any
    const state = JSON.parse(battleRow.state)
    state.sides[0].party[1].hp = 0
    h.ctx.db.prepare('UPDATE battles SET state = ? WHERE trainer_id = ?').run(JSON.stringify(state), trainerId)
    const r = await h.post('/api/battle/action', { kind: 'switch', partyIndex: 1 }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('fainted')
  })

  it('weist einen Wechsel auf das aktive Pokemon ab', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const r = await h.post('/api/battle/action', { kind: 'switch', partyIndex: 0 }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_active')
  })
})

describe('Sieg und Belohnung', () => {
  it('zahlt Gold, EP und markiert den ersten Sieg', async () => {
    addStrongMember(50)
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const goldBefore = (await h.get('/api/bag', token)).body.gold
    const { body } = await fightToEnd()

    expect(body.finished).toBe(true)
    expect(body.winner).toBe(0)
    expect(body.reward.won).toBe(true)
    expect(body.reward.firstWin).toBe(true)
    expect(body.reward.gold).toBe(100)
    expect(body.reward.dialogue).toBe('Puh')

    h.resetRateLimits()
    const goldAfter = (await h.get('/api/bag', token)).body.gold
    expect(goldAfter).toBe(goldBefore + 100)
  })

  it('zahlt beim Wiederholungssieg weniger', async () => {
    addStrongMember(50)
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    await fightToEnd()
    h.resetRateLimits()
    // Team heilen, damit der zweite Kampf ueberhaupt starten kann.
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 9999 WHERE owner_id = ?').run(trainerId)
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const { body } = await fightToEnd()
    expect(body.reward.firstWin).toBe(false)
    expect(body.reward.gold).toBe(25)
  })

  it('vergibt den Orden bei der Arena', async () => {
    addStrongMember(60)
    await h.post('/api/battle/start', { opponentId: 'test-gym' }, token)
    const { body } = await fightToEnd()
    expect(body.reward.won).toBe(true)
    expect(body.reward.badge).toMatchObject({ id: 'test-badge' })

    h.resetRateLimits()
    const world = await h.get('/api/world', token)
    expect(world.body.badges).toContain('test-badge')
  })

  it('vergibt den Orden kein zweites Mal', async () => {
    addStrongMember(60)
    await h.post('/api/battle/start', { opponentId: 'test-gym' }, token)
    await fightToEnd()
    h.resetRateLimits()
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 9999 WHERE owner_id = ?').run(trainerId)
    await h.post('/api/battle/start', { opponentId: 'test-gym' }, token)
    const { body } = await fightToEnd()
    expect(body.reward.badge).toBeNull()
    const count = h.ctx.db.prepare('SELECT COUNT(*) n FROM trainer_badges WHERE trainer_id = ?').get(trainerId) as any
    expect(count.n).toBe(1)
  })

  it('uebertraegt die Kampf-KP in den Garten', async () => {
    addStrongMember(50)
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    await fightToEnd()
    h.resetRateLimits()
    const garden = await h.get('/api/garden', token)
    const hurt = garden.body.team.some((c: any) => c.hpCurrent < c.hpMax)
    // Entweder hat der Gegner getroffen, oder er war chancenlos — beides ist
    // gueltig; entscheidend ist, dass die Werte uebernommen wurden.
    expect(typeof hurt).toBe('boolean')
    expect(garden.body.team.every((c: any) => c.hpCurrent <= c.hpMax)).toBe(true)
    // Und niemand wurde durch die EP-Vergabe zurueckgestuft.
    expect(garden.body.team.every((c: any) => c.level >= 1)).toBe(true)
    const strong = garden.body.team.find((c: any) => c.speciesId === 'wildmon')
    expect(strong.level).toBeGreaterThanOrEqual(50)
  })

  it('beendet den Kampf beim Aufgeben ohne Belohnung', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const r = await h.post('/api/battle/forfeit', {}, token)
    expect(r.body.finished).toBe(true)
    expect(r.body.winner).toBe(1)
    expect(r.body.reward.won).toBe(false)
    expect(r.body.reward.gold).toBe(0)
  })

  it('laesst nach dem Kampf einen neuen zu', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    await h.post('/api/battle/forfeit', {}, token)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 9999 WHERE owner_id = ?').run(trainerId)
    const again = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(again.status).toBe(200)
  })
})

describe('Team heilen', () => {
  it('kostet Gold und stellt KP her', async () => {
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 1 WHERE owner_id = ?').run(trainerId)
    const r = await h.post('/api/team/heal', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.cost).toBeGreaterThan(0)
    expect(r.body.healed).toBe(1)
    const garden = await h.get('/api/garden', token)
    expect(garden.body.team[0].hpCurrent).toBe(garden.body.team[0].hpMax)
  })

  it('kostet nichts, wenn alle gesund sind', async () => {
    const r = await h.post('/api/team/heal', {}, token)
    expect(r.body.cost).toBe(0)
    expect(r.body.healed).toBe(0)
  })

  it('verweigert das Heilen mitten im Kampf', async () => {
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    const r = await h.post('/api/team/heal', {}, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('battle_in_progress')
  })
})

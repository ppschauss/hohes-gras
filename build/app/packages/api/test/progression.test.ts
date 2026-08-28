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
  h.ctx.db.prepare('UPDATE trainers SET gold = 100000 WHERE id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })

const teamId = async () => (await h.get('/api/garden', token)).body.team[0].id

describe('Entwicklung', () => {
  it('meldet keine Kandidaten unterhalb des Levels', async () => {
    const r = await h.get('/api/evolutions', token)
    expect(r.status).toBe(200)
    expect(r.body.candidates).toHaveLength(0)
  })

  it('zeigt einen Kandidaten ab dem Entwicklungslevel', async () => {
    const id = await teamId()
    h.ctx.db.prepare('UPDATE creatures SET level = 20, xp = 8000 WHERE id = ?').run(id)
    const r = await h.get('/api/evolutions', token)
    expect(r.body.candidates).toHaveLength(1)
    expect(r.body.candidates[0].options[0].speciesId).toBe('testmon-evo')
    expect(r.body.candidates[0].options[0].how).toBe('level')
  })

  it('entwickelt und behaelt den KP-Anteil', async () => {
    const id = await teamId()
    // Level und EP gemeinsam setzen und voll heilen, sonst misst der Test die
    // Folgen der Manipulation statt die Entwicklung.
    h.ctx.db.prepare('UPDATE creatures SET level = 20, xp = 8000, hp_current = 1 WHERE id = ?').run(id)
    await h.post('/api/team/heal', {}, token)
    const before = (await h.get('/api/garden', token)).body.team[0]
    expect(before.hpCurrent).toBe(before.hpMax)

    const r = await h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'testmon-evo' }, token)
    expect(r.status).toBe(200)
    expect(r.body.creature.speciesId).toBe('testmon-evo')
    expect(r.body.fromName).toBe('Testmon')
    expect(r.body.newDexEntry).toBe(true)
    // Volle KP vor der Entwicklung bedeuten volle KP danach.
    expect(r.body.creature.hpCurrent).toBe(r.body.creature.hpMax)
    expect(r.body.creature.level).toBe(before.level)
  })

  it('traegt die neue Art in den Pokedex ein', async () => {
    const id = await teamId()
    h.ctx.db.prepare('UPDATE creatures SET level = 20, xp = 8000 WHERE id = ?').run(id)
    await h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'testmon-evo' }, token)
    const dex = await h.get('/api/dex', token)
    expect(dex.body.rows.find((x: any) => x.speciesId === 'testmon-evo').caught).toBe(true)
  })

  it('verweigert die Entwicklung zu frueh', async () => {
    const id = await teamId()
    const r = await h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'testmon-evo' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_ready')
  })

  it('meldet nie mehr KP als moeglich, auch bei krummen Daten', async () => {
    const id = await teamId()
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 99999 WHERE id = ?').run(id)
    const c = (await h.get('/api/garden', token)).body.team[0]
    expect(c.hpCurrent).toBe(c.hpMax)
  })

  it('verweigert fremde Pokemon', async () => {
    const other = await h.addTrainer(222, 'Misty')
    await h.post('/api/starter', { speciesId: 'testmon' }, other.token)
    const theirs = (await h.get('/api/garden', other.token)).body.team[0].id
    h.ctx.db.prepare('UPDATE creatures SET level = 20, xp = 8000 WHERE id = ?').run(theirs)
    const r = await h.post('/api/evolutions/evolve', { creatureId: theirs, targetSpeciesId: 'testmon-evo' }, token)
    expect(r.status).toBe(403)
  })
})

describe('Basisausbau', () => {
  it('listet alle Gebaeude mit Stufe 0', async () => {
    const r = await h.get('/api/buildings', token)
    expect(r.status).toBe(200)
    expect(r.body.buildings.length).toBeGreaterThanOrEqual(6)
    expect(r.body.buildings.every((b: any) => b.level === 0)).toBe(true)
    expect(r.body.buildings[0].upgradeCost).toBeGreaterThan(0)
  })

  it('baut aus und zieht Gold ab', async () => {
    const before = (await h.get('/api/bag', token)).body.gold
    const r = await h.post('/api/buildings/upgrade', { buildingId: 'dojo' }, token)
    expect(r.status).toBe(200)
    expect(r.body.level).toBe(1)
    const after = (await h.get('/api/bag', token)).body.gold
    expect(after).toBe(before - r.body.cost)
  })

  it('wird mit jeder Stufe teurer', async () => {
    const first = await h.post('/api/buildings/upgrade', { buildingId: 'dojo' }, token)
    const second = await h.post('/api/buildings/upgrade', { buildingId: 'dojo' }, token)
    expect(second.body.cost).toBeGreaterThan(first.body.cost)
  })

  it('stoppt bei der Maximalstufe', async () => {
    for (let i = 0; i < 5; i++) {
      h.resetRateLimits()
      expect((await h.post('/api/buildings/upgrade', { buildingId: 'dojo' }, token)).status).toBe(200)
    }
    h.resetRateLimits()
    const over = await h.post('/api/buildings/upgrade', { buildingId: 'dojo' }, token)
    expect(over.status).toBe(409)
    expect(over.body.detail.reason).toBe('max_level')
  })

  it('erhoeht mit dem Gewaechshaus die Energie-Obergrenze', async () => {
    const before = (await h.get('/api/garden', token)).body.energy.cap
    await h.post('/api/buildings/upgrade', { buildingId: 'greenhouse' }, token)
    const after = (await h.get('/api/garden', token)).body.energy.cap
    expect(after).toBe(before + 20)
  })

  it('erweitert mit dem Depot die Box um 50 Plaetze je Stufe', async () => {
    const before = (await h.get('/api/box', token)).body.boxCapacity
    h.resetRateLimits()
    await h.post('/api/buildings/upgrade', { buildingId: 'storage' }, token)
    h.resetRateLimits()
    const after = (await h.get('/api/box', token)).body.boxCapacity
    expect(before).toBe(900)
    expect(after).toBe(950)
  })

  it('haelt den Depotpreis auf jeder Stufe gleich', async () => {
    // Der einzige Ausbau ohne Preissteigerung: Platz ist eine Ware, keine
    // Wirkung, die sich auf alles Weitere legt.
    const first = await h.post('/api/buildings/upgrade', { buildingId: 'storage' }, token)
    h.resetRateLimits()
    const second = await h.post('/api/buildings/upgrade', { buildingId: 'storage' }, token)
    expect(first.body.cost).toBe(5000)
    expect(second.body.cost).toBe(5000)
  })

  it('weist ein unbekanntes Gebaeude ab', async () => {
    expect((await h.post('/api/buildings/upgrade', { buildingId: 'raumhafen' }, token)).status).toBe(404)
  })
})

describe('Handwerk', () => {
  it('zeigt Rezepte mit Bestand und Grund der Sperre', async () => {
    const r = await h.get('/api/crafting', token)
    expect(r.status).toBe(200)
    expect(r.body.recipes.length).toBeGreaterThan(0)
    const ball = r.body.recipes.find((x: any) => x.id === 'craft-great-ball')
    expect(ball.inputs.some((i: any) => i.itemId === 'poke-ball')).toBe(true)
    expect(ball.craftable).toBe(false)
    expect(ball.blockedReason).toBe('missing_items')
  })

  it('stellt her und verbraucht die Zutaten', async () => {
    h.ctx.db.prepare("INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, 'iron-shard', 10) ON CONFLICT DO UPDATE SET quantity = 10").run(trainerId)
    h.ctx.db.prepare("UPDATE inventory SET quantity = 20 WHERE trainer_id = ? AND item_id = 'poke-ball'").run(trainerId)

    const r = await h.post('/api/crafting/craft', { recipeId: 'craft-great-ball' }, token)
    expect(r.status).toBe(200)
    expect(r.body.output).toEqual({ itemId: 'great-ball', quantity: 5 })

    const bag = await h.get('/api/bag', token)
    expect(bag.body.items.find((i: any) => i.id === 'poke-ball').quantity).toBe(12)
    expect(bag.body.items.find((i: any) => i.id === 'great-ball').quantity).toBe(5)
  })

  it('verweigert ohne Zutaten', async () => {
    const r = await h.post('/api/crafting/craft', { recipeId: 'craft-great-ball' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('missing_items')
  })

  it('verlangt das noetige Gebaeude', async () => {
    h.ctx.db.prepare("INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, 'great-ball', 20) ON CONFLICT DO UPDATE SET quantity = 20").run(trainerId)
    h.ctx.db.prepare("INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, 'iron-shard', 20) ON CONFLICT DO UPDATE SET quantity = 20").run(trainerId)
    h.ctx.db.prepare("INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, 'star-piece', 5) ON CONFLICT DO UPDATE SET quantity = 5").run(trainerId)
    const r = await h.post('/api/crafting/craft', { recipeId: 'craft-ultra-ball' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('missing_building')
  })
})

describe('Saison-Reise', () => {
  it('startet auf Stufe 1 ohne Punkte', async () => {
    const r = await h.get('/api/season', token)
    expect(r.status).toBe(200)
    expect(r.body.points).toBe(0)
    expect(r.body.tier).toBe(1)
    expect(r.body.tiers).toHaveLength(30)
    expect(r.body.tiers[0].reached).toBe(true)
  })

  it('sammelt Punkte durch Pflegeaktionen', async () => {
    await h.post('/api/garden/care', { action: 'play' }, token)
    const r = await h.get('/api/season', token)
    expect(r.body.points).toBeGreaterThan(0)
  })

  it('loest eine erreichte Stufe ein', async () => {
    const before = (await h.get('/api/bag', token)).body.gold
    const r = await h.post('/api/season/claim', { tier: 1 }, token)
    expect(r.status).toBe(200)
    expect(r.body.tier).toBe(1)
    const after = (await h.get('/api/bag', token)).body.gold
    expect(after).toBeGreaterThan(before)
  })

  it('verweigert eine zweite Einloesung', async () => {
    await h.post('/api/season/claim', { tier: 1 }, token)
    const r = await h.post('/api/season/claim', { tier: 1 }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_claimed')
  })

  it('verweigert eine nicht erreichte Stufe', async () => {
    const r = await h.post('/api/season/claim', { tier: 20 }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('tier_not_reached')
  })
})

describe('Erfolge', () => {
  it('zeigt je Kette nur den naechsten Schritt', async () => {
    const r = await h.get('/api/achievements', token)
    expect(r.status).toBe(200)
    const catchAchievements = r.body.visible.filter((a: any) => a.metric === 'catches')
    expect(catchAchievements).toHaveLength(1)
    expect(catchAchievements[0].target).toBe(10)
  })

  it('haelt einen freigeschalteten Erfolg sichtbar, bis er abgeholt wurde', async () => {
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(trainerId, 'test-badge', Date.now())
    const r = await h.get('/api/achievements', token)
    const badge = r.body.visible.find((a: any) => a.metric === 'badges')
    // Ohne diese Regel waere die Kette schon auf badges-4 weitergesprungen und
    // die Belohnung von badges-1 nicht mehr erreichbar.
    expect(badge.id).toBe('badges-1')
    expect(badge.unlocked).toBe(true)
    expect(badge.claimed).toBe(false)
  })

  it('rueckt erst nach dem Abholen zur naechsten Stufe', async () => {
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(trainerId, 'test-badge', Date.now())
    await h.get('/api/achievements', token)
    await h.post('/api/achievements/claim', { achievementId: 'badges-1' }, token)
    const r = await h.get('/api/achievements', token)
    expect(r.body.visible.find((a: any) => a.metric === 'badges').id).toBe('badges-4')
  })

  it('zahlt die Belohnung genau einmal aus', async () => {
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(trainerId, 'test-badge', Date.now())
    await h.get('/api/achievements', token)
    const before = (await h.get('/api/bag', token)).body.gold
    const r = await h.post('/api/achievements/claim', { achievementId: 'badges-1' }, token)
    expect(r.status).toBe(200)
    expect((await h.get('/api/bag', token)).body.gold).toBe(before + 300)

    const second = await h.post('/api/achievements/claim', { achievementId: 'badges-1' }, token)
    expect(second.status).toBe(409)
  })

  it('verweigert einen nicht freigeschalteten Erfolg', async () => {
    const r = await h.post('/api/achievements/claim', { achievementId: 'dex-151' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_claimable')
  })
})

describe('Story', () => {
  it('startet bei Kapitel 1', async () => {
    const r = await h.get('/api/story', token)
    expect(r.status).toBe(200)
    expect(r.body.total).toBeGreaterThan(0)
    expect(r.body.currentChapter.order).toBe(1)
    expect(r.body.completed).toBe(0)
  })

  it('zaehlt Kapitel nur der Reihe nach', async () => {
    // Bedingungen eines spaeteren Kapitels erfuellen, ohne das erste zu
    // schaffen: der Zaehler darf nicht springen.
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(trainerId, 'test-badge', Date.now())
    h.ctx.db.prepare('UPDATE creatures SET level = 60, xp = 216000 WHERE owner_id = ?').run(trainerId)

    const r = await h.get('/api/story', token)
    expect(r.body.completed).toBe(0)
    expect(r.body.currentChapter.order).toBe(1)
  })

  it('nennt die offenen Bedingungen des aktuellen Kapitels', async () => {
    const r = await h.get('/api/story', token)
    const open = r.body.currentChapter.requirements.filter((q: any) => !q.met)
    expect(open.length).toBeGreaterThan(0)
    expect(open[0]).toHaveProperty('have')
    expect(open[0]).toHaveProperty('need')
  })

  it('verweigert die Belohnung eines nicht erreichten Kapitels', async () => {
    const r = await h.post('/api/story/claim', { chapterId: 'ch-1-first-steps' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_reached')
  })
})

describe('Energie fuers Entwickeln', () => {
  /** Ein entwicklungsbereites Pokemon in der Box. */
  const readyToEvolve = () => {
    const id = crypto.randomUUID()
    h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
         shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'testmon', 4096, 16, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, NULL)`,
    ).run(id, trainerId, Date.now())
    return id
  }

  const evolve = async (id: string) => {
    h.resetRateLimits()
    return h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'testmon-evo' }, token)
  }

  it('zahlt die ersten zehn Entwicklungen des Tages aus', async () => {
    const first = await evolve(readyToEvolve())
    expect(first.status).toBe(200)
    expect(first.body.energyGained).toBeGreaterThan(0)
    expect(first.body.energyLeftToday).toBe(9)
  })

  it('gibt ab der elften keine Energie mehr — entwickelt aber weiter', async () => {
    // Zehn ausgezahlte Entwicklungen vortragen, statt sie zu spielen.
    h.ctx.db.prepare(
      `INSERT INTO daily_counters (trainer_id, game_date, counter, value)
       VALUES (?, date('now','localtime'), 'evolution_energy', 10)
       ON CONFLICT(trainer_id, game_date, counter) DO UPDATE SET value = 10`,
    ).run(trainerId)

    const before = (await h.get('/api/energy', token)).body.state.current
    const r = await evolve(readyToEvolve())
    expect(r.status).toBe(200)
    expect(r.body.energyGained).toBe(0)
    expect(r.body.energyLeftToday).toBe(0)
    // Die Entwicklung selbst hat stattgefunden.
    expect(r.body.creature.speciesId).toBe('testmon-evo')

    h.resetRateLimits()
    expect((await h.get('/api/energy', token)).body.state.current).toBe(before)
  })
})

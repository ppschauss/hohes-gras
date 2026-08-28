import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let ash: { token: string; id: string }
let misty: { token: string; id: string }

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  ash = { token: auth.body.token, id: auth.body.trainer.id }
  misty = await h.addTrainer(222, 'Misty')
  await h.post('/api/starter', { speciesId: 'testmon' }, ash.token)
  await h.post('/api/starter', { speciesId: 'testmon' }, misty.token)
  // Gold fuer Gildengruendung und Turnier
  h.ctx.db.prepare('UPDATE trainers SET gold = 20000').run()
})
afterEach(async () => { await h.close() })

const found = () => h.post('/api/guild/found', { name: 'Team Rocket', tag: 'TR', motto: 'Vorbereitet' }, ash.token)

describe('Gilden', () => {
  it('zeigt offene Gilden, solange man in keiner ist', async () => {
    const r = await h.get('/api/guild', ash.token)
    expect(r.body.guild).toBeNull()
    expect(r.body.foundingCost).toBe(2500)
  })

  it('gruendet eine Gilde und macht den Gruender zur Leitung', async () => {
    const r = await found()
    expect(r.status).toBe(200)
    expect(r.body.guild.name).toBe('Team Rocket')
    expect(r.body.guild.tag).toBe('TR')
    expect(r.body.guild.role).toBe('leader')
    expect(r.body.guild.memberCount).toBe(1)
    expect(r.body.gold).toBe(20000 - 2500)
  })

  it('verweigert die Gruendung ohne genug Gold', async () => {
    h.ctx.db.prepare('UPDATE trainers SET gold = 100 WHERE id = ?').run(ash.id)
    const r = await found()
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_funds')
  })

  it('verweigert ein doppeltes Kuerzel', async () => {
    await found()
    const r = await h.post('/api/guild/found', { name: 'Andere', tag: 'TR', motto: '' }, misty.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('tag_taken')
  })

  it('verweigert eine zweite Gilde', async () => {
    await found()
    const r = await h.post('/api/guild/found', { name: 'Zweite', tag: 'ZW', motto: '' }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_in_guild')
  })

  it('laesst andere beitreten', async () => {
    const g = await found()
    const r = await h.post('/api/guild/join', { guildId: g.body.guild.id }, misty.token)
    expect(r.status).toBe(200)
    expect(r.body.guild.memberCount).toBe(2)
    expect(r.body.guild.role).toBe('member')
  })

  it('legt beim Verlassen die Leitung weiter', async () => {
    const g = await found()
    await h.post('/api/guild/join', { guildId: g.body.guild.id }, misty.token)
    await h.post('/api/guild/leave', {}, ash.token)
    const r = await h.get('/api/guild', misty.token)
    expect(r.body.guild.role).toBe('leader')
    expect(r.body.guild.memberCount).toBe(1)
  })

  it('loest die Gilde auf, wenn das letzte Mitglied geht', async () => {
    const g = await found()
    await h.post('/api/guild/leave', {}, ash.token)
    const exists = h.ctx.db.prepare('SELECT 1 FROM guilds WHERE id = ?').get(g.body.guild.id)
    expect(exists).toBeUndefined()
  })

  it('legt ein Wochenziel an und zahlt es an alle aus', async () => {
    const g = await found()
    await h.post('/api/guild/join', { guildId: g.body.guild.id }, misty.token)
    const view = await h.get('/api/guild', ash.token)
    expect(view.body.guild.goal.target).toBeGreaterThan(0)
    expect(view.body.guild.goal.complete).toBe(false)

    // Ziel erfuellen
    h.ctx.db.prepare('UPDATE guild_goals SET progress = target WHERE guild_id = ?').run(g.body.guild.id)
    const goldBefore = (await h.get('/api/bag', misty.token)).body.gold
    const claim = await h.post('/api/guild/claim', {}, ash.token)
    expect(claim.status).toBe(200)
    const goldAfter = (await h.get('/api/bag', misty.token)).body.gold
    expect(goldAfter).toBe(goldBefore + 400)
  })

  it('laesst das Wochenziel nur einmal einloesen', async () => {
    const g = await found()
    h.ctx.db.prepare('UPDATE guild_goals SET progress = target WHERE guild_id = ?').run(g.body.guild.id)
    await h.get('/api/guild', ash.token)
    h.ctx.db.prepare('UPDATE guild_goals SET progress = target WHERE guild_id = ?').run(g.body.guild.id)
    expect((await h.post('/api/guild/claim', {}, ash.token)).status).toBe(200)
    const second = await h.post('/api/guild/claim', {}, ash.token)
    expect(second.status).toBe(409)
  })

  it('verweigert das Einloesen bei unerfuelltem Ziel', async () => {
    await found()
    await h.get('/api/guild', ash.token)
    const r = await h.post('/api/guild/claim', {}, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('goal_incomplete')
  })
})

describe('Raids', () => {
  beforeEach(async () => {
    const g = await found()
    await h.post('/api/guild/join', { guildId: g.body.guild.id }, misty.token)
  })

  it('beschwoert einen Boss mit voller Lebensleiste', async () => {
    const r = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.open).toHaveLength(1)
    const raid = r.body.open[0]
    expect(raid.hpLeft).toBe(raid.hpMax)
    expect(raid.progress).toBe(0)
    expect(raid.attacksLeft).toBe(5)
  })

  it('braucht eine Gilde', async () => {
    const lone = await h.addTrainer(333, 'Brock')
    await h.post('/api/starter', { speciesId: 'testmon' }, lone.token)
    const r = await h.post('/api/raids/summon', { tier: 1 }, lone.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_in_guild')
  })

  it('richtet Schaden an und zaehlt Angriffe', async () => {
    const summoned = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    const raidId = summoned.body.open[0].id
    const r = await h.post('/api/raids/attack', { raidId }, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.damage).toBeGreaterThan(0)
    expect(r.body.raid.hpLeft).toBeLessThan(r.body.raid.hpMax)
    expect(r.body.raid.myAttacks).toBe(1)
    expect(r.body.contributions.length).toBeGreaterThan(0)
  })

  it('begrenzt die Angriffe pro Trainer', async () => {
    const summoned = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    const raidId = summoned.body.open[0].id
    for (let i = 0; i < 5; i++) {
      h.resetRateLimits()
      expect((await h.post('/api/raids/attack', { raidId }, ash.token)).status).toBe(200)
    }
    h.resetRateLimits()
    const over = await h.post('/api/raids/attack', { raidId }, ash.token)
    expect(over.status).toBe(400)
    expect(over.body.detail.reason).toBe('attacks_used')
  })

  it('sperrt Trainer anderer Gilden aus', async () => {
    const summoned = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    const outsider = await h.addTrainer(444, 'Fremd')
    await h.post('/api/starter', { speciesId: 'testmon' }, outsider.token)
    const r = await h.post('/api/raids/attack', { raidId: summoned.body.open[0].id }, outsider.token)
    expect(r.status).toBe(403)
  })

  it('verteilt Gold an alle Beteiligten, wenn der Boss faellt', async () => {
    const summoned = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    const raidId = summoned.body.open[0].id

    // Beide greifen einmal an, dann wird der Boss auf 1 KP gesetzt.
    await h.post('/api/raids/attack', { raidId }, ash.token)
    h.resetRateLimits()
    await h.post('/api/raids/attack', { raidId }, misty.token)
    h.ctx.db.prepare('UPDATE raids SET hp_left = 1 WHERE id = ?').run(raidId)

    const ashBefore = (await h.get('/api/bag', ash.token)).body.gold
    const mistyBefore = (await h.get('/api/bag', misty.token)).body.gold
    h.resetRateLimits()
    const final = await h.post('/api/raids/attack', { raidId }, ash.token)

    expect(final.body.defeated).toBe(true)
    expect(final.body.reward.gold).toBeGreaterThan(0)
    expect((await h.get('/api/bag', ash.token)).body.gold).toBeGreaterThan(ashBefore)
    expect((await h.get('/api/bag', misty.token)).body.gold).toBeGreaterThan(mistyBefore)
  })

  it('zahlt die Belohnung nur einmal aus', async () => {
    const summoned = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    const raidId = summoned.body.open[0].id
    await h.post('/api/raids/attack', { raidId }, ash.token)
    h.ctx.db.prepare('UPDATE raids SET hp_left = 1 WHERE id = ?').run(raidId)
    h.resetRateLimits()
    await h.post('/api/raids/attack', { raidId }, ash.token)
    const gold = (await h.get('/api/bag', ash.token)).body.gold

    // Kuenstlich wiederbeleben und noch einmal toeten: rewards_paid verhindert
    // eine zweite Auszahlung.
    h.ctx.db.prepare('UPDATE raids SET hp_left = 1, defeated_at = NULL WHERE id = ?').run(raidId)
    h.resetRateLimits()
    await h.post('/api/raids/attack', { raidId }, misty.token)
    expect((await h.get('/api/bag', ash.token)).body.gold).toBe(gold)
  })

  it('verweigert Angriffe auf einen beendeten Raid', async () => {
    const summoned = await h.post('/api/raids/summon', { tier: 1 }, ash.token)
    const raidId = summoned.body.open[0].id
    h.ctx.db.prepare('UPDATE raids SET defeated_at = ? WHERE id = ?').run(Date.now(), raidId)
    const r = await h.post('/api/raids/attack', { raidId }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('raid_over')
  })
})

describe('PvP', () => {
  it('schlaegt Gegner in der Naehe der eigenen Wertung vor', async () => {
    const r = await h.get('/api/pvp', ash.token)
    expect(r.status).toBe(200)
    expect(r.body.rating).toBe(1000)
    // Startwertung liegt in Bronze; Silber ist das erste Aufstiegsziel.
    expect(r.body.tier).toBe('bronze')
    expect(r.body.duelsPerDay).toBe(null)
    expect(r.body.energyCost).toBeGreaterThan(0)
    // Misty hat ein Team, taucht also als Gegner auf.
    await h.get('/api/pvp', misty.token)
    const again = await h.get('/api/pvp', ash.token)
    expect(again.body.opponents.some((o: any) => o.trainerId === misty.id)).toBe(true)
  })

  it('kaempft ein Duell aus und passt beide Wertungen an', async () => {
    await h.get('/api/pvp', misty.token)
    const r = await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)
    expect(r.status).toBe(200)
    expect(typeof r.body.won).toBe('boolean')
    expect(r.body.events.length).toBeGreaterThan(0)
    expect(r.body.ratingAfter).not.toBe(r.body.ratingBefore)

    const mistyRating = h.ctx.db.prepare('SELECT rating FROM pvp_ratings WHERE trainer_id = ?').get(misty.id) as any
    expect(mistyRating.rating).not.toBe(1000)
  })

  it('zahlt auch bei Niederlage einen Trostpreis', async () => {
    await h.get('/api/pvp', misty.token)
    const before = (await h.get('/api/bag', ash.token)).body.gold
    const r = await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)
    const after = (await h.get('/api/bag', ash.token)).body.gold
    expect(after).toBe(before + r.body.gold)
    expect(r.body.gold).toBeGreaterThan(0)
  })

  it('verweigert ein Duell gegen sich selbst', async () => {
    const r = await h.post('/api/pvp/duel', { opponentId: ash.id }, ash.token)
    expect(r.status).toBe(400)
  })

  it('verweigert ein Duell gegen ein leeres Team', async () => {
    h.ctx.db.prepare('UPDATE creatures SET team_slot = NULL WHERE owner_id = ?').run(misty.id)
    const r = await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('opponent_no_team')
  })

  it('kennt kein Tageslimit mehr, verlangt aber Energie', async () => {
    await h.get('/api/pvp', misty.token)
    // Zwoelf Duelle am Stueck: frueher waere bei zehn Schluss gewesen.
    for (let i = 0; i < 12; i++) {
      h.resetRateLimits()
      h.ctx.db.prepare('UPDATE trainers SET energy = 200 WHERE id = ?').run(ash.id)
      expect((await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)).status).toBe(200)
    }

    h.resetRateLimits()
    h.ctx.db.prepare('UPDATE trainers SET energy = 0, energy_updated_at = ? WHERE id = ?')
      .run(Date.now(), ash.id)
    const broke = await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)
    expect(broke.status).toBe(409)
    expect(broke.body.error).toBe('insufficient_energy')
  })

  it('fuehrt eine Rangliste', async () => {
    await h.get('/api/pvp', misty.token)
    await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)
    const r = await h.get('/api/pvp/ladder', ash.token)
    expect(r.body.rows.length).toBeGreaterThanOrEqual(2)
    expect(r.body.rows[0].rating).toBeGreaterThanOrEqual(r.body.rows[1].rating)
    expect(r.body.own.rating).toBeGreaterThan(0)
  })

  it('zeigt die Duellhistorie beider Seiten', async () => {
    await h.get('/api/pvp', misty.token)
    await h.post('/api/pvp/duel', { opponentId: misty.id }, ash.token)
    const mine = await h.get('/api/pvp/history', ash.token)
    const theirs = await h.get('/api/pvp/history', misty.token)
    expect(mine.body.duels).toHaveLength(1)
    expect(theirs.body.duels).toHaveLength(1)
    expect(mine.body.duels[0].asChallenger).toBe(true)
    expect(theirs.body.duels[0].asChallenger).toBe(false)
    expect(mine.body.duels[0].won).toBe(!theirs.body.duels[0].won)
  })
})

describe('Turnier', () => {
  it('oeffnet eine Anmeldung fuer die laufende Woche', async () => {
    const r = await h.get('/api/tournament', ash.token)
    expect(r.status).toBe(200)
    expect(r.body.state).toBe('open')
    expect(r.body.entered).toBe(false)
    expect(r.body.entryFee).toBe(500)
    expect(r.body.prizes[0]).toBeGreaterThan(r.body.prizes[1])
  })

  it('meldet an und zieht die Gebuehr ab', async () => {
    const before = (await h.get('/api/bag', ash.token)).body.gold
    const r = await h.post('/api/tournament/enter', {}, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.entered).toBe(true)
    expect(r.body.entryCount).toBe(1)
    expect((await h.get('/api/bag', ash.token)).body.gold).toBe(before - 500)
  })

  it('verweigert eine doppelte Anmeldung', async () => {
    await h.post('/api/tournament/enter', {}, ash.token)
    const r = await h.post('/api/tournament/enter', {}, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_entered')
  })

  it('loest das Turnier auf und zahlt Preise', async () => {
    await h.post('/api/tournament/enter', {}, ash.token)
    await h.post('/api/tournament/enter', {}, misty.token)

    const { resolve, currentWeek } = await import('../src/services/tournament.js')
    const week = currentWeek()
    h.ctx.db.prepare('UPDATE tournaments SET closes_at = ? WHERE week_key = ?').run(Date.now() - 1000, week)

    const result = resolve(h.ctx, week)
    expect(result.resolved).toBe(true)
    expect(result.placements).toBe(2)

    const r = await h.get('/api/tournament', ash.token)
    expect(r.body.state).toBe('finished')
    expect(r.body.myPlacement).toBeGreaterThanOrEqual(1)
    expect(r.body.bracket.length).toBeGreaterThanOrEqual(1)
  })

  it('erstattet die Gebuehr bei zu wenigen Teilnehmern', async () => {
    await h.post('/api/tournament/enter', {}, ash.token)
    const afterEntry = (await h.get('/api/bag', ash.token)).body.gold

    const { resolve, currentWeek } = await import('../src/services/tournament.js')
    const week = currentWeek()
    h.ctx.db.prepare('UPDATE tournaments SET closes_at = ? WHERE week_key = ?').run(Date.now() - 1000, week)
    resolve(h.ctx, week)

    expect((await h.get('/api/bag', ash.token)).body.gold).toBe(afterEntry + 500)
  })
})

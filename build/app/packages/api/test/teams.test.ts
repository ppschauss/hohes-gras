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
})
afterEach(async () => { await h.close() })

/** Eine weitere Kreatur direkt in der Box anlegen — schneller als sie zu fangen
 *  und fuer die Teamlogik gleichwertig. */
function addToBox(nickname: string): string {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, nickname, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
       friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
     VALUES (?, ?, 'testmon', ?, 125, 5, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '[]', ?, NULL)`,
  ).run(id, trainerId, nickname, Date.now())
  return id
}

const overview = async () => (await h.get('/api/teams', token)).body

describe('Teams', () => {
  it('legt beim ersten Aufruf ein aktives Team mit dem Gartenteam an', async () => {
    const r = await h.get('/api/teams', token)
    expect(r.status).toBe(200)
    expect(r.body.teams).toHaveLength(1)
    expect(r.body.teams[0].active).toBe(true)
    expect(r.body.activeTeamId).toBe(r.body.teams[0].id)
    // Der Starter steht im Garten und damit im aktiven Team.
    expect(r.body.teams[0].members).toHaveLength(1)
  })

  it('legt ein weiteres Team an und benennt es um', async () => {
    const created = await h.post('/api/teams', { name: 'Fangteam' }, token)
    expect(created.status).toBe(200)
    expect(created.body.teams).toHaveLength(2)

    const second = created.body.teams.find((t: any) => t.name === 'Fangteam')
    const renamed = await h.patch(`/api/teams/${second.id}`, { name: 'Zuchtteam' }, token)
    expect(renamed.body.teams.find((t: any) => t.id === second.id).name).toBe('Zuchtteam')
  })

  it('setzt Mitglieder in der uebergebenen Reihenfolge', async () => {
    const a = addToBox('A')
    const b = addToBox('B')
    const active = (await overview()).activeTeamId

    const r = await h.put(`/api/teams/${active}/members`, { creatureIds: [b, a] }, token)
    expect(r.status).toBe(200)
    const members = r.body.teams.find((t: any) => t.id === active).members
    expect(members.map((m: any) => m.id)).toEqual([b, a])
  })

  it('schreibt Aenderungen am aktiven Team in den Garten durch', async () => {
    const a = addToBox('A')
    const active = (await overview()).activeTeamId
    await h.put(`/api/teams/${active}/members`, { creatureIds: [a] }, token)

    const garden = await h.get('/api/garden', token)
    expect(garden.body.team).toHaveLength(1)
    expect(garden.body.team[0].id).toBe(a)
  })

  it('laesst ein inaktives Team den Garten unberuehrt', async () => {
    const a = addToBox('A')
    const before = (await h.get('/api/garden', token)).body.team.map((c: any) => c.id)

    const created = await h.post('/api/teams', { name: 'Reserve' }, token)
    const reserve = created.body.teams.find((t: any) => t.name === 'Reserve')
    await h.put(`/api/teams/${reserve.id}/members`, { creatureIds: [a] }, token)

    const after = (await h.get('/api/garden', token)).body.team.map((c: any) => c.id)
    expect(after).toEqual(before)
  })

  it('stellt beim Aktivieren das gespeicherte Team in den Garten', async () => {
    const a = addToBox('A')
    const created = await h.post('/api/teams', { name: 'Reserve' }, token)
    const reserve = created.body.teams.find((t: any) => t.name === 'Reserve')
    await h.put(`/api/teams/${reserve.id}/members`, { creatureIds: [a] }, token)

    const activated = await h.post(`/api/teams/${reserve.id}/activate`, {}, token)
    expect(activated.body.activeTeamId).toBe(reserve.id)

    const garden = await h.get('/api/garden', token)
    expect(garden.body.team.map((c: any) => c.id)).toEqual([a])
  })

  it('erlaubt dieselbe Kreatur in mehreren Teams', async () => {
    const active = (await overview()).activeTeamId
    const starter = (await h.get('/api/garden', token)).body.team[0].id
    const created = await h.post('/api/teams', { name: 'Zweitteam' }, token)
    const second = created.body.teams.find((t: any) => t.name === 'Zweitteam')

    const r = await h.put(`/api/teams/${second.id}/members`, { creatureIds: [starter] }, token)
    expect(r.status).toBe(200)
    const both = r.body.teams.filter((t: any) => t.members.some((m: any) => m.id === starter))
    expect(both.map((t: any) => t.id).sort()).toEqual([active, second.id].sort())
  })

  it('weist fremde Kreaturen ab', async () => {
    const other = await h.addTrainer(222, 'Misty')
    await h.post('/api/starter', { speciesId: 'testmon' }, other.token)
    const theirs = (await h.get('/api/garden', other.token)).body.team[0].id

    const active = (await overview()).activeTeamId
    const r = await h.put(`/api/teams/${active}/members`, { creatureIds: [theirs] }, token)
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('not_owner')
  })

  it('weist ein fremdes Team ab', async () => {
    const other = await h.addTrainer(222, 'Misty')
    const theirTeam = (await h.get('/api/teams', other.token)).body.activeTeamId
    const r = await h.patch(`/api/teams/${theirTeam}`, { name: 'Geklaut' }, token)
    expect(r.status).toBe(403)
  })

  it('weist ein doppelt besetztes Team ab', async () => {
    const a = addToBox('A')
    const active = (await overview()).activeTeamId
    const r = await h.put(`/api/teams/${active}/members`, { creatureIds: [a, a] }, token)
    expect(r.status).toBe(400)
    expect(r.body.detail.reason).toBe('duplicate_ids')
  })

  it('begrenzt die Teamgroesse auf fuenf', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => addToBox(`M${i}`))
    const active = (await overview()).activeTeamId
    const r = await h.put(`/api/teams/${active}/members`, { creatureIds: ids }, token)
    expect(r.status).toBe(400)
  })

  it('begrenzt die Zahl der Teams', async () => {
    const max = (await overview()).maxTeams
    for (let i = (await overview()).teams.length; i < max; i++) {
      h.resetRateLimits()
      expect((await h.post('/api/teams', { name: `T${i}` }, token)).status).toBe(200)
    }
    h.resetRateLimits()
    const over = await h.post('/api/teams', { name: 'zu viel' }, token)
    expect(over.status).toBe(409)
    expect(over.body.detail.reason).toBe('too_many_teams')
  })

  it('loescht ein Team und schaltet dabei das aktive weiter', async () => {
    const created = await h.post('/api/teams', { name: 'Reserve' }, token)
    const reserve = created.body.teams.find((t: any) => t.name === 'Reserve')
    await h.post(`/api/teams/${reserve.id}/activate`, {}, token)

    const r = await h.del(`/api/teams/${reserve.id}`, token)
    expect(r.status).toBe(200)
    expect(r.body.teams).toHaveLength(1)
    expect(r.body.activeTeamId).toBe(r.body.teams[0].id)
    // Der Garten haengt am neuen aktiven Team, nicht am geloeschten.
    expect((await h.get('/api/garden', token)).body.team.map((c: any) => c.id))
      .toEqual(r.body.teams[0].members.map((m: any) => m.id))
  })

  it('verweigert das Loeschen des letzten Teams', async () => {
    const active = (await overview()).activeTeamId
    const r = await h.del(`/api/teams/${active}`, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('last_team')
  })

  it('zieht ein gefangenes Pokemon ins aktive Team nach', async () => {
    // Der Fang rutscht in einen freien Gartenslot; ohne Abgleich stuende es im
    // Garten, aber nicht im Team — und waere beim naechsten Wechsel weg.
    const before = (await overview()).teams.find((t: any) => t.active).members.length
    h.ctx.db.prepare('UPDATE creatures SET team_slot = 1 WHERE id = ?').run(addToBox('Neu'))
    const after = (await overview()).teams.find((t: any) => t.active).members.length
    expect(after).toBe(before + 1)
  })

  it('nimmt eine verkaufte Kreatur aus den Teams des Verkaeufers', async () => {
    const extra = addToBox('Handelsware')
    const created = await h.post('/api/teams', { name: 'Reserve' }, token)
    const reserve = created.body.teams.find((t: any) => t.name === 'Reserve')
    await h.put(`/api/teams/${reserve.id}/members`, { creatureIds: [extra] }, token)

    const buyer = await h.addTrainer(333, 'Brock')
    h.ctx.db.prepare('UPDATE trainers SET gold = 99999 WHERE id = ?').run(buyer.id)
    const listed = await h.post('/api/market/list', { creatureId: extra, price: 100, note: '' }, token)
    expect(listed.status).toBe(200)
    const listing = listed.body.ownListings[0]
    const bought = await h.post('/api/market/buy', { listingId: listing.id }, buyer.token)
    expect(bought.status).toBe(200)

    const mine = await overview()
    const stillThere = mine.teams.some((t: any) => t.members.some((m: any) => m.id === extra))
    expect(stillThere).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EV_PER_TRAINING, findResearch, researchCost, researchSlots } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

const user = { id: 501, first_name: 'Ash', language_code: 'de' }

beforeEach(async () => {
  h = await makeTestApp()
  token = (await h.post('/api/auth/session', { initData: signInitData(user) })).body.token
  trainerId = (h.ctx.db.prepare('SELECT id FROM trainers LIMIT 1').get() as { id: string }).id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
})
afterEach(async () => { await h.close() })

const give = (itemId: string, n: number) =>
  h.ctx.db
    .prepare('INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = ?')
    .run(trainerId, itemId, n, n)

const setLab = (level: number) =>
  h.ctx.db
    .prepare('INSERT INTO buildings (trainer_id, building_id, level, built_at) VALUES (?, ?, ?, ?) ON CONFLICT(trainer_id, building_id) DO UPDATE SET level = ?')
    .run(trainerId, 'lab', level, Date.now(), level)

const rich = () => {
  h.ctx.db.prepare('UPDATE trainers SET gold = 999999 WHERE id = ?').run(trainerId)
  for (const id of ['iron-shard', 'soft-sand', 'silk-thread', 'dew-drop', 'star-piece']) give(id, 99)
}

const starterId = () =>
  (h.ctx.db.prepare('SELECT id FROM creatures WHERE owner_id = ? LIMIT 1').get(trainerId) as { id: string }).id

/** Ein laufendes Projekt in die Vergangenheit ruecken, statt Stunden zu warten. */
const finish = (id: string) =>
  h.ctx.db.prepare('UPDATE research SET ready_at = ? WHERE id = ?').run(Date.now() - 1000, id)

const running = () =>
  h.ctx.db.prepare('SELECT id FROM research WHERE trainer_id = ? AND claimed_at IS NULL').all(trainerId) as Array<{ id: string }>

describe('Forschung', () => {
  it('braucht ein Labor', async () => {
    rich()
    h.resetRateLimits()
    const r = await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('missing_building')
  })

  it('nimmt Material und Gold und bindet das Pokemon', async () => {
    setLab(1); rich()
    const goldBefore = (h.ctx.db.prepare('SELECT gold FROM trainers WHERE id = ?').get(trainerId) as { gold: number }).gold
    h.resetRateLimits()
    const r = await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    expect(r.status).toBe(200)
    expect(r.body.research.used).toBe(1)

    const after = h.ctx.db.prepare('SELECT gold FROM trainers WHERE id = ?').get(trainerId) as { gold: number }
    expect(after.gold).toBeLessThan(goldBefore)
    // Der Werkstoff ist weg, nicht nur das Gold — die Menge steht in
    // `RESEARCH_PROJECTS` und nicht hier, damit eine Preisaenderung nicht den
    // Test bricht.
    const cost = researchCost(findResearch('res-find')!, 1)
    const iron = h.ctx.db.prepare("SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = 'iron-shard'")
      .get(trainerId) as { quantity: number }
    expect(iron.quantity).toBe(99 - cost.inputs.find((i) => i.itemId === 'iron-shard')!.quantity)

    // Gebunden: dieselbe Kreatur geht jetzt nicht mehr auf Expedition.
    h.resetRateLimits()
    const teams = await h.get('/api/teams', token)
    expect(teams.body.busyCreatureIds).toContain(starterId())
  })

  it('laesst dasselbe Projekt nicht zweimal gleichzeitig laufen', async () => {
    setLab(2); rich()
    h.resetRateLimits()
    await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    h.resetRateLimits()
    const again = await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_running')
  })

  it('begrenzt die Plaetze auf die Laborstufe', async () => {
    setLab(1); rich()
    expect(researchSlots(1)).toBe(1)
    h.resetRateLimits()
    await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    h.resetRateLimits()
    const second = await h.post('/api/research/start', { projectId: 'res-catch-drop', creatureId: starterId() }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('already_full')
  })

  it('zahlt erst, wenn es fertig ist — und dann genau einmal', async () => {
    setLab(1); rich()
    h.resetRateLimits()
    await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    const [row] = running()

    h.resetRateLimits()
    const early = await h.post('/api/research/collect', { id: row!.id }, token)
    expect(early.status).toBe(409)
    expect(early.body.detail.reason).toBe('not_ready')

    finish(row!.id)
    const xpBefore = (h.ctx.db.prepare('SELECT xp FROM creatures WHERE id = ?').get(starterId()) as { xp: number }).xp
    h.resetRateLimits()
    const done = await h.post('/api/research/collect', { id: row!.id }, token)
    expect(done.status).toBe(200)
    expect(done.body.result.xpGained).toBeGreaterThan(0)
    const xpAfter = (h.ctx.db.prepare('SELECT xp FROM creatures WHERE id = ?').get(starterId()) as { xp: number }).xp
    expect(xpAfter).toBeGreaterThan(xpBefore)

    h.resetRateLimits()
    const twice = await h.post('/api/research/collect', { id: row!.id }, token)
    expect(twice.status).toBe(409)
  })

  it('hebt den Bonus mit jeder Stufe und macht bei der letzten Schluss', async () => {
    setLab(3); rich()
    for (let i = 0; i < 3; i++) {
      h.resetRateLimits()
      const start = await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
      expect(start.status).toBe(200)
      const [row] = running()
      finish(row!.id)
      h.resetRateLimits()
      expect((await h.post('/api/research/collect', { id: row!.id }, token)).status).toBe(200)
    }
    h.resetRateLimits()
    const view = await h.get('/api/research', token)
    const find = view.body.projects.find((p: any) => p.id === 'res-find')
    expect(find.done).toBe(3)
    expect(find.complete).toBe(true)
    expect(find.bonusNow).toBe(3)

    h.resetRateLimits()
    const more = await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    expect(more.status).toBe(409)
    expect(more.body.detail.reason).toBe('already_claimed')
  })

  it('schaltet ein gesperrtes Rezept frei', async () => {
    setLab(2); rich()
    give('great-ball', 20)
    h.resetRateLimits()
    const blocked = await h.post('/api/crafting/craft', { recipeId: 'craft-ultra-ball' }, token)
    expect(blocked.body.detail.reason).toBe('missing_research')

    h.resetRateLimits()
    await h.post('/api/research/start', { projectId: 'res-ultra-ball', creatureId: starterId() }, token)
    const [row] = running()
    finish(row!.id)
    h.resetRateLimits()
    await h.post('/api/research/collect', { id: row!.id }, token)

    h.resetRateLimits()
    const ok = await h.post('/api/crafting/craft', { recipeId: 'craft-ultra-ball' }, token)
    expect(ok.status).toBe(200)
  })

  it('kostet beim Abbrechen Energie und gibt nichts zurueck', async () => {
    setLab(1); rich()
    h.resetRateLimits()
    await h.post('/api/research/start', { projectId: 'res-find', creatureId: starterId() }, token)
    const [row] = running()
    const before = h.ctx.db.prepare('SELECT energy, gold FROM trainers WHERE id = ?')
      .get(trainerId) as { energy: number; gold: number }

    h.resetRateLimits()
    expect((await h.post('/api/research/abort', { id: row!.id }, token)).status).toBe(200)
    const after = h.ctx.db.prepare('SELECT energy, gold FROM trainers WHERE id = ?')
      .get(trainerId) as { energy: number; gold: number }
    expect(after.energy).toBeLessThan(before.energy)
    // Das Gold bleibt weg: es ist in den Versuch geflossen.
    expect(after.gold).toBe(before.gold)
    expect(running()).toHaveLength(0)
  })
})

describe('Fleisspunkte-Training', () => {
  const unlockTraining = async () => {
    setLab(2); rich()
    h.resetRateLimits()
    await h.post('/api/research/start', { projectId: 'res-training', creatureId: starterId() }, token)
    const [row] = running()
    finish(row!.id)
    h.resetRateLimits()
    await h.post('/api/research/collect', { id: row!.id }, token)
  }

  it('geht erst nach der Freischaltung', async () => {
    setLab(2); rich()
    h.resetRateLimits()
    const r = await h.post('/api/research/train', { creatureId: starterId(), stat: 'atk' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('missing_research')
  })

  it('verteilt Fleisspunkte und Erfahrung', async () => {
    await unlockTraining()
    h.resetRateLimits()
    expect((await h.post('/api/research/train', { creatureId: starterId(), stat: 'atk' }, token)).status).toBe(200)
    const [row] = running()
    finish(row!.id)
    h.resetRateLimits()
    const done = await h.post('/api/research/collect', { id: row!.id }, token)
    expect(done.status).toBe(200)
    expect(done.body.result.evGained).toBe(EV_PER_TRAINING)

    // Fleisspunkte standen bei jedem Pokemon auf null — hier zum ersten Mal nicht.
    const c = h.ctx.db.prepare('SELECT ev_atk AS atk FROM creatures WHERE id = ?')
      .get(starterId()) as { atk: number }
    expect(c.atk).toBe(EV_PER_TRAINING)
  })

  it('laesst sich wiederholen, anders als ein Projekt', async () => {
    await unlockTraining()
    for (let i = 0; i < 2; i++) {
      h.resetRateLimits()
      expect((await h.post('/api/research/train', { creatureId: starterId(), stat: 'spe' }, token)).status).toBe(200)
      const [row] = running()
      finish(row!.id)
      h.resetRateLimits()
      await h.post('/api/research/collect', { id: row!.id }, token)
    }
    const c = h.ctx.db.prepare('SELECT ev_spe AS spe FROM creatures WHERE id = ?')
      .get(starterId()) as { spe: number }
    expect(c.spe).toBe(EV_PER_TRAINING * 2)
  })
})

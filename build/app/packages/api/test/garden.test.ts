import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { xpForLevel } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string

const user = { id: 111, first_name: 'Ash', language_code: 'de' }

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData(user) })
  token = auth.body.token
})
afterEach(async () => { await h.close() })

const pick = () => h.post('/api/starter', { speciesId: 'testmon' }, token)

describe('Starter', () => {
  it('meldet, dass noch keiner gewaehlt wurde', async () => {
    const r = await h.get('/api/starter', token)
    expect(r.body.needsStarter).toBe(true)
    // Ohne gewaehlte Region alles, was ueberhaupt zur Wahl steht.
    expect(r.body.options.map((o: any) => o.speciesId)).toEqual(['testmon', 'blattmon'])
  })

  it('legt Starter, Startausruestung und Dex-Eintrag an', async () => {
    const r = await pick()
    expect(r.status).toBe(200)
    expect(r.body.team).toHaveLength(1)
    expect(r.body.team[0].level).toBe(5)
    expect(r.body.team[0].teamSlot).toBe(0)
    expect(r.body.dex.caught).toBe(1)

    const bag = await h.get('/api/bag', token)
    const ids = bag.body.items.map((i: any) => i.id)
    expect(ids).toContain('poke-ball')
    expect(ids).toContain('oran-berry')
  })

  it('gibt dem Starter EP passend zu seinem Level', async () => {
    await pick()
    const g = await h.get('/api/garden', token)
    // Ohne passende EP wuerde die naechste EP-Gabe das Pokemon auf Level 1
    // zurueckwerfen. Level 5 bei medium_fast heisst 125 EP.
    expect(g.body.team[0].xp).toBe(125)
    expect(g.body.team[0].level).toBe(5)
  })

  it('verweigert einen zweiten Starter', async () => {
    await pick()
    const again = await pick()
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_started')
  })

  it('weist eine Art ab, die kein Starter ist', async () => {
    const r = await h.post('/api/starter', { speciesId: 'gibtsnicht' }, token)
    expect(r.status).toBe(400)
  })

  it('bietet nur Regionen an, deren erstes Gebiet ohne Vorbedingung offensteht', async () => {
    const r = await h.get('/api/starter', token)
    expect(r.body.regions.map((x: any) => x.regionId)).toEqual(['testland', 'hochland'])
    expect(r.body.regions[0]).toMatchObject({
      regionId: 'testland', areaId: 'test-route', areaCount: 2,
    })
    // Die Testhoehle verlangt Orden und Vorgaenger — sie taugt nicht als Anfang.
    expect(r.body.regions.map((x: any) => x.areaId)).not.toContain('test-cave')
  })

  it('bietet je Region ihre eigenen Starter an', async () => {
    const kanto = await h.get('/api/starter', token)
    expect(kanto.body.options.map((o: any) => o.speciesId)).toContain('testmon')

    const hoch = await h.get('/api/starter?regionId=hochland', token)
    expect(hoch.body.options.map((o: any) => o.speciesId)).toEqual(['blattmon'])

    // Und die Regionskarte zeigt sie schon vor der Wahl.
    const region = kanto.body.regions.find((r: any) => r.regionId === 'hochland')
    expect(region.starters.map((st: any) => st.speciesId)).toEqual(['blattmon'])
  })

  it('weist einen Starter ab, der nicht zur gewaehlten Region gehoert', async () => {
    const r = await h.post('/api/starter', { speciesId: 'testmon', regionId: 'hochland' }, token)
    expect(r.status).toBe(400)
    expect((await h.get('/api/starter', token)).body.needsStarter).toBe(true)
  })

  it('nimmt den regionseigenen Starter an', async () => {
    const r = await h.post('/api/starter', { speciesId: 'blattmon', regionId: 'hochland' }, token)
    expect(r.status).toBe(200)
    expect(r.body.team[0].speciesId).toBe('blattmon')
    expect((await h.get('/api/world', token)).body.currentAreaId).toBe('hoch-tal')
  })

  it('setzt den Trainer in die gewaehlte Startregion', async () => {
    const r = await h.post('/api/starter', { speciesId: 'testmon', regionId: 'testland' }, token)
    expect(r.status).toBe(200)
    const world = await h.get('/api/world', token)
    expect(world.body.currentAreaId).toBe('test-route')
  })

  it('weist eine Region ab, die kein Anfang ist', async () => {
    const r = await h.post('/api/starter', { speciesId: 'testmon', regionId: 'nirgendwo' }, token)
    expect(r.status).toBe(400)
    // Und der Starter ist auch nicht heimlich doch entstanden.
    expect((await h.get('/api/starter', token)).body.needsStarter).toBe(true)
  })

  it('gibt dem Starter Attacken', async () => {
    await pick()
    const g = await h.get('/api/garden', token)
    // Neueste zuerst: auf Level 5 kann Testmon Ruckzuckhieb, Heuler und Tackle.
    expect(g.body.team[0].moves).toEqual(['quick-attack', 'growl', 'tackle'])
    expect(g.body.team[0].moveNames).toContain('Tackle')
  })
})

describe('Garten', () => {
  beforeEach(async () => { await pick() })

  it('liefert berechnete Werte statt roher Zeilen', async () => {
    const g = await h.get('/api/garden', token)
    const c = g.body.team[0]
    expect(c.stats.hp).toBeGreaterThan(0)
    expect(c.power).toBeGreaterThan(0)
    expect(c.ivPercent).toBeGreaterThanOrEqual(0)
    expect(c.ivPercent).toBeLessThanOrEqual(100)
    expect(c.condition).toBeGreaterThanOrEqual(0)
    expect(c.types[0]).toMatchObject({ id: 'normal', name: 'Normal' })
    expect(c.displayName).toBe('Testmon')
  })

  it('zeigt Pflegeaktionen mit Verfuegbarkeit und Grund', async () => {
    const g = await h.get('/api/garden', token)
    expect(g.body.care.energyCost).toBeGreaterThan(0)
    expect(g.body.care.usedToday).toBe(0)
    expect(g.body.energy.current).toBeGreaterThan(0)
    const feed = g.body.care.actions.find((a: any) => a.action === 'feed')
    expect(feed.available).toBe(true)
    expect(feed.costItemId).toBe('oran-berry')
    expect(feed.have).toBe(8)
  })

  it('zaehlt Pflegeaktionen und verbraucht die Beere', async () => {
    const r = await h.post('/api/garden/care', { action: 'feed' }, token)
    expect(r.status).toBe(200)
    expect(r.body.garden.care.usedToday).toBe(1)
    expect(r.body.gained[0].xpGained).toBeGreaterThan(0)
    const feed = r.body.garden.care.actions.find((a: any) => a.action === 'feed')
    expect(feed.have).toBe(7)
  })

  it('gibt Freundschaft und meldet Levelaufstiege', async () => {
    const before = await h.get('/api/garden', token)
    const r = await h.post('/api/garden/care', { action: 'play' }, token)
    expect(r.body.gained[0].friendshipGained).toBe(9)
    expect(r.body.garden.team[0].friendship).toBe(before.body.team[0].friendship + 9)
  })

  it('kennt kein Tageslimit mehr, zieht aber Energie ab', async () => {
    const before = (await h.get('/api/garden', token)).body.energy.current
    for (let i = 0; i < 20; i++) {
      h.resetRateLimits(); h.resetPacing()
      expect((await h.post('/api/garden/care', { action: 'rest' }, token)).status).toBe(200)
    }
    const after = (await h.get('/api/garden', token)).body.energy.current
    expect(after).toBe(before - 20)
  })

  it('weist Pflege ab, wenn die Energie leer ist', async () => {
    h.ctx.db.prepare('UPDATE trainers SET energy = 0').run()
    const r = await h.post('/api/garden/care', { action: 'rest' }, token)
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('insufficient_energy')
  })

  it('weist Fuettern ohne Beeren ab', async () => {
    // Beeren wegverkaufen, dann fuettern wollen.
    await h.post('/api/shop/sell', { itemId: 'oran-berry', quantity: 8 }, token)
    const r = await h.post('/api/garden/care', { action: 'feed' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_items')
  })

  it('weist eine unbekannte Pflegeaktion ab', async () => {
    const r = await h.post('/api/garden/care', { action: 'tanzen' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('validation_failed')
  })
})

describe('Team und Box', () => {
  beforeEach(async () => { await pick() })

  it('nimmt ein Pokemon aus dem Team', async () => {
    const r = await h.post('/api/team', { creatureIds: [] }, token)
    expect(r.status).toBe(200)
    expect(r.body.team).toHaveLength(0)
    expect(r.body.boxCount).toBe(1)
  })

  it('legt es wieder ins Team zurueck', async () => {
    const box = await h.post('/api/team', { creatureIds: [] }, token)
    expect(box.body.boxCount).toBe(1)
    const inBox = await h.get('/api/box', token)
    const id = inBox.body.creatures[0].id
    const back = await h.post('/api/team', { creatureIds: [id] }, token)
    expect(back.body.team).toHaveLength(1)
    expect(back.body.team[0].teamSlot).toBe(0)
  })

  it('weist fremde Pokemon ab', async () => {
    const misty = await h.addTrainer(222, 'Misty')
    const hers = (await h.post('/api/starter', { speciesId: 'testmon' }, misty.token)).body.team[0].id
    // Es gibt dieses Pokemon — es gehoert nur jemand anderem. Vorher stand
    // hier eine erfundene Id, weil ein zweiter Trainer eine Einladung
    // brauchte; die Antwort war 404, und der eigentliche Fall blieb ungeprueft.
    const r = await h.post('/api/team', { creatureIds: [hers] }, token)
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('not_owner')
  })

  it('weist doppelte Eintraege ab', async () => {
    const g = await h.get('/api/garden', token)
    const id = g.body.team[0].id
    const r = await h.post('/api/team', { creatureIds: [id, id] }, token)
    expect(r.status).toBe(400)
    expect(r.body.detail.reason).toBe('duplicate_ids')
  })

  it('begrenzt das Team auf fuenf', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`)
    const r = await h.post('/api/team', { creatureIds: ids }, token)
    expect(r.status).toBe(400)
  })
})

describe('Shop', () => {
  beforeEach(async () => { await pick() })

  it('listet kaufbare Artikel mit Bestand', async () => {
    const r = await h.get('/api/shop', token)
    expect(r.body.gold).toBe(500)
    const balls = r.body.sections.find((s: any) => s.category === 'ball')
    expect(balls.items[0].id).toBe('poke-ball')
    expect(balls.items[0].owned).toBe(10)
  })

  it('kauft und zieht Gold ab', async () => {
    const r = await h.post('/api/shop/buy', { itemId: 'poke-ball', quantity: 3 }, token)
    expect(r.status).toBe(200)
    expect(r.body.gold).toBe(500 - 90)
    const balls = r.body.sections.find((s: any) => s.category === 'ball')
    expect(balls.items[0].owned).toBe(13)
  })

  it('verweigert einen Kauf ohne genug Gold', async () => {
    const r = await h.post('/api/shop/buy', { itemId: 'poke-ball', quantity: 99 }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_funds')
    const bag = await h.get('/api/bag', token)
    expect(bag.body.gold).toBe(500)
  })

  it('verkauft und schreibt Gold gut', async () => {
    const r = await h.post('/api/shop/sell', { itemId: 'poke-ball', quantity: 2 }, token)
    expect(r.body.gold).toBe(500 + 30)
  })

  it('verweigert den Verkauf von mehr, als man hat', async () => {
    const r = await h.post('/api/shop/sell', { itemId: 'poke-ball', quantity: 99 }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_items')
  })

  it('weist unbekannte Artikel ab', async () => {
    const r = await h.post('/api/shop/buy', { itemId: 'einhorn', quantity: 1 }, token)
    expect(r.status).toBe(404)
  })
})

describe('Pokedex', () => {
  it('zeigt alle Arten, den Starter als gefangen', async () => {
    await pick()
    const r = await h.get('/api/dex', token)
    expect(r.body.rows).toHaveLength(h.ctx.registry.speciesCount)
    expect(r.body.rows.find((x: any) => x.speciesId === 'testmon'))
      .toMatchObject({ caught: true, owned: 1 })
    expect(r.body.rows.filter((x: any) => x.caught)).toHaveLength(1)
    expect(r.body.counts).toEqual({ seen: 1, caught: 1, total: h.ctx.registry.speciesCount })
  })
})

describe('Ereignis-Wesen', () => {
  it('zaehlt nicht in die Pokedex-Summe', async () => {
    await pick()
    const dex = await h.get('/api/dex', token)
    const all = h.ctx.registry.allSpecies.length
    // Die Ereignis-Art faellt aus der Summe heraus, alle anderen bleiben drin.
    expect(dex.body.counts.total).toBe(all - 1)
    expect(dex.body.rows.some((r: any) => r.speciesId === 'festmon')).toBe(false)
  })

  it('braucht doppelt so viele EP je Aufstieg', async () => {
    await pick()
    /*
     * Zwei gleich starke Pokemon nebeneinander, eines davon die Ereignis-Art.
     * Gleiches Level, gleiche Werte, gleiche Aktion — der einzige Unterschied
     * ist der EP-Faktor, und der halbiert den Gewinn.
     */
    const trainerId = (h.ctx.db.prepare('SELECT id FROM trainers LIMIT 1').get() as { id: string }).id
    const add = (speciesId: string, slot: number) => {
      const id = crypto.randomUUID()
      // EP passend zum Level einsetzen: mit 0 EP auf Level 30 meldet die erste
      // Pflege die *Korrektur* als Gewinn, nicht den Gewinn.
      const xp = xpForLevel('medium_fast', 30)
      h.ctx.db.prepare(
        `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
           iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
           shiny, moves, caught_at, team_slot)
         VALUES (?, ?, ?, ?, 30, 'hardy', 31,31,31,31,31,31, 0, 100, 30, 0, '["tackle"]', ?, ?)`,
      ).run(id, trainerId, speciesId, xp, Date.now(), slot)
      return id
    }
    // Der Starter aus `pick()` steht auf Slot 0 — diese beiden daneben.
    const eventId = add('festmon', 1)
    const plainId = add('wildmon', 2)

    h.resetRateLimits()
    const care = await h.post('/api/garden/care', { action: 'rest' }, token)
    expect(care.status).toBe(200)
    const evGain = care.body.gained.find((g: any) => g.creatureId === eventId).xpGained
    const normal = care.body.gained.find((g: any) => g.creatureId === plainId).xpGained
    expect(evGain).toBeGreaterThan(0)
    expect(evGain).toBeCloseTo(normal / 2, -1)
  })

  it('laedt eingelagerte Pokemon schneller auf als das Team', async () => {
    await pick()
    const trainerId = (h.ctx.db.prepare('SELECT id FROM trainers LIMIT 1').get() as { id: string }).id
    const add = (slot: number | null) => {
      const id = crypto.randomUUID()
      h.ctx.db.prepare(
        `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
           iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
           shiny, moves, caught_at, team_slot)
         VALUES (?, ?, 'wildmon', 0, 5, 'hardy', 15,15,15,15,15,15, 0, 0, 20, 0, '["tackle"]', ?, ?)`,
      ).run(id, trainerId, Date.now(), slot)
      return id
    }
    const inTeam = add(1)
    const inBox = add(null)

    /*
     * Zwei Stunden abwesend — die Aufholrechnung laeuft beim naechsten Blick
     * in den Garten.
     *
     * Gestellt wird die eigene Uhr der Erholung, nicht mehr `last_seen_at`:
     * das ist derselbe Zeitstempel, den *jede* Anfrage neu setzt, und daran
     * hing der Fehler, bei dem eingelagerte Pokemon tagelang stehenblieben.
     */
    h.ctx.db.prepare('UPDATE trainers SET box_energy_at = ?, team_energy_at = ? WHERE id = ?')
      .run(Date.now() - 2 * 3_600_000, Date.now() - 2 * 3_600_000, trainerId)
    h.resetRateLimits()
    expect((await h.get('/api/garden', token)).status).toBe(200)

    const energyOf = (id: string) =>
      (h.ctx.db.prepare('SELECT energy FROM creatures WHERE id = ?').get(id) as { energy: number }).energy
    // Im Team zwei Stunden zu je sechs; in der Box laengst voll.
    expect(energyOf(inTeam)).toBe(12)
    expect(energyOf(inBox)).toBe(100)
  })
})

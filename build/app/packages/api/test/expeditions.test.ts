import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PARTY } from '@game/engine'
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

const teamId = async () => (await h.get('/api/garden', token)).body.team[0].id

/** Zeit vorspulen, indem die Endzeit in die Vergangenheit gelegt wird. */
function finishNow(expeditionId: string) {
  h.ctx.db.prepare('UPDATE expeditions SET ends_at = ? WHERE id = ?').run(Date.now() - 1000, expeditionId)
}

describe('Expeditionen', () => {
  it('bietet Arten, Dauern und verfuegbare Pokemon an', async () => {
    const r = await h.get('/api/expeditions', token)
    expect(r.status).toBe(200)
    expect(r.body.kinds.length).toBeGreaterThanOrEqual(4)
    expect(r.body.durations.map((d: any) => d.id)).toEqual(['short', 'medium', 'long'])
    expect(r.body.available).toHaveLength(1)
    expect(r.body.open).toHaveLength(0)
  })

  it('startet eine Expedition und zieht Energie ab', async () => {
    const id = await teamId()
    const before = (await h.get('/api/garden', token)).body.team[0].energy
    const r = await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: [id] }, token)
    expect(r.status).toBe(200)
    expect(r.body.expedition.ready).toBe(false)
    expect(r.body.expedition.members[0].id).toBe(id)
    const after = (await h.get('/api/garden', token)).body.team[0].energy
    expect(after).toBeLessThan(before)
  })

  it('sperrt Pokemon, die schon unterwegs sind', async () => {
    const id = await teamId()
    await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: [id] }, token)
    const again = await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: [id] }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_away')
    const list = await h.get('/api/expeditions', token)
    expect(list.body.available.map((c: any) => c.id)).not.toContain(id)
  })

  it('weist zu erschoepfte Pokemon ab', async () => {
    const id = await teamId()
    h.ctx.db.prepare('UPDATE creatures SET energy = 1 WHERE id = ?').run(id)
    const r = await h.post('/api/expeditions', { kind: 'patrol', duration: 'long', creatureIds: [id] }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('too_tired')
  })

  it('weist fremde Pokemon ab', async () => {
    const r = await h.post('/api/expeditions', {
      kind: 'patrol', duration: 'short', creatureIds: ['00000000-0000-4000-8000-000000000000'],
    }, token)
    expect(r.status).toBe(404)
  })

  it('laesst so viele gleichzeitig zu, wie Plaetze da sind', async () => {
    // Drei zusaetzliche Pokemon, damit jede Expedition ein eigenes bekommt.
    for (let i = 0; i < 4; i++) {
      h.ctx.db.prepare(
        `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
           iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
         VALUES (?, ?, 'wildmon', 0, 10, 'hardy', 20,20,20,20,20,20, 70, 100, 30, 0, '["tackle"]', ?, NULL)`,
      ).run(crypto.randomUUID(), trainerId, Date.now())
    }
    const available = (await h.get('/api/expeditions', token)).body.available
    /*
     * Drei — und der vierte prallt ab.
     *
     * Frueher stand hier "vier gleichzeitig, frueher war bei drei Schluss":
     * die Grenze war irgendwann entfallen, und damit war die einzige Schranke
     * die Zahl der eigenen Pokemon. Wer zweihundert hatte, schickte zwanzig
     * Trupps los.
     */
    for (let i = 0; i < 3; i++) {
      h.resetRateLimits()
      const r = await h.post('/api/expeditions', {
        kind: 'patrol', duration: 'short', creatureIds: [available[i].id],
      }, token)
      expect(r.status).toBe(200)
    }
    expect((await h.get('/api/expeditions', token)).body.open).toHaveLength(3)
    h.resetRateLimits()
    const vierte = await h.post('/api/expeditions', {
      kind: 'patrol', duration: 'short', creatureIds: [available[3].id],
    }, token)
    expect(vierte.status).toBe(409)
    expect(vierte.body.detail.reason).toBe('no_slot')
  })

  it('verweigert das Einsammeln vor Ablauf', async () => {
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'patrol', duration: 'long', creatureIds: [id] }, token)
    const r = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_ready')
  })

  it('zahlt Beute, Gold und EP aus', async () => {
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'patrol', duration: 'medium', creatureIds: [id] }, token)
    finishNow(start.body.expedition.id)

    const goldBefore = (await h.get('/api/bag', token)).body.gold
    const r = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.loot.length).toBeGreaterThan(0)
    expect(r.body.result.gold).toBeGreaterThan(0)
    expect(r.body.result.xpPerMember).toBeGreaterThan(0)
    const goldAfter = (await h.get('/api/bag', token)).body.gold
    expect(goldAfter).toBe(goldBefore + r.body.result.gold)
    expect(r.body.overview.open).toHaveLength(0)
  })

  it('laesst sich nicht zweimal einsammeln', async () => {
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: [id] }, token)
    finishNow(start.body.expedition.id)
    expect((await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)).status).toBe(200)
    const second = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('already_collected')
  })

  it('liefert bei gleicher Expedition immer dasselbe Ergebnis', async () => {
    // Das Ergebnis wird beim Start durch den Seed festgelegt; spaeter oder
    // frueher einsammeln darf daran nichts aendern.
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: [id] }, token)
    finishNow(start.body.expedition.id)
    const first = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)

    h.ctx.db.prepare('UPDATE expeditions SET collected_at = NULL WHERE id = ?').run(start.body.expedition.id)
    const again = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(again.body.result.gold).toBe(first.body.result.gold)
    expect(again.body.result.loot).toEqual(first.body.result.loot)
  })

  it('laesst nur passende Typen mit', async () => {
    // Testmon ist Normal und gehoert damit auf die Streife, nicht ins
    // Unterholz. Die Sperre ersetzt den frueheren Bonus: vorher durfte jeder
    // ueberall hin und passende Typen bekamen 1,4x.
    const id = await teamId()
    const r = await h.post('/api/expeditions', { kind: 'forage', duration: 'short', creatureIds: [id] }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('wrong_type')
  })

  it('sagt in der Uebersicht, wer wohin darf', async () => {
    const r = await h.get('/api/expeditions', token)
    // Normal steht nur bei der Streife.
    expect(r.body.available[0].fitsKinds).toEqual(['patrol'])
  })

  it('nennt vorab, was ungefaehr herauskommt', async () => {
    const r = await h.get('/api/expeditions', token)
    const long = r.body.expected.find((e: any) => e.kindId === 'patrol' && e.durationId === 'long')
    const short = r.body.expected.find((e: any) => e.kindId === 'patrol' && e.durationId === 'short')
    expect(long.gold).toBeGreaterThan(short.gold)
    // Die Vorschau kommt aus derselben Tabelle wie die Aufloesung; steht dort
    // ein Ball, muss er auch hier stehen.
    expect(long.loot.map((l: any) => l.itemId)).toContain('poke-ball')
    expect(long.loot[0].quantity).toBeGreaterThan(short.loot[0].quantity)
  })

  it('weist eine unbekannte Art ab', async () => {
    const id = await teamId()
    const r = await h.post('/api/expeditions', { kind: 'raumfahrt', duration: 'short', creatureIds: [id] }, token)
    expect(r.status).toBe(400)
  })
})

describe('Vorziehen', () => {
  const startShort = async () => {
    const creature = await teamId()
    h.resetRateLimits()
    return h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: [creature] }, token)
  }

  it('kostet Energie und macht die Expedition sofort fertig', async () => {
    const started = await startShort()
    const id = started.body.expedition.id
    h.resetRateLimits()
    const overview = await h.get('/api/expeditions', token)
    const cost = overview.body.open.find((e: any) => e.id === id).rushCost
    // 30 Minuten zu zehn Minuten je Punkt.
    expect(cost).toBe(3)

    const before = (await h.get('/api/energy', token)).body.state.current
    h.resetRateLimits()
    const r = await h.post('/api/expeditions/rush', { id }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.cost).toBe(3)
    expect(r.body.overview.open.find((e: any) => e.id === id).ready).toBe(true)
    expect(r.body.energy.current).toBe(before - 3)

    // Und sie laesst sich sofort einsammeln.
    h.resetRateLimits()
    expect((await h.post('/api/expeditions/collect', { id }, token)).status).toBe(200)
  })

  it('laesst sich nicht zweimal vorziehen', async () => {
    const started = await startShort()
    const id = started.body.expedition.id
    h.resetRateLimits()
    await h.post('/api/expeditions/rush', { id }, token)
    h.resetRateLimits()
    const again = await h.post('/api/expeditions/rush', { id }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_ready')
  })
})

describe('Truppgröße', () => {
  /*
   * Weitere Pokemon in der Box anlegen.
   *
   * Bewusst nicht im Team: das fasst fuenf, eine Expedition nimmt sechs. Wer
   * sechs losschickt, schickt also mindestens eines aus der Kiste — genau der
   * Fall, der gemeldet wurde.
   */
  const addMember = () => {
    const trainerId = (h.ctx.db.prepare('SELECT id FROM trainers LIMIT 1').get() as { id: string }).id
    const id = crypto.randomUUID()
    h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
         shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'wildmon', 0, 5, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, NULL)`,
    ).run(id, trainerId, Date.now())
    return id
  }

  it('nimmt so viele Pokemon an, wie die Oberflaeche verspricht', async () => {
    // Gemeldet: "Wähle 1 bis 6 Pokémon" und dann "Diese Eingabe passt nicht".
    // Die Route klemmte bei drei, Engine und Oberflaeche erlaubten sechs.
    const ids = [await teamId()]
    for (let i = 1; i < MAX_PARTY; i++) ids.push(addMember())
    h.resetRateLimits()
    const r = await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: ids }, token)
    expect(r.status).toBe(200)
    expect(r.body.expedition.members).toHaveLength(MAX_PARTY)
  })

  it('weist mehr als die Hoechstzahl ab', async () => {
    const ids = [await teamId()]
    for (let i = 1; i <= MAX_PARTY; i++) ids.push(addMember())
    h.resetRateLimits()
    expect((await h.post('/api/expeditions', { kind: 'patrol', duration: 'short', creatureIds: ids }, token)).status)
      .toBe(400)
  })
})

describe('Platzgrenze', () => {
  const starten = async () => {
    const frei = (await h.get('/api/expeditions', token)).body.available
      .find((c: any) => c.fitsKinds.includes('patrol'))
    h.resetRateLimits()
    return h.post('/api/expeditions', { kind: 'patrol', duration: 'long', creatureIds: [frei.id] }, token)
  }

  it('laesst nur drei gleichzeitig zu', async () => {
    /*
     * Vorher war es unbegrenzt, und die einzige Schranke war die Zahl der
     * eigenen Pokemon: wer zweihundert hatte, schickte zwanzig Trupps
     * gleichzeitig los. Im Spielstand nachgezaehlt standen 20 offene gegen 4
     * und 2 bei den anderen.
     */
    const { EXPEDITION_SLOTS_BASE } = await import('@game/engine')
    for (let i = 0; i < EXPEDITION_SLOTS_BASE; i++) {
      // Genug Pokemon in die Box legen, damit nicht die Truppe der Engpass ist.
      const id = crypto.randomUUID()
      h.ctx.db.prepare(
        `INSERT INTO creatures (id, owner_id, species_id, level, xp, nature, shiny,
           iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe,
           hp_current, friendship, energy, caught_at, moves)
         VALUES (?, ?, 'testmon', 20, 0, 'hardy', 0, 15,15,15,15,15,15, 0,0,0,0,0,0, 50, 70, 100, ?, ?)`,
      ).run(id, trainerId, Date.now(), JSON.stringify([{ moveId: 'tackle', pp: 35 }]))
    }
    h.ctx.db.prepare('UPDATE trainers SET energy = 500 WHERE id = ?').run(trainerId)

    for (let i = 0; i < EXPEDITION_SLOTS_BASE; i++) {
      expect((await starten()).status).toBe(200)
    }
    const zuviel = await starten()
    expect(zuviel.status).toBe(409)
    expect(zuviel.body.detail.reason).toBe('no_slot')
    expect(zuviel.body.detail.max).toBe(EXPEDITION_SLOTS_BASE)
  })

  it('nennt die Grenze in der Uebersicht', async () => {
    const { EXPEDITION_SLOTS_BASE } = await import('@game/engine')
    const r = await h.get('/api/expeditions', token)
    expect(r.body.maxOpen).toBe(EXPEDITION_SLOTS_BASE)
  })

  it('hebt sie mit dem Expeditionsbuero', async () => {
    const { EXPEDITION_SLOTS_BASE, EXPEDITION_SLOTS_MAX, expeditionSlots } = await import('@game/engine')
    h.ctx.db.prepare(
      `INSERT INTO buildings (trainer_id, building_id, level, built_at) VALUES (?, 'expedition-office', 4, ?)
       ON CONFLICT(trainer_id, building_id) DO UPDATE SET level = 4`,
    ).run(trainerId, Date.now())
    h.resetRateLimits()
    expect((await h.get('/api/expeditions', token)).body.maxOpen).toBe(EXPEDITION_SLOTS_BASE + 4)
    // Und nie ueber neun: darueber ist nicht die Zahl der Plaetze der Engpass.
    expect(expeditionSlots(99)).toBe(EXPEDITION_SLOTS_MAX)
  })
})

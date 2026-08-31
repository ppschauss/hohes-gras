import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SHINY_CHAIN_AFTER_CATCH, SHINY_CHAIN_GUARANTEE } from '@game/engine'
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
  // Baelle fuer die Safari
  await h.post('/api/shop/buy', { itemId: 'poke-ball', quantity: 5 }, token)
})
afterEach(async () => { await h.close() })

/** Direkt in der DB fangen, um Freischaltbedingungen zu erfuellen, ohne von
 *  der Zufallslogik der Safari abzuhaengen. */
function seedCatch(speciesId: string, areaId: string, level = 12) {
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
       shiny, moves, caught_at, caught_area_id, team_slot)
     VALUES (?, ?, ?, 0, ?, 'hardy', 20,20,20,20,20,20, 70, 100, 30, 0, '["tackle"]', ?, ?, NULL)`,
  ).run(crypto.randomUUID(), trainerId, speciesId, level, Date.now(), areaId)
  // Ein Fang steht auch im Dex — daran haengen jetzt die Gebietsbedingungen.
  h.ctx.db.prepare(
    `INSERT INTO dex_entries (trainer_id, species_id, seen_at, caught_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, species_id) DO UPDATE SET caught_at = COALESCE(dex_entries.caught_at, excluded.caught_at)`,
  ).run(trainerId, speciesId, Date.now(), Date.now())
}

describe('Weltkarte', () => {
  it('zeigt Regionen und Gebiete in Reihenfolge', async () => {
    const r = await h.get('/api/world', token)
    expect(r.status).toBe(200)
    expect(r.body.regions).toHaveLength(2)
    const areas = r.body.regions[0].areas
    expect(areas.map((a: any) => a.id)).toEqual(['test-route', 'test-cave'])
  })

  it('oeffnet das Startgebiet ohne Bedingungen', async () => {
    const r = await h.get('/api/world', token)
    const route = r.body.regions[0].areas[0]
    expect(route.unlocked).toBe(true)
    expect(route.requirements).toHaveLength(0)
  })

  it('nennt jede unerfuellte Bedingung mit Ist- und Sollwert', async () => {
    const r = await h.get('/api/world', token)
    const cave = r.body.regions[0].areas[1]
    expect(cave.unlocked).toBe(false)
    const kinds = cave.requirements.map((q: any) => q.kind)
    expect(kinds).toContain('dex_caught')
    expect(kinds).toContain('creatures_at_level')
    expect(kinds).toContain('badges')
    const caught = cave.requirements.find((q: any) => q.kind === 'dex_caught')
    /*
     * Bei null, nicht bei eins.
     *
     * Gezaehlt werden Arten *dieser Region* — und der Starter ist ein
     * Geschenk, das in keiner Spawn-Tabelle steht. Genau so war es gemeint:
     * "wuerde er als Fang im Startgebiet zaehlen, waere die erste
     * Freischaltbedingung schon vor dem ersten Wurf teilweise erfuellt."
     */
    expect(caught).toMatchObject({ met: false, have: 0, need: 2 })
  })

  it('verschiebt die Levelforderung mit dem Gebiet', async () => {
    /*
     * Das Hochland ist weit oben entworfen; wer dort anfaengt, spielt es
     * heruntergerechnet. Eine Bedingung, die auf dem Entwurfslevel stehen
     * bleibt, waere in dieser Region unerfuellbar — im echten Pack verlangte
     * die Granitgrotte vier Pokemon ab Level 104 bei einer Reisegrenze von 100.
     */
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('hoch-tal', trainerId)
    h.resetRateLimits()
    const r = await h.get('/api/world', token)
    const gipfel = r.body.regions[1].areas[1]
    const req = gipfel.requirements.find((q: any) => q.kind === 'creatures_at_level')
    expect(req).toBeDefined()
    // Entworfen fuer Level 80, gefordert auf dem Niveau, auf dem man spielt.
    expect(Number(req.label)).toBeLessThan(40)
    expect(Number(req.label)).toBeGreaterThan(0)
  })

  it('zaehlt fuer eine Region nur ihre eigenen Arten', async () => {
    /*
     * Gemeldet: mit Hoenn als Startregion verlangte das zweite Gebiet 150
     * Dex-Eintraege — die Zahl, die jemand mitbringt, der Kanto hinter sich
     * hat. Wer dort anfaengt, kaeme nie los.
     */
    const gate = async () => {
      h.resetRateLimits()
      const r = await h.get('/api/world', token)
      const gipfel = r.body.regions[1].areas[1]
      return gipfel.requirements.find((q: any) => q.kind === 'dex_caught')
    }

    // Blattmon gibt es nur im Testland; fuer das Hochland zaehlt es nicht.
    seedCatch('blattmon', 'test-route', 4)
    expect(await gate()).toMatchObject({ met: false, have: 0, need: 1 })

    // Wildmon steht in beiden Tabellen und zaehlt hier wie dort.
    seedCatch('wildmon', 'test-route', 12)
    expect(await gate()).toMatchObject({ met: true, have: 1, need: 1 })
  })

  it('schaltet frei, sobald alle Bedingungen erfuellt sind', async () => {
    seedCatch('wildmon', 'test-route', 12)
    seedCatch('nachtmon', 'test-route', 12)
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(trainerId, 'test-badge', Date.now())
    const r = await h.get('/api/world', token)
    const cave = r.body.regions[0].areas[1]
    expect(cave.requirements.every((q: any) => q.met)).toBe(true)
    expect(cave.unlocked).toBe(true)
  })

  it('zaehlt nur verschiedene Arten pro Gebiet', async () => {
    seedCatch('wildmon', 'test-route')
    seedCatch('wildmon', 'test-route')
    const r = await h.get('/api/world', token)
    expect(r.body.regions[0].areas[0].caughtHere).toBe(1)
  })

  it('meldet, was gerade spawnen kann', async () => {
    const r = await h.get('/api/world', token)
    const route = r.body.regions[0].areas[0]
    expect(route.speciesHere).toBe(4)
    // Nachtmon nur nachts; die anderen drei immer.
    expect(route.spawnableNow).toBeGreaterThanOrEqual(3)
    expect(route.spawnableNow).toBeLessThanOrEqual(4)
  })
})

describe('Reisen', () => {
  it('erlaubt das Startgebiet', async () => {
    const r = await h.post('/api/world/travel', { areaId: 'test-route' }, token)
    expect(r.status).toBe(200)
    expect(r.body.currentAreaId).toBe('test-route')
  })

  it('verweigert ein gesperrtes Gebiet und nennt die Gruende', async () => {
    const r = await h.post('/api/world/travel', { areaId: 'test-cave' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('area_locked')
    expect(r.body.detail.requirements.length).toBeGreaterThan(0)
  })

  it('weist ein unbekanntes Gebiet ab', async () => {
    expect((await h.post('/api/world/travel', { areaId: 'atlantis' }, token)).status).toBe(404)
  })

  it('laesst ein einmal betretenes Gebiet offen, auch wenn die Bedingungen steigen', async () => {
    /*
     * Die Bedingungen werden bei jedem Aufruf neu gerechnet, nicht einmal
     * vermerkt. Ohne diese Regel sperrt jede spaetere Aenderung am Pack
     * Spieler aus Gebieten aus, die sie laengst offen hatten — beim
     * Geraderuecken der geforderten Pokemon-Zahlen waere genau das passiert.
     */
    expect((await h.post('/api/world/travel', { areaId: 'test-route' }, token)).status).toBe(200)

    // Die Huerde nachtraeglich hochziehen, so wie es eine Packaenderung taete.
    const gebiet = h.ctx.registry.area('test-route')
    ;(gebiet.unlock as { minCreaturesAtLevel: unknown }).minCreaturesAtLevel = { count: 99, level: 99 }

    const karte = await h.get('/api/world', token)
    const sicht = karte.body.regions
      .flatMap((r: { areas: Array<{ id: string; unlocked: boolean; visited: boolean }> }) => r.areas)
      .find((a: { id: string }) => a.id === 'test-route')
    expect(sicht.visited).toBe(true)
    expect(sicht.unlocked).toBe(true)

    expect((await h.post('/api/world/travel', { areaId: 'test-route' }, token)).status).toBe(200)
  })
})

describe('Safari', () => {
  /*
   * Erkunden, bis wirklich eine Begegnung dabei ist.
   *
   * Seit es Fundstuecke und Streuner gibt, ist die Begegnung nicht mehr der
   * einzige Ausgang: mit je drei Prozent kommt etwas anderes heraus. Diese
   * Tests pruefen die Begegnung und nicht die Verteilung — sie wuerfeln
   * deshalb weiter, statt gelegentlich zufaellig durchzufallen.
   */
  const explore = async (body: Record<string, unknown> = {}) => {
    for (let i = 0; i < 40; i++) {
      h.resetRateLimits()
      h.resetPacing()
      const r = await h.post('/api/safari/explore', body, token)
      if (r.status !== 200 || r.body.kind === 'encounter') return r
    }
    throw new Error('keine Begegnung nach 40 Erkundungen')
  }

  it('findet ein Pokemon und legt eine Begegnung an', async () => {
    const r = await explore({ ballId: 'poke-ball', berryId: null })
    expect(r.status).toBe(200)
    expect(r.body.kind).toBe('encounter')
    expect(r.body.legendary).toBe(false)
    expect(r.body.encounter.speciesId).toBeTruthy()
    expect(r.body.encounter.probability).toBeGreaterThan(0)
    expect(r.body.encounter.probability).toBeLessThanOrEqual(0.95)
  })

  it('haelt genau eine Begegnung offen', async () => {
    await explore({})
    const first = (await h.get('/api/safari', token)).body.encounter.speciesId
    await explore({})
    const rows = h.ctx.db.prepare('SELECT COUNT(*) n FROM active_encounter WHERE trainer_id = ?').get(trainerId) as any
    expect(rows.n).toBe(1)
    expect(first).toBeTruthy()
  })

  it('traegt die Art sofort als gesehen in den Dex ein', async () => {
    const r = await explore({})
    const dex = await h.get('/api/dex', token)
    const row = dex.body.rows.find((x: any) => x.speciesId === r.body.encounter.speciesId)
    expect(row.seen).toBe(true)
    expect(row.caught).toBe(false)
  })

  it('erhoeht die Fangchance mit Beruhigen', async () => {
    const start = await explore({})
    const before = start.body.encounter.probability
    const after = await h.post('/api/safari/soften', { action: 'calm' }, token)
    expect(after.body.probability).toBeGreaterThan(before)
    expect(after.body.calmStacks).toBe(1)
  })

  it('deckelt Beruhigen bei der Obergrenze', async () => {
    await explore({})
    await h.post('/api/safari/soften', { action: 'calm' }, token)
    await h.post('/api/safari/soften', { action: 'calm' }, token)
    const third = await h.post('/api/safari/soften', { action: 'calm' }, token)
    expect(third.status).toBe(409)
    expect(third.body.detail.reason).toBe('already_maxed')
  })

  it('erhoeht die Fangchance mit einem besseren Ball', async () => {
    const buy = await h.post('/api/shop/buy', { itemId: 'great-ball', quantity: 1 }, token)
    expect(buy.status).toBe(200)
    const plain = await explore({ ballId: 'poke-ball' })
    const better = await h.get('/api/safari?ballId=great-ball', token)
    expect(better.body.encounter.probability).toBeGreaterThan(plain.body.encounter.probability)
  })

  it('verbraucht beim Werfen einen Ball', async () => {
    await explore({})
    const before = (await h.get('/api/bag', token)).body.items.find((i: any) => i.id === 'poke-ball').quantity
    await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
    const after = (await h.get('/api/bag', token)).body.items.find((i: any) => i.id === 'poke-ball').quantity
    expect(after).toBe(before - 1)
  })

  it('weist einen Wurf ohne Baelle ab', async () => {
    await explore({})
    h.ctx.db.prepare('UPDATE inventory SET quantity = 0 WHERE trainer_id = ? AND item_id = ?')
      .run(trainerId, 'poke-ball')
    const r = await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_items')
  })

  it('weist einen Wurf ohne Begegnung ab', async () => {
    const r = await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('no_encounter')
  })

  it('legt bei Erfolg ein Pokemon an und schliesst die Begegnung', async () => {
    // Superbaelle direkt gutschreiben statt kaufen: 40 Stueck kosten mehr Gold,
    // als ein neuer Trainer besitzt, und der Fangtest soll den Fang pruefen,
    // nicht die Kaufkraft.
    h.ctx.db.prepare(
      `INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, 'great-ball', 40)
       ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = 40`,
    ).run(trainerId)
    let caught: any = null
    for (let i = 0; i < 40 && !caught; i++) {
      h.resetRateLimits()
      await explore({})
      const r = await h.post('/api/safari/throw', { ballId: 'great-ball' }, token)
      if (r.body.caught) caught = r.body
    }
    expect(caught).toBeTruthy()
    expect(caught.creature.id).toBeTruthy()
    expect(caught.reward.gold).toBeGreaterThan(0)
    expect(caught.chain).toBeGreaterThanOrEqual(1)
    const active = h.ctx.db.prepare('SELECT COUNT(*) n FROM active_encounter WHERE trainer_id = ?').get(trainerId) as any
    expect(active.n).toBe(0)
  })

  it('beendet die Begegnung beim Fliehen', async () => {
    await explore({})
    await h.post('/api/safari/flee', {}, token)
    const r = await h.get('/api/safari', token)
    expect(r.body.encounter).toBeNull()
  })

  it('weist einen unbekannten Ball ab', async () => {
    await explore({})
    const r = await h.post('/api/safari/throw', { ballId: 'oran-berry' }, token)
    expect(r.status).toBe(400)
    expect(r.body.detail.field).toBe('ballId')
  })
})

describe('Schon gefangen', () => {
  it('markiert eine Begegnung, deren Art bereits im Dex liegt', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
      .run('test-route', trainerId)
    h.ctx.db.prepare(
      `INSERT OR REPLACE INTO active_encounter
         (trainer_id, area_id, species_id, level, shiny, turn, weaken_stacks, calm_stacks,
          seed, started_at, legendary_berries)
       VALUES (?, 'test-route', 'wildmon', 5, 0, 0, 0, 0, 'seed', ?, 0)`,
    ).run(trainerId, Date.now())

    h.resetRateLimits()
    expect((await h.get('/api/safari?ballId=poke-ball', token)).body.encounter.caught).toBe(false)

    h.ctx.db.prepare(
      'INSERT OR REPLACE INTO dex_entries (trainer_id, species_id, seen_at, caught_at) VALUES (?, ?, ?, ?)',
    ).run(trainerId, 'wildmon', Date.now(), Date.now())

    h.resetRateLimits()
    expect((await h.get('/api/safari?ballId=poke-ball', token)).body.encounter.caught).toBe(true)
  })
})


describe('Fangserie', () => {
  it('faellt nach einem schillernden Fang auf die Zehn-Prozent-Marke', async () => {
    /*
     * Vorher lief sie weiter: wer einmal bei 49 stand, fing ab da *jedes*
     * Exemplar dieser Art schillernd — die Jagd war nach dem ersten Treffer
     * vorbei.
     */
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
      .run('test-route', trainerId)
    h.ctx.db.prepare(
      `INSERT INTO catch_chains (trainer_id, species_id, streak, updated_at) VALUES (?, 'wildmon', ?, ?)
       ON CONFLICT(trainer_id, species_id) DO UPDATE SET streak = excluded.streak`,
    ).run(trainerId, SHINY_CHAIN_GUARANTEE, Date.now())

    // Die Begegnung wird gesetzt statt erwuerfelt: der Weg dorthin ist
    // anderswo geprueft, hier zaehlt nur, was das Fangen mit der Serie macht.
    h.ctx.db.prepare(
      `INSERT INTO active_encounter
         (trainer_id, area_id, species_id, level, shiny, turn, weaken_stacks, calm_stacks, seed, started_at)
       VALUES (?, 'test-route', 'wildmon', 5, 1, 0, 0, 0, 'seed-shiny', ?)`,
    ).run(trainerId, Date.now())

    let caught = false
    for (let i = 0; i < 60 && !caught; i++) {
      h.resetRateLimits()
      const r = await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
      caught = r.body.caught === true
      if (r.body.encounter === null && !caught) break
    }
    expect(caught).toBe(true)

    const chain = h.ctx.db
      .prepare('SELECT streak FROM catch_chains WHERE trainer_id = ? AND species_id = ?')
      .get(trainerId, 'wildmon') as { streak: number }
    expect(chain.streak).toBe(SHINY_CHAIN_AFTER_CATCH)
    expect(chain.streak).toBeLessThan(SHINY_CHAIN_GUARANTEE)
  })
})

describe('Weltuhr', () => {
  it('nennt, wann die Tageszeit und das Wetter wechseln', async () => {
    /*
     * Seit die Gebietsliste "nur nachts" und "nur bei Regen" anzeigt, ist die
     * naechste Aenderung eine Auskunft, nach der man plant. Beides ist
     * berechenbar — also wird es berechnet.
     */
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    const r = await h.get('/api/area/spawns', token)
    const clock = r.body.clock
    expect(clock.nextTimeOfDayAt).toBeGreaterThan(Date.now())
    expect(clock.nextWeatherAt).toBeGreaterThan(Date.now())
    // Der naechste Zustand ist ein anderer als der jetzige.
    expect(clock.nextTimeOfDay).not.toBe(clock.timeOfDay)
    // Und beides liegt hoechstens einen Tag voraus.
    expect(clock.nextTimeOfDayAt - Date.now()).toBeLessThanOrEqual(25 * 3600 * 1000)
    expect(clock.nextWeatherAt - Date.now()).toBeLessThanOrEqual(25 * 3600 * 1000)
  })
})

describe('Wer hier lebt', () => {
  it('zeigt jede Art, die unbekannten ohne Namen', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    const leer = await h.get('/api/area/spawns', token)
    expect(leer.status).toBe(200)
    /*
     * Vor der ersten Begegnung stehen alle da, aber keiner mit Namen.
     * Zuerst blieb die Liste leer — das war zu streng: wer nicht weiss, dass
     * da noch etwas ist, sucht nicht danach.
     */
    expect(leer.body.species).toHaveLength(leer.body.total)
    expect(leer.body.species.every((s: any) => !s.known && s.name === null)).toBe(true)
    expect(leer.body.unknown).toBe(leer.body.total)

    h.ctx.db.prepare(
      `INSERT OR REPLACE INTO dex_entries (trainer_id, species_id, seen_at, caught_at)
       VALUES (?, 'wildmon', ?, NULL)`,
    ).run(trainerId, Date.now())

    h.resetRateLimits()
    const r = await h.get('/api/area/spawns', token)
    const wild = r.body.species.find((s: any) => s.speciesId === 'wildmon')
    expect(wild).toMatchObject({ known: true, caught: false })
    expect(wild.chance).toBeGreaterThan(0)
    expect(r.body.unknown).toBe(r.body.total - 1)
    // Die anderen bleiben namenlos, tragen aber ihre Bedingung.
    for (const s of r.body.species.filter((s: any) => !s.known)) {
      expect(s.name).toBeNull()
      expect(s.minLevel).toBeGreaterThan(0)
    }
  })

  it('nennt die Chance nur fuer das, was gerade erscheinen kann', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    for (const id of ['wildmon', 'nachtmon', 'blattmon']) {
      h.ctx.db.prepare(
        `INSERT OR REPLACE INTO dex_entries (trainer_id, species_id, seen_at, caught_at)
         VALUES (?, ?, ?, ?)`,
      ).run(trainerId, id, Date.now(), Date.now())
    }
    h.resetRateLimits()
    const r = await h.get('/api/area/spawns', token)
    const sum = r.body.species
      .filter((s: any) => s.availableNow)
      .reduce((n: number, s: any) => n + s.chance, 0)
    // Die Anteile der gerade moeglichen Arten ergeben zusammen hoechstens 100.
    expect(sum).toBeGreaterThan(0)
    expect(sum).toBeLessThanOrEqual(100.1)
    for (const s of r.body.species) {
      if (!s.availableNow) expect(s.chance).toBe(0)
    }
  })
})

describe('Lockduft', () => {
  const give = (itemId: string, n: number) =>
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
      .run(trainerId, itemId, n)

  beforeEach(() => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
      .run('test-route', trainerId)
  })

  it('verbraucht je Erkundung genau eine Anwendung und sagt es', async () => {
    give('lure-grass', 3)
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball', lureId: 'lure-grass' }, token)
    expect(r.status).toBe(200)
    // Ohne Rueckmeldung sieht ein verbrauchter Duft aus wie einer, der nichts
    // getan hat — genau so wurde es gemeldet.
    expect(r.body.lure).toMatchObject({ itemId: 'lure-grass', left: 2 })

    const left = h.ctx.db
      .prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'lure-grass') as { quantity: number }
    expect(left.quantity).toBe(2)
  })

  it('verbraucht nichts, wenn keiner gewaehlt ist', async () => {
    give('lure-grass', 3)
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    expect(r.body.lure).toBeNull()
    const left = h.ctx.db
      .prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'lure-grass') as { quantity: number }
    expect(left.quantity).toBe(3)
  })

  it('scheitert nicht an einer leeren Packung', async () => {
    give('lure-grass', 0)
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball', lureId: 'lure-grass' }, token)
    // Eine Erkundung soll nicht daran scheitern, dass der Duft gerade alle ist.
    expect(r.status).toBe(200)
  })

  it('holt mit dem Prueflduft ein Legendaeres, ohne dass die Region bezwungen ist', async () => {
    // Ohne ihn braeuchte es eine vollstaendig bezwungene Region *und* einen
    // Wurf im Promillebereich — als Testgegenstand waere er wertlos, wenn er
    // nur die Chance erhoehte.
    give('lure-legendary', 2)
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball', lureId: 'lure-legendary' }, token)
    expect(r.status).toBe(200)
    expect(r.body.legendary).toBe(true)
    expect(r.body.encounter.speciesId).toBe('sagenmon')
    expect(r.body.lure).toMatchObject({ itemId: 'lure-legendary', left: 1 })
  })

  it('verbraucht den Prueflduft je Erkundung einzeln', async () => {
    give('lure-legendary', 3)
    for (let i = 0; i < 3; i++) {
      h.resetRateLimits(); h.resetPacing()
      await h.post('/api/safari/explore', { ballId: 'poke-ball', lureId: 'lure-legendary' }, token)
      h.resetRateLimits()
      await h.post('/api/safari/flee', {}, token)
    }
    const left = h.ctx.db
      .prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'lure-legendary') as { quantity: number }
    expect(left.quantity).toBe(0)
  })

  it('verschiebt die Begegnungen sichtbar zum gewaehlten Typ', async () => {
    // Blattmon ist die einzige Pflanzen-Art auf der Testroute und mit Gewicht
    // 1 gegen 70/20/10 praktisch unsichtbar. Mit Lockduft muss es auftauchen.
    h.ctx.db.prepare('UPDATE trainers SET energy = 90000 WHERE id = ?').run(trainerId)
    give('lure-grass', 200)

    let withLure = 0
    for (let i = 0; i < 60; i++) {
      h.resetRateLimits(); h.resetPacing()
      const r = await h.post('/api/safari/explore', { ballId: 'poke-ball', lureId: 'lure-grass' }, token)
      if (r.body.encounter?.speciesId === 'blattmon') withLure++
      h.resetRateLimits()
      await h.post('/api/safari/flee', {}, token)
    }

    let without = 0
    for (let i = 0; i < 60; i++) {
      h.resetRateLimits(); h.resetPacing()
      const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
      if (r.body.encounter?.speciesId === 'blattmon') without++
      h.resetRateLimits()
      await h.post('/api/safari/flee', {}, token)
    }

    expect(withLure).toBeGreaterThan(without)
  })
})

describe('Was der Laden nicht führt', () => {
  it('bietet die Sagenbeere nicht an', async () => {
    // Sie stand mit Preis 0 im Laden, und "0 Gold" ist ein Preis: zwei
    // Mitspieler haben sich 34 und 117 Stueck geholt. Sie faellt nur bei
    // Ueberfaellen.
    const r = await h.get('/api/shop', token)
    const ids = (r.body.sections ?? []).flatMap((s: any) => s.items.map((i: any) => i.id))
    expect(ids).not.toContain('legendary-berry')
  })

  it('fuehrt ueberhaupt nichts Verkaeufliches zum Nulltarif', async () => {
    // Die Regel dahinter: `price: null` heisst "nicht kaeuflich". Ein Preis von
    // 0 heisst "geschenkt" — das darf nur fuer Hintergruende gelten.
    const r = await h.get('/api/shop', token)
    for (const section of r.body.sections ?? []) {
      for (const item of section.items) {
        if (section.category === 'background') continue
        expect(item.price).toBeGreaterThan(0)
      }
    }
  })
})

describe('Regionswechsel', () => {
  const clearTestland = () => {
    h.ctx.db.prepare(
      'INSERT OR IGNORE INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)',
    ).run(trainerId, 'test-badge', Date.now())
    for (const id of ['elite-eins', 'elite-zwei', 'test-champ']) {
      h.ctx.db.prepare(
        `INSERT OR REPLACE INTO trainer_defeats
           (trainer_id, opponent_id, wins, first_win_at, last_win_at) VALUES (?, ?, 1, ?, ?)`,
      ).run(trainerId, id, Date.now(), Date.now())
    }
  }

  it('sperrt die zweite Region, solange die erste offen ist', async () => {
    const r = await h.get('/api/world', token)
    const tal = r.body.regions.flatMap((x: any) => x.areas).find((a: any) => a.id === 'hoch-tal')
    expect(tal.unlocked).toBe(false)
    const gate = tal.requirements.find((q: any) => q.kind === 'region_cleared')
    expect(gate).toMatchObject({ met: false, label: 'Testland' })

    h.resetRateLimits()
    const travel = await h.post('/api/world/travel', { areaId: 'hoch-tal' }, token)
    expect(travel.status).toBe(409)
    expect(travel.body.detail.reason).toBe('area_locked')
  })

  it('oeffnet sie, sobald Orden, Top Vier und Meister stehen', async () => {
    clearTestland()
    h.resetRateLimits()
    const r = await h.get('/api/world', token)
    const tal = r.body.regions.flatMap((x: any) => x.areas).find((a: any) => a.id === 'hoch-tal')
    expect(tal.unlocked).toBe(true)

    h.resetRateLimits()
    expect((await h.post('/api/world/travel', { areaId: 'hoch-tal' }, token)).status).toBe(200)
  })

  it('laesst die eigene Region jederzeit offen', async () => {
    // Die Sperre gilt dem Wechsel, nicht der Rueckkehr.
    const r = await h.get('/api/world', token)
    const route = r.body.regions[0].areas[0]
    expect(route.requirements.some((q: any) => q.kind === 'region_cleared')).toBe(false)
  })
})

describe('Fundstuecke und der Metalldetektor', () => {
  const give = (itemId: string, n: number) =>
    h.ctx.db
      .prepare('INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = ?')
      .run(trainerId, itemId, n, n)

  const gold = () =>
    (h.ctx.db.prepare('SELECT gold FROM trainers WHERE id = ?').get(trainerId) as { gold: number }).gold

  const quantity = (itemId: string) =>
    (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, itemId) as { quantity: number } | undefined)?.quantity ?? 0

  beforeEach(() => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
      .run('test-route', trainerId)
  })

  it('schaltet den Detektor ein und verbraucht dabei ein Geraet', async () => {
    give('metal-detector', 2)
    h.resetRateLimits()
    const r = await h.post('/api/safari/detector', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.charges).toBe(10)
    expect(quantity('metal-detector')).toBe(1)

    // Die Ladungen addieren sich, statt sich zu ueberschreiben.
    h.resetRateLimits()
    expect((await h.post('/api/safari/detector', {}, token)).body.charges).toBe(20)
  })

  it('weist das Einschalten ohne Geraet ab', async () => {
    give('metal-detector', 0)
    h.resetRateLimits()
    const r = await h.post('/api/safari/detector', {}, token)
    expect(r.status).toBe(409)
  })

  it('foerdert mit laufendem Detektor jede Erkundung einen Fund zutage', async () => {
    give('metal-detector', 1)
    h.resetRateLimits()
    await h.post('/api/safari/detector', {}, token)

    for (let i = 0; i < 5; i++) {
      const before = { gold: gold(), balls: quantity('poke-ball'), souls: quantity('soul-normal') }
      h.resetRateLimits()
      h.resetPacing()
      const r = await h.post('/api/safari/explore', {}, token)
      expect(r.status).toBe(200)
      expect(r.body.kind).toBe('find')
      // Aufgehoben wird sofort: der Fund liegt beim Eintreffen schon im
      // Beutel oder in der Kasse.
      const f = r.body.find
      expect(f.detectorLeft).toBe(9 - i)
      if (f.what === 'coins') {
        expect(f.gold).toBeGreaterThanOrEqual(55)
        expect(f.gold).toBeLessThanOrEqual(789)
        expect(gold()).toBe(before.gold + f.gold)
      } else {
        expect(f.itemId).toBeTruthy()
        expect(quantity(f.itemId)).toBeGreaterThan(0)
      }
    }
  })

  it('laesst nach der letzten Ladung wieder den Zufall entscheiden', async () => {
    give('metal-detector', 1)
    h.resetRateLimits()
    await h.post('/api/safari/detector', {}, token)
    for (let i = 0; i < 10; i++) {
      h.resetRateLimits()
      h.resetPacing()
      await h.post('/api/safari/explore', {}, token)
    }
    const left = h.ctx.db.prepare('SELECT detector_charges AS n FROM trainers WHERE id = ?')
      .get(trainerId) as { n: number }
    expect(left.n).toBe(0)

    // Elfte Erkundung: die Zusage ist weg, also nicht mehr zwingend ein Fund.
    let finds = 0
    for (let i = 0; i < 12; i++) {
      h.resetRateLimits()
      h.resetPacing()
      if ((await h.post('/api/safari/explore', {}, token)).body.kind === 'find') finds++
    }
    expect(finds).toBeLessThan(12)
  })

  it('findet in der ersten Region nur billige Ware', async () => {
    give('metal-detector', 3)
    h.resetRateLimits()
    await h.post('/api/safari/detector', {}, token)
    h.resetRateLimits()
    await h.post('/api/safari/detector', {}, token)

    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      h.resetRateLimits()
      h.resetPacing()
      const f = (await h.post('/api/safari/explore', {}, token)).body.find
      if (f?.itemId) seen.add(f.itemId)
    }
    // Die Wertgrenze der ersten Region liegt bei 50 Verkaufsgold: der
    // Superball (45) darf dabei sein, ein teurerer Gegenstand nicht. Und
    // Seelenfragmente kommen nur ueber ihren eigenen Ausgang.
    for (const id of seen) {
      const item = h.ctx.registry.item(id)
      const isFragment = Boolean(item.params.soulType)
      if (!isFragment) expect(item.sellPrice ?? 0).toBeLessThanOrEqual(50)
    }
    expect(seen.size).toBeGreaterThan(0)
  })
})

describe('Fangzaehler eines Gebiets', () => {
  it('zaehlt den Bestand, nicht den Fangort', async () => {
    /*
     * Auf der Karte stand "4/7 gefangen", in der Gebietsansicht "6 gefangen".
     * Zwei verschiedene Groessen: hier gefangen gegen im Pokedex vorhanden.
     * Die Gebietsansicht und die Belohnung fuers Vervollstaendigen zaehlen
     * beide ueber den Pokedex — die Karte tat es als Einzige nicht.
     */
    const area = h.ctx.registry.area('test-route')
    const species = [...new Set(area.spawns.map((s) => s.speciesId))]

    // Eine Art als anderswo gefangen eintragen: der Fangort ist ein anderes
    // Gebiet, der Dex-Eintrag zaehlt trotzdem.
    h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
         shiny, moves, caught_at, caught_area_id, team_slot)
       VALUES (?, ?, ?, 0, 5, 'hardy', 15,15,15,15,15,15, 0, 100, 20, 0, '["tackle"]', ?, 'test-cave', NULL)`,
    ).run(crypto.randomUUID(), trainerId, species[0], Date.now())
    h.ctx.db.prepare(
      'INSERT INTO dex_entries (trainer_id, species_id, seen_at, caught_at) VALUES (?, ?, ?, ?) '
      + 'ON CONFLICT(trainer_id, species_id) DO UPDATE SET caught_at = excluded.caught_at',
    ).run(trainerId, species[0], Date.now(), Date.now())

    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    const world = await h.get('/api/world', token)
    const card = world.body.regions.flatMap((r: any) => r.areas).find((a: any) => a.id === 'test-route')
    h.resetRateLimits()
    const detail = await h.get('/api/area/spawns', token)

    expect(card.caughtHere).toBe(detail.body.caught)
    expect(card.caughtHere).toBeGreaterThan(0)
  })
})

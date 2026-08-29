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
  h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
    .run('test-route', trainerId)
})
afterEach(async () => { await h.close() })

/** Das ganze Team auf ein Level setzen — der Median ist dann dieses Level. */
const setTeamLevel = (level: number) =>
  h.ctx.db.prepare('UPDATE creatures SET level = ? WHERE owner_id = ? AND team_slot IS NOT NULL')
    .run(level, trainerId)

async function exploreLevels(times: number): Promise<number[]> {
  const levels: number[] = []
  for (let i = 0; i < times; i++) {
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    if (r.body.kind === 'encounter') levels.push(r.body.encounter.level)
    h.resetRateLimits()
    await h.post('/api/safari/flee', {}, token)
  }
  return levels
}

describe('Dynamische Levelskalierung', () => {
  it('ist standardmaessig an', async () => {
    const r = await h.get('/api/world', token)
    expect(r.body.levelScaling).toBe(true)
    expect(r.body.referenceLevel).toBe(5)
  })

  it('laesst ein Gebiet unveraendert, solange das Team im Band liegt', async () => {
    // Testroute ist mit Lv 2–6 entworfen, der Starter steht auf 5.
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    expect(route.levels).toEqual({ min: 2, max: 6 })
    expect(route.levelBoost).toBe(0)

    const levels = await exploreLevels(8)
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(2)
      expect(level).toBeLessThanOrEqual(6)
    }
  })

  it('hebt das Gebiet an, sobald das Team darueber liegt', async () => {
    setTeamLevel(45)
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    // Bandobergrenze wandert auf 45, die Breite bleibt.
    expect(route.levels).toEqual({ min: 41, max: 45 })
    expect(route.levelBoost).toBe(39)

    const levels = await exploreLevels(8)
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(41)
      expect(level).toBeLessThanOrEqual(45)
    }
  })

  it('macht ein Gebiet nie leichter als entworfen', async () => {
    setTeamLevel(1)
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    expect(route.levels).toEqual({ min: 2, max: 6 })
    expect(route.levelBoost).toBe(0)
  })

  it('folgt dem Median, nicht dem staerksten Mitglied', async () => {
    // Vier auf Level 5, eines auf 90 — der Median bleibt 5.
    const stmt = h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
         friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'testmon', 125, ?, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, ?)`,
    )
    stmt.run(crypto.randomUUID(), trainerId, 5, Date.now(), 1)
    stmt.run(crypto.randomUUID(), trainerId, 5, Date.now(), 2)
    stmt.run(crypto.randomUUID(), trainerId, 5, Date.now(), 3)
    stmt.run(crypto.randomUUID(), trainerId, 90, Date.now(), 4)

    const r = await h.get('/api/world', token)
    expect(r.body.referenceLevel).toBe(5)
    expect(r.body.regions[0].areas[0].levelBoost).toBe(0)
  })

  it('skaliert auch die Trainer im Gebiet', async () => {
    // Der Rivale steht im Entwurf auf Level 3 — zwei unter der Obergrenze
    // seiner Route. Dieser Abstand bleibt erhalten.
    const before = (await h.get('/api/battle/opponents', token)).body
    expect(before.trainers[0].maxLevel).toBe(3)
    expect(before.trainers[0].levelBoost).toBe(0)

    setTeamLevel(40)
    const after = (await h.get('/api/battle/opponents', token)).body
    expect(after.trainers[0].levelBoost).toBe(34)
    expect(after.trainers[0].maxLevel).toBe(37)
  })

  it('schickt den skalierten Gegner auch wirklich in den Kampf', async () => {
    setTeamLevel(40)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 9999 WHERE owner_id = ?').run(trainerId)
    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(r.status).toBe(200)
    expect(r.body.foe.active.level).toBe(37)
  })

  it('laesst sich abschalten und wieder einschalten', async () => {
    setTeamLevel(45)
    const off = await h.post('/api/world/scaling', { enabled: false }, token)
    expect(off.status).toBe(200)
    expect(off.body.levelScaling).toBe(false)
    expect(off.body.regions[0].areas[0].levels).toEqual({ min: 2, max: 6 })
    // Der Bezugswert bleibt sichtbar: der Eingang einer Region richtet sich
    // auch bei abgeschalteter Skalierung nach ihm.
    expect(off.body.referenceLevel).toBe(45)

    const levels = await exploreLevels(6)
    for (const level of levels) expect(level).toBeLessThanOrEqual(6)

    h.resetRateLimits()
    const on = await h.post('/api/world/scaling', { enabled: true }, token)
    expect(on.body.levelScaling).toBe(true)
    expect(on.body.regions[0].areas[0].levelBoost).toBe(39)
  })

  it('empfaengt eine spaetere Region auch bei abgeschalteter Skalierung', async () => {
    /*
     * Der Schalter hiess immer "Gebiete behalten ihre Entwurfslevel, fruehere
     * Routen bleiben leicht" und tat zwei Dinge: das — und er nahm der Region
     * ihren Einstieg. Die Baender sind eine Kette, das Hochland faengt bei 58
     * an. Wer den Schalter umlegte, verlor damit die freie Wahl der
     * Startregion, ohne dass irgendwo stand, dass er das taete.
     */
    setTeamLevel(10)
    h.resetRateLimits()
    const off = await h.post('/api/world/scaling', { enabled: false }, token)
    const hochland = off.body.regions.find((r: any) => r.id === 'hochland')
    const tal = hochland.areas[0]
    // Entworfen 58–64, empfangen wird man trotzdem auf dem eigenen Niveau.
    expect(tal.levels.max).toBeLessThanOrEqual(12)
    expect(tal.levels.min).toBeGreaterThanOrEqual(2)

    // Und die Steigung der Region bleibt: der Gipfel liegt weiter darueber.
    const gipfel = hochland.areas[1]
    expect(gipfel.levels.min).toBeGreaterThan(tal.levels.max)
  })

  it('stoesst nicht ueber die Reisegrenze hinaus', async () => {
    // Wer noch keine Region bezwungen hat, hebt auch kein Gebiet ueber
    // Level 100 — sonst holte man sich Gegner in die erste Region, fuer die
    // die Reise noch nicht bezahlt ist.
    setTeamLevel(200)
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    expect(route.levels.max).toBe(100)
    const levels = await exploreLevels(6)
    for (const level of levels) expect(level).toBeLessThanOrEqual(100)
  })

  it('gibt die Reisegrenze frei, sobald eine Region bezwungen ist', async () => {
    const clear = () => {
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

    setTeamLevel(200)
    expect((await h.get('/api/world', token)).body.travel.cap).toBe(100)

    clear()
    h.resetRateLimits()
    const after = await h.get('/api/world', token)
    expect(after.body.travel.cap).toBe(150)
    expect(after.body.travel.clearedRegions).toBe(1)
    expect(after.body.regions[0].areas[0].levels.max).toBe(150)
  })
})

describe('Regionen nebeneinander', () => {
  const areaOf = async (id: string) => {
    const w = await h.get('/api/world', token)
    return w.body.regions.flatMap((r: any) => r.areas).find((a: any) => a.id === id)
  }

  it('empfaengt einen Anfaenger im Hochland auf seinem Niveau', async () => {
    // Entworfen ist das Hochtal mit 58–64. Ohne Senkung waere es fuer einen
    // Starter auf Level 5 keine Region, sondern eine Wand.
    const tal = await areaOf('hoch-tal')
    expect(tal.levels).toEqual({ min: 2, max: 8 })
    expect(tal.levelBoost).toBe(-56)
  })

  it('haelt den Gipfel dabei ueber dem Tal', async () => {
    const [tal, gipfel] = [await areaOf('hoch-tal'), await areaOf('hoch-gipfel')]
    expect(gipfel.levels.min).toBeGreaterThan(tal.levels.max)
    // 84–94, um 56 gesenkt.
    expect(gipfel.levels).toEqual({ min: 28, max: 38 })
  })

  it('laesst die Region nicht mitwachsen, wenn der Spieler waechst', async () => {
    // Der Fehler, den dieser Test verhindert: rechnet man den Regionsversatz
    // aus dem heutigen Teamlevel statt aus dem beim Betreten, steigt der Gipfel
    // mit — von 38 auf 50 auf 70 — und ist nie erreichbar.
    h.ctx.db.prepare(
      'INSERT OR IGNORE INTO region_entries (trainer_id, region_id, reference_level, entered_at) VALUES (?, ?, ?, ?)',
    ).run(trainerId, 'hochland', 5, Date.now())

    for (const level of [5, 20, 30]) {
      setTeamLevel(level)
      expect((await areaOf('hoch-gipfel')).levels.max).toBe(38)
    }
    // Erst wer den Gipfel ueberholt hat, zieht ihn mit — das ist der Teil nach
    // oben, und der gilt je Gebiet.
    setTeamLevel(45)
    expect((await areaOf('hoch-gipfel')).levels.max).toBe(45)
  })

  it('schreibt das Niveau beim ersten Betreten fest', async () => {
    // Eine neue Region betritt nur, wer seine aktuelle bezwungen hat.
    h.ctx.db.prepare(
      'INSERT OR IGNORE INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)',
    ).run(trainerId, 'test-badge', Date.now())
    for (const id of ['elite-eins', 'elite-zwei', 'test-champ']) {
      h.ctx.db.prepare(
        `INSERT OR REPLACE INTO trainer_defeats
           (trainer_id, opponent_id, wins, first_win_at, last_win_at) VALUES (?, ?, 1, ?, ?)`,
      ).run(trainerId, id, Date.now(), Date.now())
    }

    setTeamLevel(20)
    h.resetRateLimits()
    expect((await h.post('/api/world/travel', { areaId: 'hoch-tal' }, token)).status).toBe(200)

    const entry = h.ctx.db
      .prepare('SELECT reference_level AS ref FROM region_entries WHERE trainer_id = ? AND region_id = ?')
      .get(trainerId, 'hochland') as { ref: number }
    expect(entry.ref).toBe(20)

    // Ein zweiter Besuch mit staerkerem Team aendert nichts mehr.
    setTeamLevel(40)
    h.resetRateLimits()
    await h.post('/api/world/travel', { areaId: 'hoch-tal' }, token)
    const again = h.ctx.db
      .prepare('SELECT reference_level AS ref FROM region_entries WHERE trainer_id = ? AND region_id = ?')
      .get(trainerId, 'hochland') as { ref: number }
    expect(again.ref).toBe(20)
  })

  it('laesst die eigene Liga in Reichweite, waehrend man in ihr aufsteigt', async () => {
    // Dasselbe fuer die Startregion: die Testhoehle ist mit 8–12 entworfen und
    // darf nicht davonlaufen, waehrend das Team von 5 auf 12 waechst.
    for (const level of [5, 8, 11]) {
      setTeamLevel(level)
      expect((await areaOf('test-cave')).levels.max).toBe(12)
    }
  })
})


import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GAUNTLET_MILESTONES, gauntletGoldPerWin } from '@game/engine'
import { endstufen } from '../src/services/gauntlet.js'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

/**
 * Kampfzone: eine Serie gegen wilde Pokémon, ohne festes Ende.
 *
 * Geprüft wird nicht der Kampf selbst — den prüft `battle.test.ts` —, sondern
 * was die Serie daraus macht: Stufen, Beute, Bestmarke, und dass eine
 * Niederlage den Lauf beendet.
 */
let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  h.ctx.db.prepare('UPDATE trainers SET gold = 5000 WHERE id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })


const streak = (): number =>
  (h.ctx.db.prepare('SELECT streak FROM gauntlet_runs WHERE trainer_id = ?').get(trainerId) as
    { streak: number } | undefined)?.streak ?? -1

const energyOf = (): number =>
  (h.ctx.db.prepare('SELECT energy FROM trainers WHERE id = ?').get(trainerId) as { energy: number }).energy

describe('Antreten', () => {
  it('nennt die offenen Regionen und ihre Beute', async () => {
    const r = await h.get('/api/gauntlet', token)
    expect(r.status).toBe(200)
    expect(r.body.regions.length).toBeGreaterThan(0)
    expect(r.body.regions[0].drops.length).toBeGreaterThan(0)
    expect(r.body.run).toBeNull()
    // Die Stufen haengen an der Region: die Werkstoffe unterscheiden sich, und
    // ab fuenfzig kommt eine Sorte dazu.
    const stufen = r.body.regions[0].milestones
    expect(stufen.map((m: any) => m.at)).toEqual(GAUNTLET_MILESTONES.map((m) => m.at))
    // Jede Stufe nennt ihre Gegenstaende beim Namen, nicht nur ihre Anzahl.
    for (const m of stufen) {
      expect(m.items.length).toBeGreaterThan(0)
      expect(m.items.reduce((n: number, i: any) => n + i.quantity, 0)).toBe(m.materials)
    }
    // Erholung nur an den Vielfachen von fuenfundzwanzig.
    expect(stufen.filter((m: any) => m.heals).map((m: any) => m.at)).toEqual([25, 50, 100])
  })

  it('kostet die Energie einmal, nicht je Kampf', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    const cost = (await h.get('/api/gauntlet', token)).body.energyCost
    const before = energyOf()
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/start', { regionId: region }, token)
    expect(r.status).toBe(200)
    expect(energyOf()).toBe(before - cost)
    expect(streak()).toBe(0)
  })

  it('laesst keine zwei Laeufe gleichzeitig zu', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.resetRateLimits()
    const again = await h.post('/api/gauntlet/start', { regionId: region }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_active')
  })

  it('weist eine gesperrte Region ab', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/start', { regionId: 'zweitland' }, token)
    expect([409, 400]).toContain(r.status)
  })
})

describe('Energie', () => {
  /** Dem Gegner einen Kraftpunkt lassen: macht den Ausgang eindeutig. */
  const weakenFoe = () => {
    const row = h.ctx.db
      .prepare('SELECT id, state FROM battles WHERE trainer_id = ? AND finished_at IS NULL')
      .get(trainerId) as { id: string; state: string }
    const state = JSON.parse(row.state) as { sides: Array<{ party: Array<{ hp: number }> }> }
    for (const f of state.sides[1]!.party) f.hp = 1
    h.ctx.db.prepare('UPDATE battles SET state = ? WHERE id = ?').run(JSON.stringify(state), row.id)
  }

  it('gibt fuer einen Sieg in der Kampfzone keine Energie zurueck', async () => {
    /*
     * Gemeldet: "du bekommst sehr viel Energie durch nen Abschluss".
     *
     * Die Kunstgegner der Kampfzone gelten als Erstsieg, damit ihr Gold
     * stimmt — und zahlten damit auch die Energie je Kampf. Gemessen kosteten
     * zwoelf Laeufe 120 Energie und brachten 1712 zurueck. Der Einsatz faellt
     * vorne an, einmal je Lauf; ein Zuschuss je Sieg hebt das wieder auf.
     */
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)

    const nachAntritt = energyOf()
    weakenFoe()
    h.resetRateLimits()
    const r = await h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)

    expect(r.status).toBe(200)
    expect(r.body.reward?.energy ?? 0).toBe(0)
    expect(energyOf()).toBe(nachAntritt)
  })
})

describe('Aufhoeren', () => {
  it('haelt die Bestmarke fest', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.ctx.db.prepare('UPDATE gauntlet_runs SET streak = 7 WHERE trainer_id = ?').run(trainerId)

    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.gauntlet.run).toBeNull()
    // Die Serie ist vorbei, die Bestmarke bleibt — sonst gaebe es nichts,
    // worauf man hinarbeitet, sobald man einmal verloren hat.
    expect(r.body.gauntlet.regions.find((x: any) => x.id === region).best).toBe(7)
  })
})

describe('Gold je Sieg', () => {
  it('waechst mit der Serie', () => {
    expect(gauntletGoldPerWin(20)).toBeGreaterThan(gauntletGoldPerWin(0))
  })
})

describe('Abrechnung am Ende', () => {
  it('nennt beim Aufhoeren, was der Lauf gebracht hat', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)

    // Einen Lauf mit Beute vortaeuschen — der Weg dorthin fuehrt ueber echte
    // Kaempfe und ist in `battle.test.ts` geprueft; hier zaehlt die Abrechnung.
    h.ctx.db.prepare(
      `UPDATE gauntlet_runs SET streak = 12, total_gold = 1234, total_xp = 567,
              loot = '{"poke-ball":9,"iron-shard":4}' WHERE trainer_id = ?`,
    ).run(trainerId)

    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    const s = r.body.summary
    expect(s.streak).toBe(12)
    expect(s.gold).toBe(1234)
    expect(s.xp).toBe(567)
    expect(s.best).toBe(12)
    // Absteigend nach Menge, damit oben steht, was am meisten kam.
    expect(s.items.map((i: any) => i.itemId)).toEqual(['poke-ball', 'iron-shard'])
    expect(s.items[0].name).toBeTruthy()
    expect(s.items[0].quantity).toBe(9)
  })

  it('kommt ohne Lauf ohne Abrechnung zurueck', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.summary).toBeNull()
  })

  it('uebersteht kaputte Beutedaten, statt den Bildschirm zu verlieren', async () => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.ctx.db.prepare("UPDATE gauntlet_runs SET loot = 'kein json' WHERE trainer_id = ?").run(trainerId)
    h.resetRateLimits()
    const r = await h.post('/api/gauntlet/abandon', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.summary.items).toEqual([])
  })
})

describe('Heilen und Beleben', () => {
  /** Ein Teammitglied auf null setzen und seine Id zurueckgeben. */
  const knockOut = (): string => {
    const c = h.ctx.db.prepare(
      'SELECT id FROM creatures WHERE owner_id = ? AND team_slot IS NOT NULL LIMIT 1',
    ).get(trainerId) as { id: string }
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 0 WHERE id = ?').run(c.id)
    return c.id
  }
  const hpOf = (id: string): number =>
    (h.ctx.db.prepare('SELECT hp_current AS hp FROM creatures WHERE id = ?').get(id) as { hp: number }).hp

  /** Ein zweites Teammitglied, damit ein Gefallener den Kampf nicht verhindert. */
  const zweitesMitglied = () => {
    const id = crypto.randomUUID()
    h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
         iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'testmon', 0, 20, 'hardy', 20, 20, 20, 20, 20, 20, 70, 100, 200, 0, '["tackle"]', ?, 1)`,
    ).run(id, trainerId, Date.now())
    return id
  }

  /** Dem Gegner einen Kraftpunkt lassen: macht den Ausgang eindeutig. */
  const weakenFoe = () => {
    const row = h.ctx.db
      .prepare('SELECT id, state FROM battles WHERE trainer_id = ? AND finished_at IS NULL')
      .get(trainerId) as { id: string; state: string }
    const state = JSON.parse(row.state) as { sides: Array<{ party: Array<{ hp: number }> }> }
    for (const f of state.sides[1]!.party) f.hp = 1
    h.ctx.db.prepare('UPDATE battles SET state = ? WHERE id = ?').run(JSON.stringify(state), row.id)
  }

  /**
   * Einen Lauf mit dieser Serie aufsetzen und den offenen Kampf gewinnen.
   *
   * Ueber den echten Kampf, nicht ueber die Datenbank: die Auszahlung und die
   * Heilung haengen an der Zugabwicklung, und eine von Hand gesetzte Zeile
   * laeuft an ihnen vorbei.
   */
  const gewinneBei = async (streak: number) => {
    const region = (await h.get('/api/gauntlet', token)).body.regions[0].id
    h.resetRateLimits()
    await h.post('/api/gauntlet/start', { regionId: region }, token)
    h.ctx.db.prepare('UPDATE gauntlet_runs SET streak = ? WHERE trainer_id = ?').run(streak, trainerId)
    weakenFoe()
    h.resetRateLimits()
    return h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)
  }

  it('belebt an der Fuenfundzwanzig', async () => {
    /*
     * Der urspruenglich gemeldete Fehler: die Heilung uebersprang Besiegte.
     * Wer einmal umfiel, blieb den ganzen Lauf draussen — und weil nur
     * antritt, wer steht, bekam am Ende nur der letzte Stehende Erfahrung.
     */
    zweitesMitglied()
    const gefallen = knockOut()
    const r = await gewinneBei(24)

    expect(r.status).toBe(200)
    expect(r.body.gauntletAdvance.streak).toBe(25)
    expect(hpOf(gefallen)).toBeGreaterThan(0)
  })

  it('heilt an einer Praemienstufe nicht mehr', async () => {
    /*
     * Zehn und fuenfzehn zahlen Gold und Werkstoffe, sind aber keine
     * Rastplaetze mehr — genau das war die Ansage.
     */
    zweitesMitglied()
    const gefallen = knockOut()
    const r = await gewinneBei(9)

    expect(r.body.gauntletAdvance.streak).toBe(10)
    expect(r.body.gauntletAdvance.payout?.at).toBe(10)
    expect(hpOf(gefallen)).toBe(0)
  })

  it('gibt zwischen den Marken keine Kraftpunkte zurueck', async () => {
    // Vorher zwoelf Prozent nach jedem Sieg. Jetzt nichts.
    const angeschlagen = zweitesMitglied()
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 3 WHERE id = ?').run(angeschlagen)

    const r = await gewinneBei(5)
    expect(r.body.gauntletAdvance.streak).toBe(6)
    expect(hpOf(angeschlagen)).toBe(3)
  })
})

describe('Wer in der Kampfzone antritt', () => {
  /*
   * Gemeldet als "am besten waers wenn Alle Pokemon von ihrer Hoechsten
   * evolutions Linie ersaetzt werden wuerden und die base form man nicht
   * antreffen koennte, damit man bspw. kein Karpador mehr antreffen kann".
   *
   * Die Endstufe *ersetzt* die Grundform, sie filtert sie nicht weg — sonst
   * bliebe nur uebrig, was ohnehin schon als Endstufe spawnt, und das sind zu
   * wenige.
   */
  it('ersetzt eine Grundform durch ihre Endstufe', () => {
    // testmon entwickelt sich zu testmon-evo; genau darum geht es.
    expect(endstufen(h.ctx, 'testmon')).toEqual(['testmon-evo'])
    // Und wer schon am Ende steht, bleibt, wo er ist.
    expect(endstufen(h.ctx, 'testmon-evo')).toEqual(['testmon-evo'])
  })

  it('liefert fuer jede spawnbare Art nur ausgewachsene Formen', () => {
    const spawnbar = new Set(h.ctx.registry.allAreas.flatMap((a) => a.spawns.map((s) => s.speciesId)))
    for (const id of spawnbar) {
      for (const ende of endstufen(h.ctx, id)) {
        expect(h.ctx.registry.species(ende).evolutions).toHaveLength(0)
      }
    }
  })

  it('kennt nur noch eine Zone, und die heisst global', async () => {
    const d = (await h.get('/api/gauntlet', token)).body
    expect(d.regions).toHaveLength(1)
    expect(d.regions[0].id).toBe('global')
    // Eine alte Regionskennung wird abgewiesen statt stillschweigend
    // umgedeutet — sonst liefe ein Lauf unter einem Namen, den es nicht gibt.
    const alt = await h.post('/api/gauntlet/start', { regionId: 'kanto' }, token)
    expect(alt.status).toBe(400)
  })

  it('laesst kein Pokemon ueber der Levelgrenze antreten', async () => {
    // Ein Team weit ueber der Grenze: ohne Deckel stuende hier 80.
    h.ctx.db.prepare('UPDATE creatures SET level = 80 WHERE owner_id = ?').run(trainerId)
    const zone = (await h.get('/api/gauntlet', token)).body.regions[0].id
    const r = await h.post('/api/gauntlet/start', { regionId: zone }, token)

    expect(r.status).toBe(200)
    expect(r.body.battle.player.active.level).toBeLessThanOrEqual(50)
    expect(r.body.battle.foe.active.level).toBeLessThanOrEqual(50)
  })
})

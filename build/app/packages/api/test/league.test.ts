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
  h.ctx.db.prepare(
    'UPDATE trainers SET current_area_id = ?, energy = 9000, gold = 5000 WHERE id = ?',
  ).run('test-route', trainerId)
  // Ein Team, das gewinnen kann.
  h.ctx.db.prepare('UPDATE creatures SET level = 90, hp_current = 9999 WHERE owner_id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })

const defeat = (opponentId: string) =>
  h.ctx.db.prepare(
    'INSERT OR REPLACE INTO trainer_defeats (trainer_id, opponent_id, wins, first_win_at, last_win_at) VALUES (?, ?, 1, ?, ?)',
  ).run(trainerId, opponentId, Date.now(), Date.now())

const startAgainst = (id: string) => h.post('/api/battle/start', { opponentId: id }, token)

describe('Top Vier', () => {
  it('laesst den ersten sofort antreten', async () => {
    expect((await startAgainst('elite-eins')).status).toBe(200)
  })

  it('sperrt den zweiten, solange der erste steht', async () => {
    const r = await startAgainst('elite-zwei')
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('elite_locked')
    expect(r.body.detail.requires).toBe('elite-eins')
  })

  it('oeffnet den zweiten nach einem Sieg ueber den ersten', async () => {
    defeat('elite-eins')
    h.resetRateLimits()
    expect((await startAgainst('elite-zwei')).status).toBe(200)
  })

  it('haelt den Meister zurueck, bis die Top Vier gefallen sind', async () => {
    const r = await startAgainst('test-gym')
    // test-gym ist ein Arenaleiter, kein Meister — der bleibt frei.
    expect(r.status).toBe(200)
  })

  it('laesst gewoehnliche Trainer unberuehrt', async () => {
    expect((await startAgainst('test-rival')).status).toBe(200)
  })

  it('zeigt den Ligastand auf der Weltkarte', async () => {
    const r = await h.get('/api/world', token)
    const league = r.body.league.find((l: any) => l.regionId === 'testland')
    expect(league).toBeTruthy()
    expect(league.elites.map((e: any) => e.id)).toEqual(['elite-eins', 'elite-zwei'])
    expect(league.elites[0].locked).toBe(false)
    expect(league.elites[1].locked).toBe(true)
    expect(league.cleared).toBe(false)

    defeat('elite-eins')
    h.resetRateLimits()
    const after = await h.get('/api/world', token)
    const l2 = after.body.league.find((l: any) => l.regionId === 'testland')
    expect(l2.elites[0].defeated).toBe(true)
    expect(l2.elites[1].locked).toBe(false)
  })
})

describe('Überfall', () => {
  const pend = (opponentId = 'event-rocket-anderswo', areaId = 'test-route') =>
    h.ctx.db.prepare('UPDATE trainers SET pending_event_id = ?, pending_event_area = ? WHERE id = ?')
      .run(opponentId, areaId, trainerId)

  it('laesst sich ohne Vormerkung nicht starten', async () => {
    const r = await h.post('/api/battle/event', {}, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('no_event')
  })

  it('startet den Kampf gegen den vorgemerkten Gegner', async () => {
    pend()
    const r = await h.post('/api/battle/event', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.opponentName).toBe('Rüpel')
  })

  it('verbraucht die Vormerkung genau einmal', async () => {
    pend()
    expect((await h.post('/api/battle/event', {}, token)).status).toBe(200)
    await h.post('/api/battle/forfeit', {}, token)
    h.resetRateLimits()
    const again = await h.post('/api/battle/event', {}, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('no_event')
  })

  /** Dem Gegner einen Kraftpunkt lassen: macht den Ausgang eindeutig. */
  const weakenFoe = () => {
    const row = h.ctx.db
      .prepare('SELECT id, state FROM battles WHERE trainer_id = ? AND finished_at IS NULL')
      .get(trainerId) as { id: string; state: string }
    const state = JSON.parse(row.state) as { sides: Array<{ party: Array<{ hp: number }> }> }
    for (const f of state.sides[1]!.party) f.hp = 1
    h.ctx.db.prepare('UPDATE battles SET state = ? WHERE id = ?').run(JSON.stringify(state), row.id)
  }

  it('wirft beim Sieg Gold und Gegenstaende ab', async () => {
    /*
     * Der Sieg muss feststehen, sonst besteht der Test mal und mal nicht.
     *
     * Frueher genuegte dafuer die abgeschaltete Skalierung: der Ruepel blieb
     * auf Level 5 und das eigene Team stand auf 90. Seit ein Ueberfall sich
     * *immer* am eigenen Team ausrichtet — er hat keinen Ort, an dem ein
     * Entwurfslevel haengen koennte —, ist das ein ausgeglichener Kampf und
     * damit offen. Der Gegner geht deshalb mit einem Kraftpunkt ins Rennen:
     * geprueft wird hier die Beute, nicht der Kampf.
     */
    pend()
    const goldBefore = (await h.get('/api/bag', token)).body.gold
    await h.post('/api/battle/event', {}, token)
    weakenFoe()

    // Bis zum Ende durchkaempfen.
    let reward: any = null
    for (let i = 0; i < 40 && !reward; i++) {
      h.resetRateLimits()
      const r = await h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)
      if (r.status !== 200) break
      reward = r.body.reward
    }
    expect(reward).toBeTruthy()
    expect(reward.won).toBe(true)
    expect(reward.event).toBeTruthy()
    expect(reward.event.gold).toBeGreaterThan(0)
    expect(reward.event.items.length).toBeGreaterThan(0)
    for (const item of reward.event.items) {
      // Sagenbeere und Lockduefte fallen einzeln, alles andere im Stapel.
      const single = item.itemId === 'legendary-berry' || item.itemId.startsWith('lure-')
      const min = single ? 1 : 2
      expect(item.quantity).toBeGreaterThanOrEqual(min)
    }
    // Das Gold ist auch wirklich eingebucht.
    expect((await h.get('/api/bag', token)).body.gold)
      .toBeGreaterThan(goldBefore + reward.event.gold - 1)
  })

  it('gibt bei einem gewoehnlichen Kampf keine Ereignisbeute', async () => {
    h.ctx.db.prepare('UPDATE trainers SET level_scaling = 0 WHERE id = ?').run(trainerId)
    const r = await startAgainst('test-rival')
    expect(r.status).toBe(200)
    let reward: any = null
    for (let i = 0; i < 40 && !reward; i++) {
      h.resetRateLimits()
      const step = await h.post('/api/battle/action', { kind: 'move', moveIndex: 0 }, token)
      if (step.status !== 200) break
      reward = step.body.reward
    }
    expect(reward?.event ?? null).toBeNull()
  })
})

describe('Nur ein Legendäres kämpft', () => {
  /**
   * Ein Legendäres ins Team setzen. `staerke` steuert die Werte über die
   * Anlagen — so lässt sich "das schwächste" gezielt herstellen, ohne am
   * Level zu drehen, an dem die Gegnerskalierung hängt.
   */
  const legendaeresInsTeam = (slot: number, iv: number) =>
    h.ctx.db.prepare(
      `INSERT INTO creatures (
         id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
         friendship, energy, hp_current, shiny, moves, caught_at, caught_area_id, team_slot
       ) VALUES (?, ?, 'sagenmon', 0, 90, 'hardy', ?, ?, ?, ?, ?, ?, 100, 100, 9999, 0, ?, ?, 'test-route', ?)`,
    ).run(
      `leg-${slot}`, trainerId, iv, iv, iv, iv, iv, iv,
      JSON.stringify(['tackle']), Date.now(), slot,
    )

  it('schickt bei zwei Legendären nur das schwächere ins Feld', async () => {
    legendaeresInsTeam(1, 31)   // das starke
    legendaeresInsTeam(2, 0)    // das schwache
    h.resetRateLimits(); h.resetPacing()

    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(r.status).toBe(200)

    const eigene = r.body.player.party.map((f: { id: string }) => f.id)
    expect(eigene).toContain('leg-2')
    expect(eigene).not.toContain('leg-1')
  })

  it('nennt das zusehende Legendäre im Garten beim Namen', async () => {
    // Ohne Ansage sieht ein Team, das im Kampf schrumpft, wie ein Fehler aus.
    legendaeresInsTeam(1, 31)
    legendaeresInsTeam(2, 0)
    const g = await h.get('/api/garden', token)

    const zuschauer = g.body.team.filter((c: { busyReason: string | null }) => c.busyReason === 'legendary')
    expect(zuschauer.map((c: { id: string }) => c.id)).toEqual(['leg-1'])
  })

})

describe('Legendäre fangen', () => {
  /** Eine legendäre Begegnung direkt setzen — der 0,1-Prozent-Wurf ist im
   *  Engine-Test abgedeckt, hier geht es um die Fangregeln. */
  const encounter = (berries = 0) =>
    h.ctx.db.prepare(
      `INSERT OR REPLACE INTO active_encounter
         (trainer_id, area_id, species_id, level, shiny, turn, weaken_stacks, calm_stacks,
          seed, started_at, legendary_berries)
       VALUES (?, 'test-route', 'sagenmon', 70, 0, 0, 0, 0, 'seed', ?, ?)`,
    ).run(trainerId, Date.now(), berries)

  const giveBerries = (n: number) =>
    h.ctx.db.prepare(
      'INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)',
    ).run(trainerId, 'legendary-berry', n)

  const view = async () => (await h.get('/api/safari?ballId=poke-ball', token)).body.encounter

  it('meldet die Begegnung als legendär und startet bei fünf Prozent', async () => {
    encounter()
    const e = await view()
    expect(e.legendary).toBe(true)
    expect(e.probability).toBeCloseTo(0.05, 5)
    expect(e.maxLegendaryBerries).toBe(3)
  })

  it('ignoriert den besseren Ball vollständig', async () => {
    encounter()
    const plain = (await h.get('/api/safari?ballId=poke-ball', token)).body.encounter.probability
    const better = (await h.get('/api/safari?ballId=great-ball', token)).body.encounter.probability
    expect(better).toBe(plain)
  })

  it('hebt die Chance je Sagenbeere um ein Viertel', async () => {
    encounter()
    giveBerries(3)
    for (const expected of [0.30, 0.55, 0.80]) {
      h.resetRateLimits()
      const r = await h.post('/api/safari/berry', { ballId: 'poke-ball' }, token)
      expect(r.status).toBe(200)
      expect(r.body.probability).toBeCloseTo(expected, 5)
    }
  })

  it('nimmt keine vierte Beere an', async () => {
    encounter(3)
    giveBerries(5)
    const r = await h.post('/api/safari/berry', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_maxed')
  })

  it('verbraucht die Beere aus dem Beutel', async () => {
    encounter()
    giveBerries(2)
    await h.post('/api/safari/berry', { ballId: 'poke-ball' }, token)
    const bag = (await h.get('/api/bag', token)).body.items
    expect(bag.find((i: any) => i.id === 'legendary-berry').quantity).toBe(1)
  })

  it('weist Sagenbeeren bei gewöhnlichen Pokémon ab', async () => {
    h.ctx.db.prepare(
      `INSERT OR REPLACE INTO active_encounter
         (trainer_id, area_id, species_id, level, shiny, turn, weaken_stacks, calm_stacks, seed, started_at, legendary_berries)
       VALUES (?, 'test-route', 'wildmon', 5, 0, 0, 0, 0, 'seed', ?, 0)`,
    ).run(trainerId, Date.now())
    giveBerries(1)
    const r = await h.post('/api/safari/berry', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_legendary')
  })

  it('verbraucht bei einem Legendären keine gewöhnliche Beere', async () => {
    encounter()
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, 5)')
      .run(trainerId, 'razz-berry')
    await h.post('/api/safari/throw', { ballId: 'poke-ball', berryId: 'razz-berry' }, token)
    const bag = (await h.get('/api/bag', token)).body.items
    expect(bag.find((i: any) => i.id === 'razz-berry').quantity).toBe(5)
  })
})

describe('Überfall auf Augenhöhe', () => {
  const pendEvent = () =>
    h.ctx.db.prepare('UPDATE trainers SET pending_event_id = ?, pending_event_area = ? WHERE id = ?')
      .run('event-rocket-anderswo', 'test-route', trainerId)

  const setTeamLevel = (level: number) =>
    h.ctx.db.prepare('UPDATE creatures SET level = ? WHERE owner_id = ? AND team_slot IS NOT NULL')
      .run(level, trainerId)

  it('richtet das Ueberfallteam am eigenen Median aus', async () => {
    // Der Ruepel ist im Entwurf Level 5. Ein Team auf 40 traefe ihn sonst als
    // Uebung — und dasselbe Team auf 5 traefe den Hoenn-Ueberfall als Wand.
    setTeamLevel(40)
    pendEvent()
    h.resetRateLimits()
    const r = await h.post('/api/battle/event', {}, token)
    expect(r.status).toBe(200)
    // Ein Mitglied im Entwurf, also genau die Mitte: Median minus zwei.
    expect(r.body.foe.active.level).toBe(38)
  })

  it('folgt dem Team auch nach unten', async () => {
    setTeamLevel(12)
    pendEvent()
    h.resetRateLimits()
    const r = await h.post('/api/battle/event', {}, token)
    expect(r.body.foe.active.level).toBe(10)
  })

  it('passt sich auch bei abgeschalteter Skalierung an', async () => {
    /*
     * Frueher stand hier das Gegenteil: wer die Skalierung abschaltet, wollte
     * die Zahlen des Entwurfs — ueberall. Fuer ein Gebiet stimmt das, denn es
     * hat einen Ort und ein entworfenes Niveau. Ein Ueberfall hat beides
     * nicht: er passiert dort, wo man gerade steht. Im echten Spiel stand
     * damit eine Rocket-Truppe auf Level 42 bis 46 vor einem Team auf 25, und
     * ausweichen konnte man ihr nicht.
     */
    h.ctx.db.prepare('UPDATE trainers SET level_scaling = 0 WHERE id = ?').run(trainerId)
    setTeamLevel(40)
    pendEvent()
    h.resetRateLimits()
    const r = await h.post('/api/battle/event', {}, token)
    expect(r.body.foe.active.level).toBeGreaterThan(30)
    expect(r.body.foe.active.level).toBeLessThanOrEqual(44)
  })
})

describe('Störsender', () => {
  const give = (itemId: string, n: number) =>
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
      .run(trainerId, itemId, n)

  it('braucht einen im Beutel', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/safari/jammer', {}, token)
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('insufficient_items')
  })

  it('setzt fuenf Ladungen und verbraucht das Geraet', async () => {
    give('rocket-bait', 1)
    h.resetRateLimits()
    const r = await h.post('/api/safari/jammer', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.charges).toBe(5)

    const left = h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'rocket-bait') as { quantity: number }
    expect(left.quantity).toBe(0)
  })

  it('addiert statt zu ueberschreiben', async () => {
    give('rocket-bait', 2)
    h.resetRateLimits(); await h.post('/api/safari/jammer', {}, token)
    h.resetRateLimits()
    expect((await h.post('/api/safari/jammer', {}, token)).body.charges).toBe(10)
  })

  it('macht aus den naechsten Erkundungen Ueberfaelle', async () => {
    // Der Ereignisgegner der Fixture haengt bewusst an keiner Region, damit
    // Safari-Tests nicht zufaellig werden — fuer diesen Test muss er greifen.
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
      .run('test-route', trainerId)
    give('rocket-bait', 1)
    h.resetRateLimits()
    await h.post('/api/safari/jammer', {}, token)

    let events = 0
    for (let i = 0; i < 5; i++) {
      h.resetRateLimits(); h.resetPacing()
      const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
      if (r.body.kind === 'event') events++
      h.resetRateLimits()
      await h.post('/api/battle/forfeit', {}, token)
    }
    expect(events).toBe(5)

    // Danach ist der Sender leer.
    h.resetRateLimits()
    expect((await h.get('/api/safari?ballId=poke-ball', token)).body.jammerCharges).toBe(0)
  })
})

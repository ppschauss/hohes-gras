import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PLOT_GROWTH_MS, PLOT_PHASES } from '@game/engine'
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
  h.ctx.db.prepare('UPDATE trainers SET gold = 50000, energy = 9000 WHERE id = ?').run(trainerId)
})
afterEach(async () => { await h.close() })

const plots = async () => (await h.get('/api/plots', token)).body
const slot0 = async () => (await plots()).plots[0]

/** Die Pflanzung in die Vergangenheit ruecken, statt vier Stunden zu warten. */
function ageplot(slot: number, ms: number): void {
  h.ctx.db.prepare(
    'UPDATE garden_plots SET planted_at = planted_at - ?, ready_at = ready_at - ? WHERE trainer_id = ? AND slot = ? AND harvested_at IS NULL',
  ).run(ms, ms, trainerId, slot)
}

function addPlant(level: number, nickname = 'Blatt'): string {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, nickname, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
       friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
     VALUES (?, ?, 'blattmon', ?, 0, ?, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '[]', ?, NULL)`,
  ).run(id, trainerId, nickname, level, Date.now())
  return id
}

describe('Poké-Beet', () => {
  it('zeigt vier leere Beete und was sich eingraben laesst', async () => {
    const d = await plots()
    expect(d.plots).toHaveLength(4)
    expect(d.plots.every((p: any) => p.stake === null)).toBe(true)
    // Startausruestung enthaelt Beeren — Baelle und Medizin nicht.
    const ids = d.plantable.map((p: any) => p.itemId)
    expect(ids).toContain('oran-berry')
    expect(ids).not.toContain('poke-ball')
    expect(ids).not.toContain('potion')
  })

  it('graebt Gegenstaende ein und bucht sie aus dem Beutel ab', async () => {
    const before = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry').quantity
    const r = await h.post('/api/plots/plant', { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 5 }, token)
    expect(r.status).toBe(200)

    const after = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry').quantity
    expect(after).toBe(before - 5)
    const plot = r.body.plots[0]
    expect(plot.stake).toMatchObject({ kind: 'item', itemId: 'oran-berry', amount: 5 })
    expect(plot.bonusPercent).toBe(50)
    expect(plot.payout).toBe(8)
  })

  it('graebt Gold ein und zieht es sofort ab', async () => {
    const before = (await h.get('/api/bag', token)).body.gold
    await h.post('/api/plots/plant', { slot: 1, kind: 'gold', amount: 500 }, token)
    expect((await h.get('/api/bag', token)).body.gold).toBe(before - 500)
  })

  it('laesst Gold nur einmal je 24 Stunden eingraben', async () => {
    const first = await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 500 }, token)
    expect(first.status).toBe(200)
    expect(first.body.goldReady).toBe(false)
    expect(first.body.goldReadyAt).toBeGreaterThan(Date.now())

    // Ein anderes Beet hilft nicht: die Sperre gilt fuer den Trainer.
    h.resetRateLimits()
    const second = await h.post('/api/plots/plant', { slot: 1, kind: 'gold', amount: 100 }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('gold_cooldown')

    // Gegenstaende bleiben davon unberuehrt.
    h.resetRateLimits()
    expect((await h.post('/api/plots/plant',
      { slot: 2, kind: 'item', itemId: 'oran-berry', amount: 2 }, token)).status).toBe(200)

    // Nach 24 Stunden geht es wieder.
    h.ctx.db.prepare('UPDATE garden_plots SET planted_at = planted_at - ? WHERE trainer_id = ?')
      .run(24 * 3_600_000, trainerId)
    h.resetRateLimits()
    expect((await h.get('/api/plots', token)).body.goldReady).toBe(true)
    h.resetRateLimits()
    expect((await h.post('/api/plots/plant', { slot: 3, kind: 'gold', amount: 500 }, token)).status).toBe(200)
  })

  it('sperrt auch nach der Ernte weiter bis zum naechsten Tag', async () => {
    await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 500 }, token)
    ageplot(0, PLOT_GROWTH_MS)
    h.resetRateLimits()
    expect((await h.post('/api/plots/harvest', { slot: 0 }, token)).status).toBe(200)

    h.resetRateLimits()
    const again = await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 500 }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('gold_cooldown')
  })

  it('deckelt den Einsatz', async () => {
    const tooMuchGold = await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 999999 }, token)
    expect(tooMuchGold.status).toBe(400)
    h.resetRateLimits()
    const tooManyItems = await h.post('/api/plots/plant', { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 999 }, token)
    expect(tooManyItems.status).toBe(400)
  })

  it('weist ein belegtes Beet und nicht pflanzbare Gegenstaende ab', async () => {
    await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 100 }, token)
    h.resetRateLimits()
    const busy = await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 100 }, token)
    expect(busy.status).toBe(409)
    expect(busy.body.detail.reason).toBe('plot_busy')

    h.resetRateLimits()
    const ball = await h.post('/api/plots/plant', { slot: 2, kind: 'item', itemId: 'poke-ball', amount: 1 }, token)
    expect(ball.status).toBe(409)
    expect(ball.body.detail.reason).toBe('not_plantable')
  })

  it('laesst einen Pflegeschritt erst zu, wenn er faellig ist', async () => {
    await h.post('/api/plots/plant', { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 4 }, token)
    h.resetRateLimits(); h.resetPacing()

    const early = await h.post('/api/plots/tend', { slot: 0 }, token)
    expect(early.status).toBe(409)
    expect(early.body.detail.reason).toBe('not_due')

    ageplot(0, PLOT_GROWTH_MS / PLOT_PHASES)
    h.resetRateLimits(); h.resetPacing()
    const ok = await h.post('/api/plots/tend', { slot: 0 }, token)
    expect(ok.status).toBe(200)
    expect(ok.body.kind).toBe('weed')
    expect(ok.body.phasesDone).toBe(1)
    expect(ok.body.bonusPercent).toBe(63)
  })

  it('hebt den Ertrag mit jedem Schritt bis auf hundert Prozent', async () => {
    await h.post('/api/plots/plant', { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 8 }, token)
    ageplot(0, PLOT_GROWTH_MS)
    for (let i = 0; i < PLOT_PHASES; i++) {
      h.resetRateLimits(); h.resetPacing()
      expect((await h.post('/api/plots/tend', { slot: 0 }, token)).status).toBe(200)
    }
    const plot = await slot0()
    expect(plot.phasesDone).toBe(PLOT_PHASES)
    expect(plot.bonusPercent).toBe(100)
    expect(plot.payout).toBe(16)

    h.resetRateLimits(); h.resetPacing()
    const over = await h.post('/api/plots/tend', { slot: 0 }, token)
    expect(over.status).toBe(409)
    expect(over.body.detail.reason).toBe('fully_tended')
  })

  it('kostet jeder Pflegeschritt Energie', async () => {
    await h.post('/api/plots/plant', { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 2 }, token)
    ageplot(0, PLOT_GROWTH_MS)
    const before = (await h.get('/api/energy', token)).body.state.current
    h.resetRateLimits(); h.resetPacing()
    await h.post('/api/plots/tend', { slot: 0 }, token)
    expect((await h.get('/api/energy', token)).body.state.current).toBe(before - 1)
  })

  it('laesst ein Pflanzen-Pokemon die Arbeit uebernehmen', async () => {
    const tender = addPlant(60)
    const r = await h.post('/api/plots/plant',
      { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 5, tenderId: tender }, token)
    expect(r.status).toBe(200)
    const plot = r.body.plots[0]
    // Level 60 → 50 + 30 = 80 Prozent, ohne einen einzigen Klick.
    expect(plot.tender.level).toBe(60)
    expect(plot.bonusPercent).toBe(80)
    expect(plot.phasesPending).toBe(0)
    expect(plot.payout).toBe(9)

    ageplot(0, PLOT_GROWTH_MS)
    h.resetRateLimits(); h.resetPacing()
    const tend = await h.post('/api/plots/tend', { slot: 0 }, token)
    expect(tend.status).toBe(409)
    expect(tend.body.detail.reason).toBe('tender_assigned')
  })

  it('macht ein Pokemon auf Level 100 die Handarbeit ueberfluessig', async () => {
    const tender = addPlant(100, 'Riese')
    await h.post('/api/plots/plant',
      { slot: 0, kind: 'gold', amount: 500, tenderId: tender }, token)
    const plot = await slot0()
    expect(plot.bonusPercent).toBe(100)
    expect(plot.payout).toBe(1000)
  })

  it('nimmt nur Pflanzen-Pokemon als Pfleger', async () => {
    const starter = (await h.get('/api/garden', token)).body.team[0].id
    const r = await h.post('/api/plots/plant',
      { slot: 0, kind: 'gold', amount: 100, tenderId: starter }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_a_plant')
  })

  it('laesst dasselbe Pokemon nicht zwei Beete pflegen', async () => {
    // Mit Gegenstaenden statt Gold: die Tagessperre fuers Gold wuerde sonst
    // vor der Pfleger-Pruefung zuschlagen und etwas anderes messen.
    const tender = addPlant(30)
    await h.post('/api/plots/plant',
      { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 2, tenderId: tender }, token)
    h.resetRateLimits()
    const second = await h.post('/api/plots/plant',
      { slot: 1, kind: 'item', itemId: 'oran-berry', amount: 2, tenderId: tender }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('already_tending')
  })

  it('laesst den Pfleger nachtraeglich wechseln und abziehen', async () => {
    const a = addPlant(20, 'Klein')
    const b = addPlant(80, 'Gross')
    await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 500, tenderId: a }, token)
    expect((await slot0()).bonusPercent).toBe(60)

    h.resetRateLimits()
    const swapped = await h.post('/api/plots/tender', { slot: 0, tenderId: b }, token)
    expect(swapped.body.plots[0].bonusPercent).toBe(90)

    h.resetRateLimits()
    const removed = await h.post('/api/plots/tender', { slot: 0, tenderId: null }, token)
    expect(removed.body.plots[0].tender).toBeNull()
    expect(removed.body.plots[0].bonusPercent).toBe(50)
  })

  it('erntet erst, wenn es reif ist — und dann genau einmal', async () => {
    await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 500 }, token)
    h.resetRateLimits()
    const early = await h.post('/api/plots/harvest', { slot: 0 }, token)
    expect(early.status).toBe(409)
    expect(early.body.detail.reason).toBe('not_ready')

    ageplot(0, PLOT_GROWTH_MS)
    const goldBefore = (await h.get('/api/bag', token)).body.gold
    h.resetRateLimits()
    const r = await h.post('/api/plots/harvest', { slot: 0 }, token)
    expect(r.status).toBe(200)
    expect(r.body.staked).toBe(500)
    expect(r.body.received).toBe(750)
    expect((await h.get('/api/bag', token)).body.gold).toBe(goldBefore + 750)
    expect(r.body.state.plots[0].stake).toBeNull()

    h.resetRateLimits()
    expect((await h.post('/api/plots/harvest', { slot: 0 }, token)).status).toBe(404)
  })

  it('schreibt geerntete Gegenstaende in den Beutel', async () => {
    const before = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry').quantity
    await h.post('/api/plots/plant', { slot: 0, kind: 'item', itemId: 'oran-berry', amount: 6 }, token)
    ageplot(0, PLOT_GROWTH_MS)
    h.resetRateLimits()
    const r = await h.post('/api/plots/harvest', { slot: 0 }, token)
    expect(r.body.received).toBe(9)
    const after = (await h.get('/api/bag', token)).body.items
      .find((i: any) => i.id === 'oran-berry').quantity
    expect(after).toBe(before - 6 + 9)
  })

  it('gibt ein fremdes Pokemon nicht als Pfleger her', async () => {
    const other = await h.addTrainer(222, 'Misty')
    await h.post('/api/starter', { speciesId: 'testmon' }, other.token)
    const theirs = (await h.get('/api/garden', other.token)).body.team[0].id
    const r = await h.post('/api/plots/plant', { slot: 0, kind: 'gold', amount: 100, tenderId: theirs }, token)
    expect(r.status).toBe(403)
  })
})

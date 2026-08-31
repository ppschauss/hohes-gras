import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENERGY_TO_GOLD_LIMIT } from '@game/engine'
import * as energyService from '../src/services/energy.js'
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

const setEnergy = (value: number) =>
  h.ctx.db.prepare('UPDATE trainers SET energy = ?, energy_updated_at = ? WHERE id = ?')
    .run(value, Date.now(), trainerId)

const energyOf = async () => (await h.get('/api/energy', token)).body.state.current

describe('Energie', () => {
  it('liefert Stand, Kosten, Belohnungen und Pakete', async () => {
    const r = await h.get('/api/energy', token)
    expect(r.status).toBe(200)
    expect(r.body.state.current).toBeGreaterThan(0)
    expect(r.body.state.cap).toBeGreaterThanOrEqual(r.body.state.current)
    expect(r.body.costs.care).toBeGreaterThan(0)
    expect(r.body.rewards.badge).toBeGreaterThan(0)
    expect(r.body.packs.length).toBeGreaterThanOrEqual(3)
    expect(r.body.packs[0].pricePerPoint).toBeGreaterThan(0)
  })

  it('steht auch im Startzustand der App', async () => {
    const r = await h.get('/api/state', token)
    expect(r.body.energy.current).toBeGreaterThan(0)
    expect(r.body.energyCosts.explore).toBeGreaterThan(0)
    expect(r.body.energyPacks.length).toBeGreaterThan(0)
  })

  it('kauft ein Paket und zieht das Gold ab', async () => {
    h.ctx.db.prepare('UPDATE trainers SET gold = 5000 WHERE id = ?').run(trainerId)
    setEnergy(10)
    const before = (await h.get('/api/bag', token)).body.gold

    const r = await h.post('/api/energy/buy', { packId: 'energy-small' }, token)
    expect(r.status).toBe(200)
    expect(r.body.state.current).toBe(20)
    expect(r.body.gold).toBeLessThan(before)
  })

  it('laesst den Kauf ueber die Obergrenze hinaus zu', async () => {
    // Gekaufte Energie soll nicht verfallen, nur weil das Konto voll war.
    h.ctx.db.prepare('UPDATE trainers SET gold = 99999 WHERE id = ?').run(trainerId)
    const cap = (await h.get('/api/energy', token)).body.state.cap
    setEnergy(cap)
    const r = await h.post('/api/energy/buy', { packId: 'energy-large' }, token)
    expect(r.body.state.current).toBeGreaterThan(cap)
  })

  it('weist einen Kauf ohne Gold ab', async () => {
    h.ctx.db.prepare('UPDATE trainers SET gold = 0 WHERE id = ?').run(trainerId)
    const r = await h.post('/api/energy/buy', { packId: 'energy-large' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_funds')
  })

  it('weist ein unbekanntes Paket ab', async () => {
    const r = await h.post('/api/energy/buy', { packId: 'gratis' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('validation_failed')
  })

  it('kostet beim Erkunden Energie und blockt bei leerem Konto', async () => {
    const costs = (await h.get('/api/energy', token)).body.costs
    const before = await energyOf()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(200)
    expect(await energyOf()).toBe(before - costs.explore)

    h.resetPacing()
    setEnergy(0)
    const broke = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    expect(broke.status).toBe(409)
    expect(broke.body.error).toBe('insufficient_energy')
    expect(broke.body.detail.need).toBe(costs.explore)
  })

  it('zieht fuer eine Expedition nach Dauer unterschiedlich viel ab', async () => {
    const durations = (await h.get('/api/expeditions', token)).body.durations
    const short = durations.find((d: any) => d.id === 'short').trainerEnergyCost
    const long = durations.find((d: any) => d.id === 'long').trainerEnergyCost
    expect(long).toBeGreaterThan(short)

    const creature = (await h.get('/api/garden', token)).body.team[0].id
    const before = await energyOf()
    await h.post('/api/expeditions', { kind: 'patrol', duration: 'long', creatureIds: [creature] }, token)
    expect(await energyOf()).toBe(before - long)
  })

  it('kostet nichts, wenn die Aktion abgelehnt wird', async () => {
    // Fuettern ohne Beeren: die Ablehnung darf kein Guthaben verbrennen.
    await h.post('/api/shop/sell', { itemId: 'oran-berry', quantity: 8 }, token)
    const before = await energyOf()
    const r = await h.post('/api/garden/care', { action: 'feed' }, token)
    expect(r.status).toBe(400)
    expect(await energyOf()).toBe(before)
  })

  it('regeneriert ueber die Zeit bis zur Obergrenze', async () => {
    const cap = (await h.get('/api/energy', token)).body.state.cap
    // Vor einer Stunde geleert: ein Teil ist zurueck, voll ist es noch nicht.
    h.ctx.db.prepare('UPDATE trainers SET energy = 0, energy_updated_at = ? WHERE id = ?')
      .run(Date.now() - 3_600_000, trainerId)
    const after = await energyOf()
    expect(after).toBeGreaterThan(0)
    expect(after).toBeLessThan(cap)

    h.ctx.db.prepare('UPDATE trainers SET energy = 0, energy_updated_at = ? WHERE id = ?')
      .run(Date.now() - 100 * 3_600_000, trainerId)
    expect(await energyOf()).toBe(cap)
  })

  it('nennt einen Zeitpunkt fuer den naechsten Punkt, solange nicht voll', async () => {
    setEnergy(1)
    const partial = (await h.get('/api/energy', token)).body.state
    expect(partial.nextPointAt).toBeGreaterThan(Date.now())
    expect(partial.fullAt).toBeGreaterThan(partial.nextPointAt)

    setEnergy(partial.cap)
    const full = (await h.get('/api/energy', token)).body.state
    expect(full.nextPointAt).toBeNull()
    expect(full.fullAt).toBeNull()
  })

  it('gibt fuer einen gewonnenen Kampf Energie zurueck', async () => {
    const rewards = (await h.get('/api/energy', token)).body.rewards
    // Das Testteam gewinnt gegen den Rivalen nicht zuverlaessig, deshalb wird
    // hier der Weg ueber den Dienst geprueft: Belohnung buchen und nachsehen.
    const { reward } = await import('../src/services/energy.js')
    setEnergy(10)
    reward(h.ctx, trainerId, 'battleWon')
    expect(await energyOf()).toBe(10 + rewards.battleWon)
  })

  it('protokolliert Verbrauch und Gutschrift', async () => {
    await h.post('/api/garden/care', { action: 'rest' }, token)
    const rows = h.ctx.db
      .prepare("SELECT kind FROM event_log WHERE trainer_id = ? AND kind LIKE 'energy.%'")
      .all(trainerId) as Array<{ kind: string }>
    expect(rows.some((r) => r.kind === 'energy.spend')).toBe(true)
  })
})

describe('Energie mit Ausbau-Bonus', () => {
  it('ueberlebt eine krumme Regenerationsrate', async () => {
    // Das Rasthaus hebt die Rate auf 17 Punkte/Stunde — kein glatter Teiler von
    // einer Stunde. Der daraus gerechnete Zeitstempel war gebrochen und liess
    // sich in der STRICT-Tabelle nicht speichern: jeder Start der App endete
    // mit einem 500er.
    h.ctx.db.prepare(
      "INSERT INTO buildings (trainer_id, building_id, level, built_at) VALUES (?, 'rest-house', 1, ?)",
    ).run(trainerId, Date.now())
    h.ctx.db.prepare('UPDATE trainers SET energy = 0, energy_updated_at = ? WHERE id = ?')
      .run(Date.now() - 3 * 3_600_000, trainerId)

    const state = await h.get('/api/state', token)
    expect(state.status).toBe(200)
    // Entscheidend ist nicht die Zahl, sondern dass sie 3.600.000 nicht glatt
    // teilt — genau daraus entstand der gebrochene Zeitstempel.
    expect(3_600_000 % state.body.energy.perHour).not.toBe(0)
    expect(state.body.energy.current).toBeGreaterThan(0)

    const stored = h.ctx.db.prepare('SELECT energy_updated_at AS at FROM trainers WHERE id = ?')
      .get(trainerId) as { at: number }
    expect(Number.isInteger(stored.at)).toBe(true)
  })
})

describe('Energieanzeige nach dem Verbrauch', () => {
  /**
   * Der Client aktualisiert die Kopfzeile aus jedem Feld `energy` in einer
   * Antwort. Ausgerechnet den Endpunkten, die Energie *verbrauchen*, fehlte
   * es — der Balken stand still, bis ein Neuladen den Stand holte.
   */
  it('schickt den neuen Stand in derselben Antwort mit', async () => {
    const before = (await h.get('/api/energy', token)).body.state.current

    h.resetRateLimits()
    const care = await h.post('/api/garden/care', { action: 'rest' }, token)
    expect(care.status).toBe(200)
    expect(care.body.energy).toBeTruthy()
    expect(care.body.energy.current).toBeLessThan(before)

    // Und der mitgeschickte Stand stimmt mit dem ueberein, den ein eigener
    // Abruf liefert — sonst zeigte die Kopfzeile eine zweite Wahrheit.
    h.resetRateLimits()
    expect((await h.get('/api/energy', token)).body.state.current).toBe(care.body.energy.current)
  })

  it('gilt auch fuers Erkunden', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    const before = (await h.get('/api/energy', token)).body.state.current
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(200)
    expect(r.body.energy.current).toBeLessThan(before)
  })
})

describe('Ueberschuss wird Gold', () => {
  it('wandelt jeden Punkt ueber der Grenze in Gold', async () => {
    // Bis hierher war der Ueberschuss einfach weg — ein Spieler hat dafuer
    // ueber 16.000 Punkte verloren, ohne dass es irgendwo stand.
    h.ctx.db.prepare('UPDATE trainers SET energy = ? WHERE id = ?')
      .run(ENERGY_TO_GOLD_LIMIT - 10, trainerId)
    const goldBefore = (await h.get('/api/bag', token)).body.gold

    energyService.grant(h.ctx, trainerId, 50, 'test')

    const after = h.ctx.db.prepare('SELECT energy FROM trainers WHERE id = ?')
      .get(trainerId) as { energy: number }
    expect(after.energy).toBe(ENERGY_TO_GOLD_LIMIT)
    h.resetRateLimits()
    const goldAfter = (await h.get('/api/bag', token)).body.gold
    expect(goldAfter).toBe(goldBefore + 40)
  })

  it('laesst alles unter der Grenze als Energie stehen', () => {
    h.ctx.db.prepare('UPDATE trainers SET energy = 5 WHERE id = ?').run(trainerId)
    energyService.grant(h.ctx, trainerId, 20, 'test')
    const after = h.ctx.db.prepare('SELECT energy FROM trainers WHERE id = ?')
      .get(trainerId) as { energy: number }
    expect(after.energy).toBe(25)
  })
})

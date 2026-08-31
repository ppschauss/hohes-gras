import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ENERGY_MAX, ENERGY_REGEN_BOX_PER_HOUR, ENERGY_REGEN_PER_HOUR } from '@game/engine'
import { catchUpEnergy } from '../src/services/garden.js'
import { findById } from '../src/repos/trainers.js'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

/**
 * Erholung von Team und Box.
 *
 * Gemeldet als „ich glaube nicht, dass sich die Pokémon in den Boxen erholen" —
 * und das stimmte: die Erholung hing an `last_seen_at`, den jede Anfrage neu
 * setzt. Wer alle fünf Minuten hereinsah, bekam nie etwas, weil die Funktion
 * unter zehn Minuten ausstieg und die verstrichene Zeit trotzdem verfiel.
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
})
afterEach(async () => { await h.close() })

/** Ein erschöpftes Pokémon in die Box legen und seine Id zurückgeben. */
const boxed = (energy: number): string => {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, level, xp, nature, shiny,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe,
       hp_current, friendship, energy, caught_at, moves)
     VALUES (?, ?, 'wildmon', 20, 0, 'hardy', 0, 15,15,15,15,15,15, 0,0,0,0,0,0, 50, 70, ?, ?, ?)`,
  ).run(id, trainerId, energy, Date.now(), JSON.stringify([{ moveId: 'tackle', pp: 35 }]))
  return id
}

const energyOf = (id: string): number =>
  (h.ctx.db.prepare('SELECT energy FROM creatures WHERE id = ?').get(id) as { energy: number }).energy

const tick = (at: number) => catchUpEnergy(h.ctx, findById(h.ctx.db, trainerId)!, at)

describe('Erholung in der Box', () => {
  it('fuellt ein erschoepftes Pokemon in einer Stunde auf', () => {
    const id = boxed(0)
    const t0 = Date.now()
    tick(t0)               // Uhr anwerfen
    tick(t0 + 3_600_000)
    expect(energyOf(id)).toBe(ENERGY_MAX)
    expect(ENERGY_REGEN_BOX_PER_HOUR).toBe(ENERGY_MAX)
  })

  it('erholt auch dann, wenn jemand alle zwei Minuten hereinsieht', () => {
    /*
     * Der gemeldete Fall.
     *
     * Vorher kam hier **null** heraus: unter zehn Minuten stieg die Funktion
     * aus, und `last_seen_at` war trotzdem schon zurueckgesetzt. Genau das war
     * an einem echten Spielstand zu sehen — 40 von 100 eingelagerten Pokemon
     * standen seit Tagen auf demselben Wert.
     */
    const id = boxed(0)
    const t0 = Date.now()
    tick(t0)
    for (let i = 1; i <= 30; i++) tick(t0 + i * 120_000)  // 30 x 2 Minuten = 1 h
    expect(energyOf(id)).toBe(ENERGY_MAX)
  })

  it('schreibt nichts ueber die Obergrenze hinaus', () => {
    const id = boxed(90)
    const t0 = Date.now()
    tick(t0)
    tick(t0 + 3_600_000)
    expect(energyOf(id)).toBe(ENERGY_MAX)
  })

  it('schenkt nichts fuer die Zeit vor der ersten Uhr', () => {
    const id = boxed(10)
    // Die Uhr steht auf 0 — der Trainer war nie da. Der erste Tick darf
    // deshalb nichts gutschreiben, sondern nur anfangen zu laufen.
    tick(Date.now())
    expect(energyOf(id)).toBe(10)
  })
})

describe('Erholung im Team', () => {
  it('ist deutlich langsamer als in der Box', () => {
    const box = boxed(0)
    const teamId = (h.ctx.db.prepare(
      'SELECT id FROM creatures WHERE owner_id = ? AND team_slot IS NOT NULL',
    ).get(trainerId) as { id: string }).id
    h.ctx.db.prepare('UPDATE creatures SET energy = 0 WHERE id = ?').run(teamId)

    const t0 = Date.now()
    tick(t0)
    tick(t0 + 3_600_000)
    expect(energyOf(box)).toBe(ENERGY_MAX)
    expect(energyOf(teamId)).toBe(ENERGY_REGEN_PER_HOUR)
  })

  it('verliert bei haeufigen Blicken nichts', () => {
    const teamId = (h.ctx.db.prepare(
      'SELECT id FROM creatures WHERE owner_id = ? AND team_slot IS NOT NULL',
    ).get(trainerId) as { id: string }).id
    h.ctx.db.prepare('UPDATE creatures SET energy = 0 WHERE id = ?').run(teamId)

    const t0 = Date.now()
    tick(t0)
    for (let i = 1; i <= 60; i++) tick(t0 + i * 60_000)
    expect(energyOf(teamId)).toBe(ENERGY_REGEN_PER_HOUR)
  })
})

describe('Wo die Erholung nachgezogen wird', () => {
  it('auch in der Expeditionsuebersicht, nicht nur im Garten', async () => {
    const id = boxed(0)
    // Uhr anwerfen und eine Stunde zurueckdatieren.
    h.ctx.db.prepare('UPDATE trainers SET box_energy_at = ? WHERE id = ?')
      .run(Date.now() - 3_600_000, trainerId)
    h.resetRateLimits()
    await h.get('/api/expeditions', token)
    // Ohne das stuende hier die Ausdauer von zuletzt, und ein Pokemon saehe zu
    // erschoepft aus, obwohl es laengst wieder koennte.
    expect(energyOf(id)).toBe(ENERGY_MAX)
  })
})

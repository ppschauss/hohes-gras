import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BOTS, ensureBots, spieleZug, starterFuer, tick } from '../src/services/botPlayer.js'
import { assertPace } from '../src/services/pacing.js'
import { starterSpeciesFor } from '../src/services/garden.js'
import { createTrainer } from '../src/repos/trainers.js'
import { dueReminders } from '../src/services/reminders.js'
import { makeTestApp, type TestApp } from './helpers.js'

let h: TestApp

beforeEach(async () => { h = await makeTestApp() })
afterEach(async () => { await h.close() })

/** Ein vorhersagbarer Wuerfel: derselbe Durchlauf soll sich wiederholen lassen. */
const festerWuerfel = (werte: number[]): () => number => {
  let i = 0
  return () => werte[i++ % werte.length]!
}

describe('Bot-Spieler anlegen', () => {
  it('legt drei Trainer mit Starter und Ausruestung an', () => {
    const bots = ensureBots(h.ctx, festerWuerfel([0.1]))
    expect(bots).toHaveLength(BOTS.length)
    for (const bot of bots) {
      expect(bot.isBot).toBe(true)
      expect(h.ctx.db.prepare('SELECT COUNT(*) c FROM creatures WHERE owner_id = ?')
        .get(bot.id)).toMatchObject({ c: 1 })
      // Mindestens die Ausstattung; der Starter legt noch eigene Baelle dazu.
      const baelle = h.ctx.db.prepare('SELECT quantity q FROM inventory WHERE trainer_id = ? AND item_id = ?')
        .get(bot.id, 'poke-ball') as { q: number }
      expect(baelle.q).toBeGreaterThanOrEqual(30)
    }
  })

  /*
   * Der Aufruf steht in einer getakteten Aufgabe und passiert damit alle
   * zwanzig Minuten neu. Ohne diese Eigenschaft haette der Server nach einem
   * Tag zweiundsiebzig Miras.
   */
  it('legt bei erneutem Aufruf keine zweiten Konten an', () => {
    const erste = ensureBots(h.ctx, festerWuerfel([0.1]))
    const zweite = ensureBots(h.ctx, festerWuerfel([0.9]))
    expect(zweite.map((b) => b.id)).toEqual(erste.map((b) => b.id))
    expect(h.ctx.db.prepare('SELECT COUNT(*) c FROM trainers WHERE is_bot = 1').get())
      .toMatchObject({ c: BOTS.length })
  })
})

describe('Die Wahl des Startpokemon', () => {
  /*
   * Der Fehler, den dieser Test festhaelt, war live: `starterSpeciesFor`
   * liefert ohne Regionsangabe die Arten *aller* Startregionen zusammen,
   * `chooseStarter` prueft die Wahl aber nur gegen die erste. Zwei von drei
   * Bots standen deshalb ohne Startpokemon da — und weil die Absage
   * abgefangen wurde, ohne dass es jemand sah.
   */
  it('waehlt nur Arten, die zur gewaehlten Region gehoeren', () => {
    const t = createTrainer(h.ctx.db, {
      telegramId: 'probe-starter', displayName: 'Probe', locale: 'de', isAdmin: false,
      startingGold: 0, startingAreaId: h.ctx.registry.manifest.startingArea,
    })
    // Ueber viele Wuerfe, damit nicht ein guenstiger Zufall den Test besteht.
    for (let i = 0; i < 50; i++) {
      const wahl = starterFuer(h.ctx, t, () => i / 50)
      expect(wahl).not.toBeNull()
      expect(starterSpeciesFor(h.ctx, t, wahl!.regionId)).toContain(wahl!.speciesId)
    }
  })

  it('gibt jedem Bot wirklich ein Startpokemon', () => {
    for (const bot of ensureBots(h.ctx, festerWuerfel([0.37]))) {
      const eintrag = h.ctx.db
        .prepare("SELECT COUNT(*) c FROM event_log WHERE trainer_id = ? AND kind = 'starter.chosen'")
        .get(bot.id) as { c: number }
      expect(eintrag.c).toBe(1)
    }
  })
})

describe('Bot-Spieler handeln', () => {
  it('erkundet und pflegt, ohne zu stolpern', () => {
    const bots = ensureBots(h.ctx, festerWuerfel([0.1]))
    // Abwechselnd jagen und pflegen: 0.1 liegt unter jeder Jagdlust, 0.99 darueber.
    const bericht = spieleZug(h.ctx, bots[0]!, BOTS[0]!, 8, festerWuerfel([0.1, 0.99, 0.4, 0.7]))
    expect(bericht.erkundet + bericht.gepflegt).toBeGreaterThan(0)
  })

  it('haelt sich an die Energie und bricht nicht ab, wenn sie leer ist', () => {
    const bots = ensureBots(h.ctx, festerWuerfel([0.1]))
    const bot = bots[0]!
    h.ctx.db.prepare('UPDATE trainers SET energy = 0, energy_updated_at = ? WHERE id = ?')
      .run(Date.now(), bot.id)

    // Ohne Energie darf nichts passieren — aber es darf auch nichts werfen.
    const bericht = spieleZug(h.ctx, bot, BOTS[0]!, 5, festerWuerfel([0.1]))
    expect(bericht.erkundet).toBe(0)
  })

  it('laeuft ueber alle Bots und meldet je einen Bericht', () => {
    const berichte = tick(h.ctx, 3, festerWuerfel([0.2, 0.8, 0.5]))
    expect(berichte).toHaveLength(BOTS.length)
    expect(berichte.map((b) => b.name)).toEqual(BOTS.map((b) => b.name))
  })
})

describe('Die Box eines Bots', () => {
  /*
   * Gemessen, bevor es diese Grenze gab: die drei Bots fingen rund
   * sechshundert Pokemon am Tag, und nach siebzehn Stunden gehoerte ihnen ein
   * Drittel aller Pokemon in der Datenbank. Bei neunhundert Plaetzen waeren
   * sie nach fuenf Wochen voll gewesen und danach stehengeblieben.
   */
  it('verwertet Ueberzaehliges und bleibt in der Naehe des Ziels', () => {
    const bot = ensureBots(h.ctx, festerWuerfel([0.37]))[0]!
    const art = h.ctx.registry.manifest.starterSpeciesIds[0]!
    const setzen = h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, nickname, level, xp, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe,
         friendship, energy, hp_current, shiny, moves, held_item, caught_at, caught_area_id, team_slot)
       VALUES (?, ?, ?, NULL, ?, 0, 'hardy', 5,5,5,5,5,5, 0,0,0,0,0,0, 50, 100, 20, 0, '[]', NULL, ?, NULL, NULL)`,
    )
    for (let i = 0; i < 80; i++) {
      setzen.run(crypto.randomUUID(), bot.id, art, 3 + (i % 20), Date.now())
    }
    const vorher = h.ctx.db.prepare('SELECT COUNT(*) c FROM creatures WHERE owner_id = ?')
      .get(bot.id) as { c: number }
    expect(vorher.c).toBeGreaterThan(80)

    // Mehrere Zuege: es wird bewusst langsam abgebaut, nicht in einem Schlag.
    for (let i = 0; i < 12; i++) spieleZug(h.ctx, bot, BOTS[0]!, 0, festerWuerfel([0.99]))

    const box = h.ctx.db.prepare('SELECT COUNT(*) c FROM creatures WHERE owner_id = ? AND team_slot IS NULL')
      .get(bot.id) as { c: number }
    expect(box.c).toBeLessThanOrEqual(50)
  })

  it('verwertet nie, was gerade zum Verkauf steht', () => {
    const bot = ensureBots(h.ctx, festerWuerfel([0.37]))[0]!
    const art = h.ctx.registry.manifest.starterSpeciesIds[0]!
    const setzen = h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, nickname, level, xp, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe,
         friendship, energy, hp_current, shiny, moves, held_item, caught_at, caught_area_id, team_slot)
       VALUES (?, ?, ?, NULL, 2, 0, 'hardy', 5,5,5,5,5,5, 0,0,0,0,0,0, 50, 100, 20, 0, '[]', NULL, ?, NULL, NULL)`,
    )
    const ids: string[] = []
    for (let i = 0; i < 80; i++) {
      const id = crypto.randomUUID()
      ids.push(id)
      setzen.run(id, bot.id, art, Date.now())
    }
    // Das schwaechste anbieten — genau das, was sonst zuerst verwertet wuerde.
    const angeboten = ids[0]!
    h.ctx.db.prepare(
      `INSERT INTO market_listings (id, seller_id, creature_id, price, note, created_at)
       VALUES (?, ?, ?, 500, '', ?)`,
    ).run(crypto.randomUUID(), bot.id, angeboten, Date.now())

    for (let i = 0; i < 12; i++) spieleZug(h.ctx, bot, BOTS[0]!, 0, festerWuerfel([0.99]))

    const lebt = h.ctx.db.prepare('SELECT COUNT(*) c FROM creatures WHERE id = ?')
      .get(angeboten) as { c: number }
    expect(lebt.c).toBe(1)
  })
})

describe('Was Bots nicht ausloesen duerfen', () => {
  /*
   * Die Taktsperre misst, ob zwischen zwei Handlungen genug Zeit fuer einen
   * Menschen liegt. In der Schleife des Servers liegen Millisekunden dazwischen
   * — ohne Ausnahme haette der erste Durchlauf den Bot fuer Minuten gesperrt.
   */
  it('bremst Bots nicht mit der Taktsperre', () => {
    const bot = ensureBots(h.ctx, festerWuerfel([0.1]))[0]!
    for (let i = 0; i < 20; i++) {
      expect(() => assertPace(h.ctx, bot, 'explore')).not.toThrow()
    }
  })

  it('schickt keine Telegram-Erinnerungen an Bots', () => {
    ensureBots(h.ctx, festerWuerfel([0.1]))
    // Lange nicht gesehen: genau der Fall, der sonst eine Erinnerung ausloest.
    h.ctx.db.prepare('UPDATE trainers SET last_seen_at = ? WHERE is_bot = 1')
      .run(Date.now() - 7 * 24 * 3_600_000)
    const faellig = dueReminders(h.ctx)
    const botIds = new Set(
      (h.ctx.db.prepare('SELECT id FROM trainers WHERE is_bot = 1').all() as Array<{ id: string }>)
        .map((r) => r.id),
    )
    expect(faellig.filter((r) => botIds.has(r.trainerId))).toHaveLength(0)
  })
})

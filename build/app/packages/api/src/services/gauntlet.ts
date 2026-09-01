import { GameError, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import type { TrainerDef } from '@game/content'
import {
  createRng, computeStats, gauntletGoldPerWin, gauntletIv, gauntletLevel,
  GAUNTLET_FOES_PER_FIGHT, GAUNTLET_FULL_HEAL_EVERY, GAUNTLET_MILESTONES, gauntletHeals,
  GAUNTLET_XP_MULTIPLIER, gauntletMaxBst, gauntletXpMultiplier, isLegendarySpecies,
  milestoneAt, nextMilestone,
  rollGauntletDrops,
  splitDrops, dropTableFor,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as battles from '../repos/battles.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { beginBattle, forfeit } from './battle.js'
import { bumpMetric } from './progression.js'
import * as energy from './energy.js'
import { capOf } from './travel.js'
import { worldMap } from './world.js'

/**
 * Die Kampfzone.
 *
 * Der Aufbau folgt bewusst der Trainingsarena: ein laufender Durchgang je
 * Trainer, der Server entscheidet nichts von sich aus, sondern liest nach
 * jedem Kampf dessen Ergebnis. Was anders ist, steht in `engine/gauntlet.ts` —
 * kein festes Ende, dafür eine Serie, und die Beute hängt an der Region.
 */

interface Run {
  trainerId: string
  regionId: string
  streak: number
  battleId: string | null
  startedAt: number
  /** Was der Lauf bisher eingebracht hat — fuer die Abrechnung am Ende. */
  totalGold: number
  totalXp: number
  loot: string
}

const runOf = (ctx: AppContext, trainerId: string): Run | null =>
  (ctx.db.prepare(
    `SELECT trainer_id AS trainerId, region_id AS regionId, streak,
            battle_id AS battleId, started_at AS startedAt,
            total_gold AS totalGold, total_xp AS totalXp, loot
       FROM gauntlet_runs WHERE trainer_id = ?`,
  ).get(trainerId) as Run | undefined) ?? null

const bestOf = (ctx: AppContext, trainerId: string, regionId: string): number =>
  (ctx.db.prepare('SELECT best FROM gauntlet_bests WHERE trainer_id = ? AND region_id = ?')
    .get(trainerId, regionId) as { best: number } | undefined)?.best ?? 0

/** Das Durchschnittslevel des Teams — die Gegner richten sich danach. */
function averageLevel(ctx: AppContext, trainerId: string): number {
  const team = creatures.teamOf(ctx.db, trainerId)
  if (team.length === 0) return 5
  return team.reduce((sum, c) => sum + c.level, 0) / team.length
}

/**
 * Welche Regionen offenstehen.
 *
 * Nicht ueber `area_progress` — dort steht nur, wo jemand *war*, und eine
 * Spalte `unlocked` gibt es gar nicht. Die Freischaltung ist abgeleitet und
 * lebt in `worldMap`; sie hier ein zweites Mal zu rechnen waere eine zweite
 * Wahrheit, die beim naechsten Content-Wechsel falsch wird.
 */
function openRegions(ctx: AppContext, trainer: Trainer): string[] {
  const karte = worldMap(ctx, trainer)
  return karte.regions
    /*
     * Wo man schon war, darf man kaempfen.
     *
     * Nicht `!locked` als Bedingung: `locked` heisst „verschlossen, weil die
     * laufende Region noch offen ist" und gilt damit auch fuer die laengst
     * **bezwungenen**. Das ist fuer die Reise richtig — man soll nicht
     * vorspringen —, fuer die Rueckkehr aber falsch. Gemessen an einem echten
     * Spielstand: Kanto und Johto durch, Hoenn offen, und es stand nur Hoenn
     * zur Wahl.
     */
    .filter((r) => r.entered || r.cleared || r.areas.some((a) => a.visited || a.isCurrent))
    .map((r) => r.id)
}

/**
 * Der nächste Gegner: ein einzelnes wildes Pokémon aus der Region.
 *
 * Gezogen wird aus den Spawn-Tabellen der Region, nicht aus allen Arten —
 * eine Kampfzone in Kanto soll sich nach Kanto anfühlen.
 */
function buildFoe(ctx: AppContext, trainer: Trainer, regionId: string, streak: number): TrainerDef {
  const areas = ctx.registry.allAreas.filter((a) => a.regionId === regionId)
  const ids = new Set(areas.flatMap((a) => a.spawns.map((sp) => sp.speciesId)))
  /*
   * Wer antreten darf.
   *
   * Die Grundwertsumme ist der Filter, nicht der Fangwert. Gemeldet nach dem
   * ersten Lauf: Rayquaza als *erster* Gegner — im Pack steht dort Fangwert
   * 45, der Legendaer-Test lief ins Leere. Die Summe misst, was man spuert.
   */
  const grenze = gauntletMaxBst(streak)
  const alle = [...ids]
    .map((id) => ctx.registry.trySpecies(id))
    .filter((s): s is NonNullable<typeof s> =>
      s !== undefined && !s.event && !isLegendarySpecies(s))
  const pool = alle.filter((s) => grenze === 0 || baseStatTotal(s) <= grenze)
  // Faellt eine Region durch das Raster, lieber ein zu starker Gegner als gar
  // keiner — ein Lauf, der nicht anfaengt, ist schlechter als ein harter.
  const wahl = pool.length > 0 ? pool : alle
  if (wahl.length === 0) throw new GameError('invalid_state', { reason: 'no_species_here', regionId }, 409)

  const rng = createRng(`gauntlet:${trainer.id}:${regionId}:${streak}`)
  const species = rng.pick(wahl)
  const level = gauntletLevel(averageLevel(ctx, trainer.id), streak, capOf(ctx, trainer))
  const name = ctx.registry.localized(species.name, trainer.locale)

  return {
    id: `gauntlet-${regionId}-${streak}`,
    name: { de: `Wildes ${name}` },
    title: { de: 'Kampfzone' },
    kind: 'trainer',
    sprite: species.sprite,
    team: Array.from({ length: GAUNTLET_FOES_PER_FIGHT }, () => ({ speciesId: species.id, level })),
    badgeId: null,
    rewardGold: gauntletGoldPerWin(streak),
    xpMultiplier: gauntletXpMultiplier(streak),
    repeatRewardRatio: 1,
    dialogue: {
      intro: { de: `Nummer ${streak + 1} stellt sich dir.` },
      win: { de: 'Deine Serie endet hier.' },
      lose: { de: 'Weiter geht es.' },
    },
  }
}

/** Die Summe der Grundwerte — das Mass, an dem die Staerke wirklich haengt. */
const baseStatTotal = (s: { baseStats: Record<string, number> }): number =>
  Object.values(s.baseStats).reduce((sum, v) => sum + v, 0)

/**
 * Heilen — und an den Stufen auch beleben.
 *
 * Der Unterschied ist der ganze Punkt. Nach einem Sieg gibt es ein paar
 * Prozent, und wer fällt, bleibt liegen: das ist das Risiko der Serie. An
 * einer **Stufe** steht das Team wieder vollzählig auf — sie ist der
 * Rastplatz, und ohne das Beleben wäre sie nur ein halber.
 *
 * Vorher wurden Besiegte auch dort übersprungen (`hpCurrent <= 0` führte zum
 * `continue`). Damit schrumpfte das Team über einen langen Lauf auf den
 * letzten Stehenden zusammen — und weil nur antritt, wer noch steht, bekam am
 * Ende auch nur der noch Erfahrung. Genau so gemeldet.
 */
function heal(ctx: AppContext, trainerId: string, percent: number, revive: boolean): number {
  let healed = 0
  for (const c of creatures.teamOf(ctx.db, trainerId)) {
    const species = ctx.registry.species(c.speciesId)
    const max = computeStats(species, c.level, c.ivs, c.evs, c.nature).hp
    if (c.hpCurrent >= max) continue
    if (c.hpCurrent <= 0 && !revive) continue
    const next = Math.min(max, c.hpCurrent + Math.max(1, Math.round(max * percent / 100)))
    creatures.setHp(ctx.db, c.id, next)
    healed += next - c.hpCurrent
  }
  return healed
}

export function view(ctx: AppContext, trainer: Trainer) {
  const run = runOf(ctx, trainer.id)

  /** Ein Gegenstand mit Namen und Bild, so wie die Anzeige ihn braucht. */
  const benannt = (itemId: string) => {
    const item = ctx.registry.tryItem(itemId)
    return {
      itemId,
      name: item ? ctx.registry.localized(item.name, trainer.locale) : itemId,
      icon: item?.icon ?? '',
    }
  }

  const regions = openRegions(ctx, trainer).map((id) => {
    const region = ctx.registry.region(id)
    return {
      id,
      name: ctx.registry.localized(region.name, trainer.locale),
      best: bestOf(ctx, trainer.id, id),
      /*
       * Die ganze Tabelle, samt Schwelle.
       *
       * "Ab fuenfzig faellt hier auch Sternenstaub" ist der zweite Grund
       * weiterzulaufen — neben den Praemien. Er nuetzt aber nur, wenn er
       * vorher dasteht und nicht erst, wenn man zufaellig so weit kommt.
       */
      drops: dropTableFor(id).map((d) => ({ ...benannt(d.itemId), from: d.from })),
      /*
       * Was jede Stufe *hier* abwirft.
       *
       * Je Region, nicht global: die Werkstoffe unterscheiden sich, und ab
       * fuenfzig kommt eine Sorte dazu. Gerechnet mit derselben Funktion wie
       * die Auszahlung, damit Anzeige und Wirklichkeit nicht auseinanderlaufen.
       */
      milestones: GAUNTLET_MILESTONES.map((m) => ({
        at: m.at,
        gold: m.gold,
        materials: m.materials,
        heals: m.at % GAUNTLET_FULL_HEAL_EVERY === 0,
        items: splitDrops(id, m.materials, m.at)
          .map((dd) => ({ ...benannt(dd.itemId), quantity: dd.quantity })),
      })),
    }
  })

  return {
    regions,
    energyCost: energy.costOf('gauntlet'),
    fullHealEvery: GAUNTLET_FULL_HEAL_EVERY,
    // Der Faktor beim aktuellen Stand: er flacht ueber die Serie ab, also ist
    // eine feste Zahl hier die falsche Auskunft.
    xpMultiplier: Math.round(gauntletXpMultiplier(run?.streak ?? 0) * 100) / 100,
    averageLevel: Math.round(averageLevel(ctx, trainer.id)),
    run: run
      ? {
          regionId: run.regionId,
          regionName: ctx.registry.localized(ctx.registry.region(run.regionId).name, trainer.locale),
          streak: run.streak,
          /*
           * Was der Lauf bisher gebracht hat — waehrend er laeuft, nicht erst
           * am Ende.
           *
           * Beides stand schon in `gauntlet_runs`, aber nur die Abrechnung
           * nach dem Aufhoeren las es. Gemeldet als "waers nice wie viele
           * Gegner man schon besiegt hat"; die Zahlen daneben beantworten
           * gleich mit, warum am Ende mehr Gold herauskommt, als an der
           * naechsten Stufe steht.
           */
          defeated: run.streak,
          gold: run.totalGold,
          xp: run.totalXp,
          next: nextMilestone(run.streak),
          battleOpen: Boolean(run.battleId && battles.activeOf(ctx.db, trainer.id)),
        }
      : null,
  }
}

export function start(ctx: AppContext, trainer: Trainer, regionId: string) {
  if (!ctx.registry.allRegions.some((r) => r.id === regionId)) {
    throw new GameError('validation_failed', { field: 'regionId' })
  }
  if (!openRegions(ctx, trainer).includes(regionId)) {
    throw new GameError('invalid_state', { reason: 'region_locked', regionId }, 409)
  }
  if (runOf(ctx, trainer.id)) throw new GameError('invalid_state', { reason: 'already_active' }, 409)

  // Die Energie fuer den ganzen Lauf, hier und nur hier — wie in der Arena.
  energy.spendFor(ctx, trainer.id, 'gauntlet')

  const def = buildFoe(ctx, trainer, regionId, 0)
  const area = ctx.registry.tryArea(trainer.currentAreaId ?? '') ?? ctx.registry.allAreas[0]!
  const battle = beginBattle(ctx, trainer, def, area,
    { exactLevels: true, storeDef: true, foeIv: gauntletIv(0), freeEnergy: true })

  ctx.db.prepare(
    `INSERT INTO gauntlet_runs (trainer_id, region_id, streak, battle_id, started_at)
     VALUES (?, ?, 0, ?, ?)`,
  ).run(trainer.id, regionId, battle.id, Date.now())

  logEvent(ctx.db, trainer.id, 'gauntlet.start', { regionId })
  return { battle, gauntlet: view(ctx, trainer) }
}

/**
 * Die Abrechnung eines Laufs.
 *
 * Sie steht am Ende — bei einer Niederlage wie beim freiwilligen Aufhoeren.
 * Ohne sie verschwindet alles stumm im Beutel, und eine Serie von dreissig
 * fuehlt sich an wie nichts.
 */
export interface GauntletSummary {
  streak: number
  best: number
  regionName: string
  gold: number
  xp: number
  items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
}

/** Die gesammelte Beute eines Laufs in etwas verwandeln, das man anzeigt. */
function summarize(ctx: AppContext, trainer: Trainer, run: Run): GauntletSummary {
  let roh: Record<string, number> = {}
  try { roh = JSON.parse(run.loot) as Record<string, number> } catch { roh = {} }
  return {
    streak: run.streak,
    best: Math.max(run.streak, bestOf(ctx, trainer.id, run.regionId)),
    regionName: ctx.registry.localized(ctx.registry.region(run.regionId).name, trainer.locale),
    gold: run.totalGold,
    xp: run.totalXp,
    items: Object.entries(roh)
      .sort((a, b) => b[1] - a[1])
      .flatMap(([itemId, quantity]) => {
        const item = ctx.registry.tryItem(itemId)
        return item
          ? [{ itemId, quantity, name: ctx.registry.localized(item.name, trainer.locale), icon: item.icon }]
          : []
      }),
  }
}

/** Gold, Erfahrung und Beute auf den Lauf aufaddieren. */
function addToRun(
  ctx: AppContext, trainerId: string, run: Run,
  gold: number, xp: number, items: Array<{ itemId: string; quantity: number }>,
): void {
  let roh: Record<string, number> = {}
  try { roh = JSON.parse(run.loot) as Record<string, number> } catch { roh = {} }
  for (const i of items) roh[i.itemId] = (roh[i.itemId] ?? 0) + i.quantity
  ctx.db.prepare(
    `UPDATE gauntlet_runs SET total_gold = total_gold + ?, total_xp = total_xp + ?, loot = ?
      WHERE trainer_id = ?`,
  ).run(gold, xp, JSON.stringify(roh), trainerId)
}

export interface GauntletPayout {
  at: number
  gold: number
  items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
}

/**
 * Nach einem Kampf weitergehen.
 *
 * Wie in der Arena entscheidet der Aufruf nichts selbst, sondern liest das
 * Ergebnis des letzten Kampfes: gewonnen heißt Serie plus eins, vielleicht
 * eine Stufe, dann der nächste Gegner. Verloren beendet den Lauf.
 */
export function next(
  ctx: AppContext, trainer: Trainer,
  /*
   * Was der eben beendete Kampf eingebracht hat.
   *
   * Kommt vom Aufrufer, weil es dort schon vorliegt: die Abrechnung entsteht
   * in `battle.submit` und steht in dessen Antwort, nicht im gespeicherten
   * Kampf. Sie hier ein zweites Mal zu rechnen hiesse, zwei Wahrheiten zu
   * haben — und die zweite waere die falsche.
   */
  lastReward?: { gold: number; xpPerMember: number } | null,
) {
  return tx(ctx.db, () => {
    const run = runOf(ctx, trainer.id)
    // Ein Klick auf einen Knopf, den es nicht mehr gibt, ist kein Fehler.
    if (!run) {
      return {
        done: true, won: false, streak: 0, payout: null, healed: 0,
        battle: null, summary: null, gauntlet: view(ctx, trainer),
      }
    }
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }

    const last = run.battleId ? battles.byId(ctx.db, run.battleId) : null
    const won = last?.winner === 0

    if (!won) {
      recordBest(ctx, trainer.id, run.regionId, run.streak)
      const summary = summarize(ctx, trainer, run)
      ctx.db.prepare('DELETE FROM gauntlet_runs WHERE trainer_id = ?').run(trainer.id)
      logEvent(ctx.db, trainer.id, 'gauntlet.lost', { regionId: run.regionId, streak: run.streak })
      return {
        done: true, won: false, streak: run.streak, payout: null, healed: 0,
        battle: null, summary, gauntlet: view(ctx, trainer),
      }
    }

    const streak = run.streak + 1
    bumpMetric(ctx, trainer.id, 'gauntletWins')

    /*
     * Was der Gegner fallen laesst.
     *
     * Jeder Kampf, nicht nur die Stufen: sonst sind neun Siege in Folge neun
     * Kaempfe fuer nichts, und die Zehn ist eine Klippe statt eines
     * Meilensteins.
     */
    const drops = rollGauntletDrops(
      createRng(`gauntlet-drop:${trainer.id}:${run.regionId}:${streak}`), run.regionId, streak,
    ).flatMap((d) => {
      const item = ctx.registry.tryItem(d.itemId)
      if (!item) return []
      inventory.grant(ctx.db, trainer.id, d.itemId, d.quantity, von(ctx, 'gauntlet.milestone'))
      return [{
        itemId: d.itemId, quantity: d.quantity,
        name: ctx.registry.localized(item.name, trainer.locale), icon: item.icon,
      }]
    })

    const stufe = milestoneAt(streak)
    const payout = stufe ? pay(ctx, trainer, run.regionId, stufe) : null
    /*
     * Geheilt wird alle fuenfundzwanzig Stufen, und dann ganz.
     *
     * Vorher gab es nach jedem Sieg zwoelf Prozent zurueck und an jeder
     * Praemienstufe eine Vollheilung — also schon bei zehn. Das las sich als
     * "die Pokemon werden mitten drin geheilt, teilweise auch voll". Die
     * Erholung haengt jetzt an einer einzigen, nachvollziehbaren Marke.
     */
    const healed = gauntletHeals(streak) ? heal(ctx, trainer.id, 100, true) : 0
    recordBest(ctx, trainer.id, run.regionId, streak)

    // Alles, was dieser Kampf gebracht hat, auf den Lauf aufaddieren — Gold
    // und Erfahrung aus der Kampfabrechnung, Beute von hier.
    addToRun(ctx, trainer.id, run,
      (lastReward?.gold ?? 0) + (payout?.gold ?? 0),
      lastReward?.xpPerMember ?? 0,
      [...drops, ...(payout?.items ?? [])])

    const def = buildFoe(ctx, trainer, run.regionId, streak)
    const area = ctx.registry.tryArea(trainer.currentAreaId ?? '') ?? ctx.registry.allAreas[0]!
    const battle = beginBattle(ctx, trainer, def, area,
      { exactLevels: true, storeDef: true, foeIv: gauntletIv(streak), freeEnergy: true })

    ctx.db.prepare('UPDATE gauntlet_runs SET streak = ?, battle_id = ? WHERE trainer_id = ?')
      .run(streak, battle.id, trainer.id)

    return { done: false, won: true, streak, payout, healed, drops, battle, summary: null, gauntlet: view(ctx, trainer) }
  })
}

function recordBest(ctx: AppContext, trainerId: string, regionId: string, streak: number): void {
  ctx.db.prepare(
    `INSERT INTO gauntlet_bests (trainer_id, region_id, best, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, region_id) DO UPDATE SET
       best = MAX(best, excluded.best), updated_at = excluded.updated_at`,
  ).run(trainerId, regionId, streak, Date.now())
}

function pay(ctx: AppContext, trainer: Trainer, regionId: string, stufe: typeof GAUNTLET_MILESTONES[number]): GauntletPayout {
  inventory.earnGold(ctx.db, trainer.id, stufe.gold, von(ctx, 'gauntlet.reward'))
  // Mit dem Stand der Stufe: ab fuenfzig gehoert Sternenstaub dazu.
  const items = splitDrops(regionId, stufe.materials, stufe.at).flatMap((d) => {
    const item = ctx.registry.tryItem(d.itemId)
    if (!item) return []
    inventory.grant(ctx.db, trainer.id, d.itemId, d.quantity, von(ctx, 'gauntlet.reward'))
    return [{
      itemId: d.itemId,
      quantity: d.quantity,
      name: ctx.registry.localized(item.name, trainer.locale),
      icon: item.icon,
    }]
  })
  logEvent(ctx.db, trainer.id, 'gauntlet.milestone', { regionId, at: stufe.at, gold: stufe.gold })
  return { at: stufe.at, gold: stufe.gold, items }
}

/** Freiwillig aufhören. Die Serie zählt, die Bestmarke bleibt. */
export function abandon(ctx: AppContext, trainer: Trainer) {
  // Aufgeben heisst aufgeben: der offene Kampf gilt als verloren, sonst
  // bliebe er stehen und blockierte jeden weiteren.
  if (battles.activeOf(ctx.db, trainer.id)) forfeit(ctx, trainer)
  return tx(ctx.db, () => {
    const run = runOf(ctx, trainer.id)
    let summary: GauntletSummary | null = null
    if (run) {
      recordBest(ctx, trainer.id, run.regionId, run.streak)
      summary = summarize(ctx, trainer, run)
      ctx.db.prepare('DELETE FROM gauntlet_runs WHERE trainer_id = ?').run(trainer.id)
      logEvent(ctx.db, trainer.id, 'gauntlet.abandon', { regionId: run.regionId, streak: run.streak })
    }
    return { gauntlet: view(ctx, trainer), summary }
  })
}

/** Läuft gerade ein Durchgang? Der Kampfbildschirm fragt danach. */
export function contextFor(ctx: AppContext, trainer: Trainer): { streak: number; regionId: string } | null {
  const run = runOf(ctx, trainer.id)
  return run ? { streak: run.streak, regionId: run.regionId } : null
}

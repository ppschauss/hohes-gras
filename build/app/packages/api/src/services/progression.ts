import { GameError, type Trainer } from '@game/shared'

/** Zaehlt die Entwicklungen des Tages, die Energie eingebracht haben. */
const EVOLUTION_ENERGY_COUNTER = 'evolution_energy'
import {
  ACHIEVEMENTS, BUILDINGS, MAX_SEASON_TIER, RECIPES, SEASON_POINTS, SEASON_LENGTH_DAYS,
  bonusOf, canCraft, computeStats, ENERGY_REWARDS, findBuilding, findRecipe, isUnlocked,
  pointsForTier, rewardForTier, seasonTiers, tierForPoints, upgradeCost, visibleAchievements,
  EVOLUTION_ENERGY_PER_DAY,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as progression from '../repos/progression.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as dexRepo from '../repos/dex.js'
import { bumpCounter, counterValue } from '../repos/counters.js'
import * as world from '../repos/world.js'
import * as socialRepo from '../repos/social.js'
import { logEvent } from '../repos/events.js'
import { worldClock, berlinParts } from '../worldClock.js'
import { creatureView, evolutionOptions } from './views.js'
import { refreshMoves } from './garden.js'
import * as energy from './energy.js'

/* ------------------------------------------------------------- Entwicklung */

/**
 * Evolve a creature.
 *
 * The garden already showed that an evolution was possible; without this there
 * was no way to act on it, which made the whole evolution chain in the content
 * pack decorative.
 */
export function evolve(ctx: AppContext, trainer: Trainer, creatureId: string, targetSpeciesId: string) {
  return tx(ctx.db, () => {
    const creature = creatures.byId(ctx.db, creatureId)
    if (!creature) throw new GameError('not_found', { creatureId }, 404)
    if (creature.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId }, 403)

    const clock = worldClock()
    const bag = inventory.bagOf(ctx.db, trainer.id)
    const heldStones = new Set(Object.keys(bag).filter((id) => (bag[id] ?? 0) > 0))
    const options = evolutionOptions(ctx.registry, creature, trainer.locale, clock.timeOfDay, heldStones)

    const chosen = options.find((o) => o.speciesId === targetSpeciesId)
    if (!chosen) throw new GameError('invalid_state', { reason: 'not_ready', creatureId }, 409)

    // A stone evolution consumes the stone; the check above only proved it was
    // in the bag.
    if (chosen.how === 'stone') {
      const species = ctx.registry.species(creature.speciesId)
      const evo = species.evolutions.find((e) => e.trigger === 'stone' && e.to === targetSpeciesId)
      if (evo && evo.trigger === 'stone') inventory.consume(ctx.db, trainer.id, evo.itemId, 1)
    }

    const target = ctx.registry.species(targetSpeciesId)
    const before = ctx.registry.species(creature.speciesId)
    const beforeStats = computeStats(before, creature.level, creature.ivs, creature.evs, creature.nature)
    const afterStats = computeStats(target, creature.level, creature.ivs, creature.evs, creature.nature)

    creatures.evolveTo(ctx.db, creature.id, targetSpeciesId)
    // Carry the HP difference so evolving does not silently heal or hurt.
    creatures.setHp(ctx.db, creature.id, Math.min(afterStats.hp, creature.hpCurrent + (afterStats.hp - beforeStats.hp)))
    refreshMoves(ctx, creature.id, targetSpeciesId, creature.level, creature.moves)

    const newDexEntry = dexRepo.markCaught(ctx.db, trainer.id, targetSpeciesId)

    /*
     * Energie gibt es fuer die ersten zehn Entwicklungen des Tages.
     *
     * Eine Entwicklung ist ein einmaliger Fortschritt je Kreatur — aber nicht
     * je Spieler: mit Eiern, Bonbons und einer vollen Box entwickelt man
     * zwanzig am Stueck. Der Deckel laesst den Fortschritt zu und nimmt ihm
     * nur die Energie; wer mehr braucht, kauft sie.
     */
    const rewardedToday = counterValue(ctx.db, trainer.id, EVOLUTION_ENERGY_COUNTER)
    const rewarded = rewardedToday < EVOLUTION_ENERGY_PER_DAY
    if (rewarded) {
      energy.reward(ctx, trainer.id, 'evolution')
      bumpCounter(ctx.db, trainer.id, EVOLUTION_ENERGY_COUNTER)
    }
    const energyGained = rewarded ? ENERGY_REWARDS.evolution : 0
    awardSeasonPoints(ctx, trainer.id, 'evolution')
    if (newDexEntry) awardSeasonPoints(ctx, trainer.id, 'newDexEntry')
    bumpMetric(ctx, trainer.id, 'evolutions')

    logEvent(ctx.db, trainer.id, 'creature.evolved', { from: before.id, to: target.id, how: chosen.how })
    return {
      creature: creatureView(ctx.registry, creatures.byId(ctx.db, creature.id)!, trainer.locale, clock.timeOfDay),
      fromName: ctx.registry.localized(before.name, trainer.locale),
      energyGained,
      /** Wie viele der zehn taeglichen Energieboni noch offen sind. */
      energyLeftToday: Math.max(0, EVOLUTION_ENERGY_PER_DAY - (rewarded ? rewardedToday + 1 : rewardedToday)),
      newDexEntry,
    }
  })
}

/** Everything in the player's collection that could evolve right now. */
export function evolvable(ctx: AppContext, trainer: Trainer) {
  const clock = worldClock()
  const bag = inventory.bagOf(ctx.db, trainer.id)
  const stones = new Set(Object.keys(bag).filter((id) => (bag[id] ?? 0) > 0))
  const all = creatures.teamOf(ctx.db, trainer.id).concat(creatures.boxOf(ctx.db, trainer.id, 200))

  return all.flatMap((c) => {
    const options = evolutionOptions(ctx.registry, c, trainer.locale, clock.timeOfDay, stones)
    if (options.length === 0) return []
    const view = creatureView(ctx.registry, c, trainer.locale, clock.timeOfDay)
    return [{
      creature: view,
      options: options.map((o) => {
        const target = ctx.registry.species(o.speciesId)
        return { speciesId: o.speciesId, name: o.name, sprite: target.sprite, how: o.how }
      }),
    }]
  })
}

/* ------------------------------------------------------------- Basisausbau */

export function buildingsView(ctx: AppContext, trainer: Trainer) {
  const owned = progression.buildingsOf(ctx.db, trainer.id)
  const gold = inventory.goldOf(ctx.db, trainer.id)

  return {
    gold,
    buildings: BUILDINGS.map((spec) => {
      const level = owned.find((b) => b.buildingId === spec.id)?.level ?? 0
      const cost = upgradeCost(spec.id, level)
      return {
        id: spec.id,
        level,
        maxLevel: spec.maxLevel,
        effectKind: spec.effectKind,
        currentEffect: level > 0 ? spec.effect(level) : 0,
        nextEffect: level < spec.maxLevel ? spec.effect(level + 1) : null,
        upgradeCost: cost,
        affordable: cost !== null && gold >= cost,
        maxed: level >= spec.maxLevel,
      }
    }),
  }
}

export function upgrade(ctx: AppContext, trainer: Trainer, buildingId: string) {
  const spec = findBuilding(buildingId)
  if (!spec) throw new GameError('not_found', { buildingId }, 404)

  return tx(ctx.db, () => {
    const level = progression.buildingLevel(ctx.db, trainer.id, buildingId)
    if (level >= spec.maxLevel) throw new GameError('invalid_state', { reason: 'max_level' }, 409)
    const cost = upgradeCost(buildingId, level)!
    inventory.spendGold(ctx.db, trainer.id, cost)
    const next = progression.upgradeBuilding(ctx.db, trainer.id, buildingId)
    logEvent(ctx.db, trainer.id, 'building.upgraded', { buildingId, level: next, cost })
    return { buildingId, level: next, cost }
  })
}

/** Bonuses the rest of the game reads. Kept in one place so a new building
 *  only has to be added to the engine's list. */
export function bonuses(ctx: AppContext, trainerId: string) {
  const owned = progression.buildingsOf(ctx.db, trainerId)
  return {
    careXpBonus: bonusOf(owned, 'careXpBonus'),
    hatchSpeedBonus: bonusOf(owned, 'hatchSpeedBonus'),
    expeditionLootBonus: bonusOf(owned, 'expeditionLootBonus'),
    catchRateBonus: bonusOf(owned, 'catchRateBonus'),
    energyRegenBonus: bonusOf(owned, 'energyRegenBonus'),
    energyCapBonus: bonusOf(owned, 'energyCapBonus'),
    careLimitBonus: bonusOf(owned, 'careLimitBonus'),
    centerSpeedBonus: bonusOf(owned, 'centerSpeedBonus'),
    boxSlotBonus: bonusOf(owned, 'boxSlotBonus'),
    eggSlotBonus: bonusOf(owned, 'eggSlotBonus'),
  }
}

/* ---------------------------------------------------------------- Handwerk */

export function craftingView(ctx: AppContext, trainer: Trainer) {
  const bag = inventory.bagOf(ctx.db, trainer.id)
  const gold = inventory.goldOf(ctx.db, trainer.id)
  const owned = progression.buildingsOf(ctx.db, trainer.id)

  const label = (itemId: string) => {
    const item = ctx.registry.tryItem(itemId)
    return {
      itemId,
      name: item ? ctx.registry.localized(item.name, trainer.locale) : itemId,
      icon: item?.icon ?? '',
      category: item?.category ?? 'material',
    }
  }

  return {
    gold,
    recipes: RECIPES.map((recipe) => {
      const check = canCraft(recipe, bag, gold, owned)
      return {
        id: recipe.id,
        output: { ...label(recipe.output.itemId), quantity: recipe.output.quantity },
        inputs: recipe.inputs.map((i) => ({ ...label(i.itemId), quantity: i.quantity, have: bag[i.itemId] ?? 0 })),
        goldCost: recipe.goldCost,
        requiresBuilding: recipe.requiresBuilding ?? null,
        craftable: check.ok,
        blockedReason: check.ok ? null : check.reason,
      }
    }),
  }
}

export function craft(ctx: AppContext, trainer: Trainer, recipeId: string) {
  const recipe = findRecipe(recipeId)
  if (!recipe) throw new GameError('not_found', { recipeId }, 404)

  return tx(ctx.db, () => {
    const bag = inventory.bagOf(ctx.db, trainer.id)
    const gold = inventory.goldOf(ctx.db, trainer.id)
    const owned = progression.buildingsOf(ctx.db, trainer.id)

    const check = canCraft(recipe, bag, gold, owned)
    // Der Grund steht schon in `check`; ihn davor zu setzen wuerde ihn
    // ueberschreiben lassen.
    if (!check.ok) throw new GameError('invalid_state', { ...check }, 409)

    for (const input of recipe.inputs) inventory.consume(ctx.db, trainer.id, input.itemId, input.quantity)
    inventory.spendGold(ctx.db, trainer.id, recipe.goldCost)
    inventory.grant(ctx.db, trainer.id, recipe.output.itemId, recipe.output.quantity)

    logEvent(ctx.db, trainer.id, 'crafted', { recipeId, output: recipe.output })
    return { output: recipe.output }
  })
}

/* ----------------------------------------------------------- Saison-Reise */

/** Seasons are fixed 28-day windows counted from a stable epoch, so every
 *  player is in the same season without any scheduling. */
const SEASON_EPOCH = Date.UTC(2026, 0, 5)

export function seasonKey(at = new Date()): string {
  const days = Math.floor((at.getTime() - SEASON_EPOCH) / 86_400_000)
  const index = Math.max(0, Math.floor(days / SEASON_LENGTH_DAYS))
  return `S${String(index + 1).padStart(3, '0')}`
}

export function seasonEndsAt(at = new Date()): number {
  const days = Math.floor((at.getTime() - SEASON_EPOCH) / 86_400_000)
  const index = Math.max(0, Math.floor(days / SEASON_LENGTH_DAYS))
  return SEASON_EPOCH + (index + 1) * SEASON_LENGTH_DAYS * 86_400_000
}

export function awardSeasonPoints(ctx: AppContext, trainerId: string, activity: keyof typeof SEASON_POINTS | string): void {
  const points = SEASON_POINTS[activity]
  if (!points) return
  progression.addSeasonPoints(ctx.db, trainerId, seasonKey(), points)
}

export function seasonView(ctx: AppContext, trainer: Trainer) {
  const key = seasonKey()
  const row = progression.seasonOf(ctx.db, trainer.id, key)
  const tier = tierForPoints(row.points)

  return {
    seasonKey: key,
    endsAt: seasonEndsAt(),
    points: row.points,
    tier,
    // Stand fest auf 30, waehrend die Leiter aus der Engine kommt: bei einer
    // kuerzeren Leiter zeigte die Anzeige eine naechste Stufe, die es nicht
    // gibt.
    nextTierPoints: tier < MAX_SEASON_TIER ? pointsForTier(tier + 1) : null,
    currentTierPoints: pointsForTier(tier),
    /*
     * Woher die Punkte kommen.
     *
     * Ohne diese Liste ist der Pass eine Leiter ohne Sprossen: man sieht, wo
     * es hingeht, aber nicht, was einen dahin bringt. Sie kommt aus derselben
     * Tabelle, die die Punkte vergibt — zwei Listen wuerden auseinanderlaufen.
     */
    earn: Object.entries(SEASON_POINTS)
      .map(([action, points]) => ({ action, points }))
      .sort((a, b) => b.points - a.points),
    tiers: seasonTiers().map((t) => ({
      ...t,
      reached: row.points >= t.pointsRequired,
      claimed: row.claimed.includes(t.tier),
      rewardLabel: describeReward(ctx, trainer, t.reward),
    })),
  }
}

function describeReward(ctx: AppContext, trainer: Trainer, reward: ReturnType<typeof rewardForTier>): string {
  if (reward.kind === 'gold') return `${reward.amount} Gold`
  const item = ctx.registry.tryItem(reward.itemId)
  const name = item ? ctx.registry.localized(item.name, trainer.locale) : reward.itemId
  return `${reward.quantity}× ${name}`
}

export function claimSeasonTier(ctx: AppContext, trainer: Trainer, tier: number) {
  return tx(ctx.db, () => {
    const key = seasonKey()
    const row = progression.seasonOf(ctx.db, trainer.id, key)
    if (row.points < pointsForTier(tier)) {
      throw new GameError('invalid_state', { reason: 'tier_not_reached', tier }, 409)
    }
    if (!progression.claimSeasonTier(ctx.db, trainer.id, key, tier)) {
      throw new GameError('invalid_state', { reason: 'already_claimed', tier }, 409)
    }
    const reward = rewardForTier(tier)
    if (reward.kind === 'gold') inventory.earnGold(ctx.db, trainer.id, reward.amount)
    else inventory.grant(ctx.db, trainer.id, reward.itemId, reward.quantity)

    logEvent(ctx.db, trainer.id, 'season.claimed', { tier, reward })
    return { tier, reward, label: describeReward(ctx, trainer, reward) }
  })
}

/* ----------------------------------------------------------------- Erfolge */

/**
 * Current values of every tracked metric.
 *
 * Read from source rather than kept as counters: a miscount in one code path
 * would otherwise be permanent, and these queries are cheap on a per-player
 * scale.
 */
export function metricsOf(ctx: AppContext, trainerId: string): Record<string, number> {
  const one = (sql: string, ...args: unknown[]): number =>
    (ctx.db.prepare(sql).get(...args) as { n: number }).n

  return {
    catches: one('SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ?', trainerId),
    dexCaught: one('SELECT COUNT(*) AS n FROM dex_entries WHERE trainer_id = ? AND caught_at IS NOT NULL', trainerId),
    badges: world.badgesOf(ctx.db, trainerId).size,
    highestLevel: one('SELECT COALESCE(MAX(level), 0) AS n FROM creatures WHERE owner_id = ?', trainerId),
    shinies: one('SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND shiny = 1', trainerId),
    evolutions: one("SELECT COUNT(*) AS n FROM event_log WHERE trainer_id = ? AND kind = 'creature.evolved'", trainerId),
    raidsWon: one("SELECT COUNT(*) AS n FROM raid_participants WHERE trainer_id = ? AND rewarded_at IS NOT NULL", trainerId),
    duelsWon: one('SELECT COUNT(*) AS n FROM pvp_duels WHERE challenger_id = ? AND winner = 0', trainerId),
    eggsHatched: one('SELECT COUNT(*) AS n FROM eggs WHERE trainer_id = ? AND hatched_at IS NOT NULL', trainerId),
    friends: socialRepo.friendIdsOf(ctx.db, trainerId).length,
  }
}

/** Called after anything that could complete an achievement. */
export function bumpMetric(ctx: AppContext, trainerId: string, _metric: string): void {
  void _metric
  refreshAchievements(ctx, trainerId)
}

export function refreshAchievements(ctx: AppContext, trainerId: string): string[] {
  const metrics = metricsOf(ctx, trainerId)
  const newlyUnlocked: string[] = []
  for (const spec of ACHIEVEMENTS) {
    const value = metrics[spec.metric] ?? 0
    progression.setProgress(ctx.db, trainerId, spec.id, Math.min(value, spec.target))
    if (isUnlocked(spec, metrics)) {
      if (progression.markUnlocked(ctx.db, trainerId, spec.id, spec.target)) newlyUnlocked.push(spec.id)
    }
  }
  return newlyUnlocked
}

export function achievementsView(ctx: AppContext, trainer: Trainer) {
  refreshAchievements(ctx, trainer.id)
  const metrics = metricsOf(ctx, trainer.id)
  const rows = progression.achievementsOf(ctx.db, trainer.id)
  const claimed = new Set([...rows.entries()].filter(([, r]) => r.claimedAt).map(([id]) => id))
  const unlocked = new Set([...rows.entries()].filter(([, r]) => r.unlockedAt).map(([id]) => id))

  return {
    visible: visibleAchievements(claimed).map((spec) => {
      const row = rows.get(spec.id)
      return {
        id: spec.id,
        metric: spec.metric,
        target: spec.target,
        progress: Math.min(metrics[spec.metric] ?? 0, spec.target),
        unlocked: Boolean(row?.unlockedAt),
        claimed: Boolean(row?.claimedAt),
        rewardGold: spec.reward.gold,
      }
    }),
    unlockedCount: unlocked.size,
    totalCount: ACHIEVEMENTS.length,
  }
}

export function claimAchievement(ctx: AppContext, trainer: Trainer, achievementId: string) {
  const spec = ACHIEVEMENTS.find((a) => a.id === achievementId)
  if (!spec) throw new GameError('not_found', { achievementId }, 404)

  return tx(ctx.db, () => {
    refreshAchievements(ctx, trainer.id)
    if (!progression.claimAchievement(ctx.db, trainer.id, achievementId)) {
      throw new GameError('invalid_state', { reason: 'not_claimable' }, 409)
    }
    inventory.earnGold(ctx.db, trainer.id, spec.reward.gold)
    logEvent(ctx.db, trainer.id, 'achievement.claimed', { achievementId, gold: spec.reward.gold })
    return { achievementId, gold: spec.reward.gold }
  })
}

export const currentDate = () => berlinParts().date

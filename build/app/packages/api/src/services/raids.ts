import { GameError, NATURES, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import { battleParty } from './party.js'
import {
  bossHp, computeStats, createRng, deriveSeed, distributeRewards, raidAttack, raidProgress,
  randomIvs, toFighter, xpForLevel,
  ATTACKS_PER_TRAINER_PER_RAID, RAID_TIERS, TIER_SPECS, type RaidTier, isLegendarySpecies,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as raids from '../repos/raids.js'
import * as guilds from '../repos/guilds.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as dex from '../repos/dex.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { contributeToGoal } from './guilds.js'
import { awardSeasonPoints, bumpMetric } from './progression.js'
import * as energy from './energy.js'
import { creatureView } from './views.js'

export function raidView(ctx: AppContext, trainer: Trainer, raid: raids.Raid) {
  const species = ctx.registry.species(raid.speciesId)
  const parts = raids.participantsOf(ctx.db, raid.id)
  const mine = parts.find((p) => p.trainerId === trainer.id)
  return {
    id: raid.id,
    speciesId: raid.speciesId,
    name: ctx.registry.localized(species.name, trainer.locale),
    sprite: species.sprite,
    types: species.types.map((id) => {
      const t = ctx.registry.type(id)
      return { id: t.id, name: ctx.registry.localized(t.name, trainer.locale), color: t.color }
    }),
    level: raid.level,
    tier: raid.tier,
    hpLeft: raid.hpLeft,
    hpMax: raid.hpMax,
    progress: raidProgress(raid.hpLeft, raid.hpMax),
    expiresAt: raid.expiresAt,
    defeated: raid.defeatedAt !== null,
    participants: parts.map((p) => ({
      trainerId: p.trainerId, displayName: p.displayName, damage: p.damage, attacks: p.attacks,
    })),
    myDamage: mine?.damage ?? 0,
    myAttacks: mine?.attacks ?? 0,
    attacksLeft: Math.max(0, ATTACKS_PER_TRAINER_PER_RAID - (mine?.attacks ?? 0)),
    maxAttacks: ATTACKS_PER_TRAINER_PER_RAID,
    goldPool: TIER_SPECS[raid.tier as RaidTier]?.goldPool ?? 0,
  }
}

export function overview(ctx: AppContext, trainer: Trainer) {
  const guild = guilds.guildOf(ctx.db, trainer.id)
  if (!guild) return { guild: null, open: [], recent: [], tiers: RAID_TIERS.map((t) => TIER_SPECS[t]) }

  return {
    guild: { id: guild.id, name: guild.name, tag: guild.tag, chatBound: guild.chatId !== null },
    open: raids.openForGuild(ctx.db, guild.id).map((r) => raidView(ctx, trainer, r)),
    recent: raids.recentForGuild(ctx.db, guild.id, 5)
      .filter((r) => r.defeatedAt !== null)
      .map((r) => raidView(ctx, trainer, r)),
    tiers: RAID_TIERS.map((t) => TIER_SPECS[t]),
  }
}

/**
 * Summon a boss for a guild.
 *
 * Species is picked from the pack by rarity so a tier-5 raid never turns out to
 * be a Rattata. The seed is stored so the whole raid — including the reward
 * roll at the end — can be replayed and audited.
 *
 * Legendaere sind ausgenommen — wie in Arena und Kampfzone, wo dieselbe
 * Ausnahme laengst steht. Ohne sie war der Raid mit Abstand der leichteste
 * Weg zu einem Legendaeren: auf Stufe 5 war fast jeder vierte Boss eines,
 * und wer ihn faellte, fing ihn mit 35 bis 90 Prozent. Der vorgesehene Weg
 * liegt bei einem Promille je Erkundung, in der richtigen Region, mit drei
 * Sagenbeeren. Ein Weg, der tausendmal ergiebiger ist als der gedachte, ist
 * kein zweiter Weg, sondern der einzige.
 *
 * Die Seltenheit bleibt eine Unter- und keine Obergrenze: ein Raid der ersten
 * Stufe darf einen seltenen Boss hervorbringen. Das ist Glueck, kein Bruch —
 * nach oben offen war die Absicht, nur reichte "oben" bis zu den Legendaeren.
 */
export function summon(ctx: AppContext, trainer: Trainer, tier: RaidTier): ReturnType<typeof raidView> {
  if (!RAID_TIERS.includes(tier)) throw new GameError('validation_failed', { field: 'tier' })

  return tx(ctx.db, () => {
    const guild = guilds.guildOf(ctx.db, trainer.id)
    if (!guild) throw new GameError('invalid_state', { reason: 'not_in_guild' }, 409)
    if (raids.openForGuild(ctx.db, guild.id).length >= 2) {
      throw new GameError('invalid_state', { reason: 'too_many_raids', max: 2 }, 409)
    }

    const spec = TIER_SPECS[tier]
    const seed = deriveSeed(guild.id, 'raid', String(Date.now()))
    const rng = createRng(seed)

    const rarityOrder = ['common', 'uncommon', 'rare', 'legendary']
    const minIndex = rarityOrder.indexOf(spec.minRarity)
    const pool = ctx.registry.obtainableSpecies.filter(
      (s) => rarityOrder.indexOf(s.rarity) >= minIndex && !isLegendarySpecies(s),
    )
    if (pool.length === 0) throw new GameError('content_unavailable', { reason: 'no_species_for_tier' }, 409)

    const species = rng.pick(pool)
    const level = rng.int(spec.levelRange[0], spec.levelRange[1])
    const hp = bossHp(species, level, tier)
    const now = Date.now()

    const raid = raids.create(ctx.db, {
      guildId: guild.id,
      chatId: guild.chatId,
      speciesId: species.id,
      level, tier,
      hpMax: hp, hpLeft: hp,
      seed,
      startedAt: now,
      expiresAt: now + spec.durationHours * 3_600_000,
    })
    logEvent(ctx.db, trainer.id, 'raid.summoned', { raidId: raid.id, tier, speciesId: species.id })
    return raidView(ctx, trainer, raid)
  })
}

export interface RaidAttackOutcome {
  damage: number
  contributions: Array<{ creatureId: string; name: string; damage: number; effectiveness: number }>
  raid: ReturnType<typeof raidView>
  defeated: boolean
  reward: {
    gold: number
    caught: boolean
    creature: unknown
    /** Werkstoffe aus dem Raid — vorher gab es hier nur Gold. */
    items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
  } | null
}

export function attack(ctx: AppContext, trainer: Trainer, raidId: string): RaidAttackOutcome {
  return tx(ctx.db, () => {
    const raid = raids.byId(ctx.db, raidId)
    if (!raid) throw new GameError('not_found', { raidId }, 404)
    if (raid.defeatedAt) throw new GameError('invalid_state', { reason: 'raid_over' }, 409)
    if (raid.expiresAt <= Date.now()) throw new GameError('invalid_state', { reason: 'raid_expired' }, 409)

    const guild = guilds.guildOf(ctx.db, trainer.id)
    if (!guild || guild.id !== raid.guildId) throw new GameError('not_owner', { reason: 'other_guild' }, 403)

    const existing = raids.participant(ctx.db, raid.id, trainer.id)
    if ((existing?.attacks ?? 0) >= ATTACKS_PER_TRAINER_PER_RAID) {
      throw new GameError('daily_limit_reached', { reason: 'attacks_used', max: ATTACKS_PER_TRAINER_PER_RAID })
    }

    const team = creatures.teamOf(ctx.db, trainer.id)
    if (team.length === 0) throw new GameError('invalid_state', { reason: 'no_team' }, 409)

    energy.spendFor(ctx, trainer.id, 'raid')

    // Auch gegen einen Raid-Boss tritt nur ein Legendaeres an.
    const ppOf = (id: string) => ctx.registry.tryMove(id)?.pp ?? 10
    const fighters = battleParty(ctx, team).antreten.map((c) => {
      const species = ctx.registry.species(c.speciesId)
      return toFighter(c, species, ctx.registry.localized(species.name, trainer.locale), ppOf)
    })

    const bossSpecies = ctx.registry.species(raid.speciesId)
    const rng = createRng(deriveSeed(raid.seed, trainer.id, String((existing?.attacks ?? 0) + 1)))
    const result = raidAttack(
      fighters, bossSpecies.types, raid.level,
      (atk, defs) => ctx.registry.effectiveness(atk, defs),
      (moveId) => ctx.registry.tryMove(moveId)?.type ?? null,
      rng,
    )

    const applied = raids.applyDamage(ctx.db, raid.id, result.damage)
    if (!applied) throw new GameError('invalid_state', { reason: 'raid_over' }, 409)

    raids.recordAttack(ctx.db, raid.id, trainer.id, Math.min(result.damage, raid.hpLeft))
    contributeToGoal(ctx, trainer.id, 'raidDamage', result.damage)
    awardSeasonPoints(ctx, trainer.id, 'raidAttack')

    let reward: RaidAttackOutcome['reward'] = null
    if (applied.defeated) {
      reward = payOut(ctx, raid.id, trainer)
      bumpMetric(ctx, trainer.id, 'raidsWon')
      // Jeder, der mitgeschlagen hat, bekommt Energie zurueck — sonst waere ein
      // Raid fuer alle ausser dem letzten Schlag ein reines Minusgeschaeft.
      for (const p of raids.participantsOf(ctx.db, raid.id)) {
        energy.reward(ctx, p.trainerId, 'raidVictory')
      }
    }

    const fresh = raids.byId(ctx.db, raid.id)!
    logEvent(ctx.db, trainer.id, 'raid.attack', { raidId: raid.id, damage: result.damage, defeated: applied.defeated })

    return {
      damage: result.damage,
      contributions: result.contributions,
      raid: raidView(ctx, trainer, fresh),
      defeated: applied.defeated,
      reward,
    }
  })
}

/**
 * Pay everyone once the boss falls.
 *
 * markRewarded is the guard: whoever lands the final blow triggers the payout,
 * and a second call — from a retry or a race — finds the flag already set.
 */
function payOut(ctx: AppContext, raidId: string, viewer: Trainer): RaidAttackOutcome['reward'] {
  const raid = raids.byId(ctx.db, raidId)!
  if (!raids.markRewarded(ctx.db, raid.id)) return null

  const parts = raids.participantsOf(ctx.db, raid.id)
  const rewards = distributeRewards(
    parts.map((p) => ({ trainerId: p.trainerId, damage: p.damage })),
    raid.tier as RaidTier,
  )

  const species = ctx.registry.species(raid.speciesId)
  let mine: RaidAttackOutcome['reward'] = null

  for (const r of rewards) {
    if (!raids.markParticipantRewarded(ctx.db, raid.id, r.trainerId)) continue
    inventory.earnGold(ctx.db, r.trainerId, r.gold, von(ctx, 'raid.reward'))

    // Werkstoffe. Sie sind der eigentliche Grund, einen Raid zu beschwoeren:
    // Gold hat, wer lange spielt.
    const items = r.items.flatMap((d) => {
      const item = ctx.registry.tryItem(d.itemId)
      if (!item) return []
      inventory.grant(ctx.db, r.trainerId, d.itemId, d.quantity, von(ctx, 'raid.reward'))
      return [{
        itemId: d.itemId,
        quantity: d.quantity,
        name: ctx.registry.localized(item.name, viewer.locale),
        icon: item.icon,
      }]
    })

    // Everyone rolls for the boss species; a bigger share means better odds.
    const rng = createRng(deriveSeed(raid.seed, 'reward', r.trainerId))
    const caught = rng.next() < r.catchChance
    let created: unknown = null

    if (caught) {
      const ivs = randomIvs(rng)
      const nature = rng.pick(NATURES)
      const level = Math.max(1, raid.level - 5)
      const stats = computeStats(species, level, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature)
      const c = creatures.insertCreature(ctx.db, {
        ownerId: r.trainerId,
        speciesId: raid.speciesId,
        level,
        xp: xpForLevel(species.growthRate, level),
        nature,
        ivs,
        friendship: 90,
        hpCurrent: stats.hp,
        shiny: rng.chance(2),
        moves: ctx.registry.learnableAt(raid.speciesId, level).slice(0, 4),
        caughtAreaId: null,
        teamSlot: null,
      }, von(ctx, 'raid.creature'))
      dex.markCaught(ctx.db, r.trainerId, raid.speciesId)
      if (r.trainerId === viewer.id) {
        created = creatureView(ctx.registry, c, viewer.locale, worldClock().timeOfDay)
      }
    }

    if (r.trainerId === viewer.id) mine = { gold: r.gold, caught, creature: created, items }
  }

  if (raid.guildId) guilds.addToTreasury(ctx.db, raid.guildId, Math.round(TIER_SPECS[raid.tier as RaidTier].goldPool * 0.1))
  logEvent(ctx.db, null, 'raid.defeated', { raidId: raid.id, participants: parts.length })
  return mine
}

import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as guilds from '../repos/guilds.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { berlinParts } from '../worldClock.js'

export const MAX_MEMBERS = 20
export const FOUNDING_COST = 2500

/**
 * ISO week key, e.g. `2026-W35`.
 *
 * Weekly resets are expressed as a different key rather than a scheduled job:
 * a new week simply has no row yet, so nothing can be missed if the server was
 * down at midnight on Sunday.
 */
export function weekKey(at = new Date()): string {
  const { date } = berlinParts(at)
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Weekly goals rotate so the guild is not doing the same chore forever. */
const GOAL_ROTATION = [
  { kind: 'catches', target: 1000, labelKey: 'guild.goal.catches' },
  { kind: 'battles', target: 400, labelKey: 'guild.goal.battles' },
  { kind: 'raidDamage', target: 250_000, labelKey: 'guild.goal.raidDamage' },
  { kind: 'careActions', target: 800, labelKey: 'guild.goal.careActions' },
]

export function goalForWeek(week: string): typeof GOAL_ROTATION[number] {
  const n = Number(week.slice(-2)) || 0
  return GOAL_ROTATION[n % GOAL_ROTATION.length]!
}

export const GOAL_REWARD_PER_MEMBER = 400

export function overview(ctx: AppContext, trainer: Trainer) {
  const guild = guilds.guildOf(ctx.db, trainer.id)
  if (!guild) {
    return {
      guild: null,
      open: guilds.listOpen(ctx.db).map((g) => ({
        id: g.id, name: g.name, tag: g.tag, motto: g.motto, memberCount: g.memberCount,
      })),
      foundingCost: FOUNDING_COST,
      maxMembers: MAX_MEMBERS,
      gold: inventory.goldOf(ctx.db, trainer.id),
    }
  }

  const week = weekKey()
  const spec = goalForWeek(week)
  const goal = guilds.ensureGoal(ctx.db, guild.id, week, spec.kind, spec.target)
  const members = guilds.membersOf(ctx.db, guild.id)

  return {
    guild: {
      id: guild.id,
      name: guild.name,
      tag: guild.tag,
      motto: guild.motto,
      treasury: guild.treasury,
      chatBound: guild.chatId !== null,
      joinOpen: guild.joinOpen,
      role: guilds.roleOf(ctx.db, guild.id, trainer.id) ?? 'member',
      members,
      memberCount: members.length,
      maxMembers: MAX_MEMBERS,
      goal: {
        kind: goal.goalKind,
        labelKey: spec.labelKey,
        target: goal.target,
        progress: goal.progress,
        complete: goal.progress >= goal.target,
        claimed: goal.claimedAt !== null,
        rewardPerMember: GOAL_REWARD_PER_MEMBER,
      },
    },
    open: [],
    foundingCost: FOUNDING_COST,
    maxMembers: MAX_MEMBERS,
    gold: inventory.goldOf(ctx.db, trainer.id),
  }
}

export function found(ctx: AppContext, trainer: Trainer, name: string, tag: string, motto: string) {
  const cleanName = name.trim()
  const cleanTag = tag.trim().toUpperCase()
  if (cleanName.length < 3 || cleanName.length > 24) {
    throw new GameError('validation_failed', { field: 'name' })
  }
  if (!/^[A-Z0-9]{2,5}$/.test(cleanTag)) throw new GameError('validation_failed', { field: 'tag' })

  return tx(ctx.db, () => {
    if (guilds.guildOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'already_in_guild' }, 409)
    }
    if (guilds.byTag(ctx.db, cleanTag)) throw new GameError('invalid_state', { reason: 'tag_taken' }, 409)

    inventory.spendGold(ctx.db, trainer.id, FOUNDING_COST)
    const guild = guilds.create(ctx.db, {
      name: cleanName, tag: cleanTag, motto: motto.slice(0, 120), founderId: trainer.id,
    })
    logEvent(ctx.db, trainer.id, 'guild.founded', { guildId: guild.id, tag: cleanTag })
    return guild
  })
}

export function join(ctx: AppContext, trainer: Trainer, guildId: string): void {
  tx(ctx.db, () => {
    if (guilds.guildOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'already_in_guild' }, 409)
    }
    const guild = guilds.byId(ctx.db, guildId)
    if (!guild) throw new GameError('not_found', { guildId }, 404)
    if (!guild.joinOpen) throw new GameError('invalid_state', { reason: 'guild_closed' }, 409)
    if (guilds.membersOf(ctx.db, guild.id).length >= MAX_MEMBERS) {
      throw new GameError('invalid_state', { reason: 'guild_full', max: MAX_MEMBERS }, 409)
    }
    guilds.addMember(ctx.db, guild.id, trainer.id)
    logEvent(ctx.db, trainer.id, 'guild.joined', { guildId: guild.id })
  })
}

export function leave(ctx: AppContext, trainer: Trainer): void {
  tx(ctx.db, () => {
    const guild = guilds.guildOf(ctx.db, trainer.id)
    if (!guild) throw new GameError('invalid_state', { reason: 'not_in_guild' }, 409)

    const members = guilds.membersOf(ctx.db, guild.id)
    const isLeader = guilds.roleOf(ctx.db, guild.id, trainer.id) === 'leader'
    if (isLeader && members.length > 1) {
      // Hand leadership to the longest-serving remaining member rather than
      // leaving the guild without one.
      const successor = members.filter((m) => m.trainerId !== trainer.id)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0]!
      ctx.db.prepare('UPDATE guild_members SET role = ? WHERE guild_id = ? AND trainer_id = ?')
        .run('leader', guild.id, successor.trainerId)
    }
    guilds.removeMember(ctx.db, guild.id, trainer.id)
    if (members.length === 1) {
      ctx.db.prepare('DELETE FROM guilds WHERE id = ?').run(guild.id)
    }
    logEvent(ctx.db, trainer.id, 'guild.left', { guildId: guild.id })
  })
}

/** Called from gameplay so the community goal fills itself. */
export function contributeToGoal(ctx: AppContext, trainerId: string, kind: string, amount: number): void {
  const guild = guilds.guildOf(ctx.db, trainerId)
  if (!guild) return
  const week = weekKey()
  const spec = goalForWeek(week)
  if (spec.kind !== kind) return
  guilds.ensureGoal(ctx.db, guild.id, week, spec.kind, spec.target)
  guilds.addGoalProgress(ctx.db, guild.id, week, amount)
  guilds.addContribution(ctx.db, guild.id, trainerId, amount)
}

export function claimWeeklyReward(ctx: AppContext, trainer: Trainer): { gold: number } {
  return tx(ctx.db, () => {
    const guild = guilds.guildOf(ctx.db, trainer.id)
    if (!guild) throw new GameError('invalid_state', { reason: 'not_in_guild' }, 409)
    const week = weekKey()
    const goal = guilds.goalOf(ctx.db, guild.id, week)
    if (!goal) throw new GameError('invalid_state', { reason: 'no_goal' }, 409)
    if (goal.progress < goal.target) throw new GameError('invalid_state', { reason: 'goal_incomplete' }, 409)

    // The claim is per guild, not per member: whoever taps it pays out
    // everybody, which is what makes it a shared reward.
    if (!guilds.claimGoal(ctx.db, guild.id, week)) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }
    const members = guilds.membersOf(ctx.db, guild.id)
    for (const m of members) inventory.earnGold(ctx.db, m.trainerId, GOAL_REWARD_PER_MEMBER)
    logEvent(ctx.db, trainer.id, 'guild.goalClaimed', { guildId: guild.id, week, members: members.length })
    return { gold: GOAL_REWARD_PER_MEMBER }
  })
}

export function setChat(ctx: AppContext, trainer: Trainer, chatId: string | null): void {
  const guild = guilds.guildOf(ctx.db, trainer.id)
  if (!guild) throw new GameError('invalid_state', { reason: 'not_in_guild' }, 409)
  if (guilds.roleOf(ctx.db, guild.id, trainer.id) !== 'leader') {
    throw new GameError('not_owner', { reason: 'leader_only' }, 403)
  }
  guilds.bindChat(ctx.db, guild.id, chatId)
}

import { GameError, type Trainer } from '@game/shared'
import { von } from './ledger.js'
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

/**
 * Die Wochenziele.
 *
 * Zwei Dinge waren daran falsch, und beide sind hier behoben.
 *
 * Erstens war das Soll eine feste Zahl, entworfen fuer eine volle Gilde: 1000
 * Faenge, 800 Pflegeaktionen. Eine Gilde aus zwei Leuten hatte damit 400 Faenge
 * je Kopf zu erledigen, und das Ziel war nie etwas anderes als Deko. Das Soll
 * zaehlt jetzt **je Mitglied** und folgt der Gilde, wie gross sie gerade ist.
 *
 * Zweitens standen hier Ziele, die niemand erfuellen konnte: `catches` und
 * `careActions` wurden nirgends hochgezaehlt. Wer in einer solchen Woche
 * beitrat, sah eine Leiste, die bei null blieb, egal was er tat. Jetzt fuettert
 * `bumpMetric` die Ziele mit — dieselbe Funktion, die schon an allen richtigen
 * Stellen aufgerufen wird —, und jedes Ziel in dieser Liste hat nachweislich
 * eine Quelle.
 *
 * `min` faengt die Ein-Personen-Gilde ab: ganz ohne Untergrenze waere ein Ziel
 * an einem Nachmittag erledigt.
 *
 * Drittens war auch das Soll je Kopf noch zu hoch — zehn Geschenke die Woche
 * heisst zehn von vierzehn moeglichen Tagen daran denken. Gemeldet als "zu
 * heftig", und die Antwort war nicht "leichter", sondern "mehr davon,
 * kleiner": alle Werte auf ein Drittel, dafuer laufen **drei Ziele
 * gleichzeitig**. Drei kleine Aufgaben nebeneinander sind eine Woche, die man
 * planen kann; eine grosse ist eine Wand.
 */
interface GoalSpec {
  kind: string
  /** Soll je Mitglied. */
  perMember: number
  /** Untergrenze, egal wie klein die Gilde ist. */
  min: number
  labelKey: string
}

const GOAL_ROTATION: GoalSpec[] = [
  { kind: 'catches', perMember: 20, min: 30, labelKey: 'guild.goal.catches' },
  { kind: 'battles', perMember: 8, min: 12, labelKey: 'guild.goal.battles' },
  { kind: 'careActions', perMember: 20, min: 30, labelKey: 'guild.goal.careActions' },
  { kind: 'explores', perMember: 50, min: 70, labelKey: 'guild.goal.explores' },
  { kind: 'raidDamage', perMember: 5000, min: 7000, labelKey: 'guild.goal.raidDamage' },
  { kind: 'eggsHatched', perMember: 2, min: 2, labelKey: 'guild.goal.eggsHatched' },
  { kind: 'evolutions', perMember: 2, min: 3, labelKey: 'guild.goal.evolutions' },
  { kind: 'crafted', perMember: 3, min: 4, labelKey: 'guild.goal.crafted' },
  { kind: 'duelsWon', perMember: 2, min: 2, labelKey: 'guild.goal.duelsWon' },
  { kind: 'dexNew', perMember: 2, min: 3, labelKey: 'guild.goal.dexNew' },
  { kind: 'research', perMember: 1, min: 1, labelKey: 'guild.goal.research' },
  { kind: 'gifts', perMember: 3, min: 4, labelKey: 'guild.goal.gifts' },
]

/** Wie viele Ziele gleichzeitig laufen. */
export const GOALS_PER_WEEK = 3

/**
 * Die drei Ziele dieser Woche.
 *
 * Aus der Wochennummer abgeleitet und damit fuer alle Gilden gleich — und, was
 * wichtiger ist, fuer dieselbe Woche immer dasselbe. Der Abstand von fuenf
 * sorgt dafuer, dass die drei aus verschiedenen Ecken der Liste kommen und
 * nicht dreimal dasselbe Thema treffen.
 */
export function goalsForWeek(week: string): GoalSpec[] {
  const n = Number(week.slice(-2)) || 0
  const out: GoalSpec[] = []
  for (let i = 0; i < GOALS_PER_WEEK; i++) {
    out.push(GOAL_ROTATION[(n * GOALS_PER_WEEK + i * 5) % GOAL_ROTATION.length]!)
  }
  return out
}

/** Das Soll dieser Woche fuer eine Gilde dieser Groesse. */
export const goalTarget = (spec: GoalSpec, memberCount: number): number =>
  Math.max(spec.min, spec.perMember * Math.max(1, memberCount))

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
  const members = guilds.membersOf(ctx.db, guild.id)
  const goals = goalsForWeek(week).map((spec) => {
    const row = guilds.ensureGoal(ctx.db, guild.id, week, spec.kind, goalTarget(spec, members.length))
    return {
      kind: row.goalKind,
      labelKey: spec.labelKey,
      /** Woraus sich das Soll ergibt — die Zahl allein wirkt willkuerlich. */
      perMember: spec.perMember,
      target: row.target,
      progress: row.progress,
      complete: row.progress >= row.target,
      claimed: row.claimedAt !== null,
      rewardPerMember: GOAL_REWARD_PER_MEMBER,
    }
  })

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
      goals,
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
  const spec = goalsForWeek(week).find((g) => g.kind === kind)
  if (!spec) return
  const members = guilds.membersOf(ctx.db, guild.id).length
  guilds.ensureGoal(ctx.db, guild.id, week, spec.kind, goalTarget(spec, members))
  guilds.addGoalProgress(ctx.db, guild.id, week, spec.kind, amount)
  guilds.addContribution(ctx.db, guild.id, trainerId, amount)
}

/** Ein einzelnes Ziel abholen. Seit drei gleichzeitig laufen, sagt der Aufrufer
 *  welches — jedes zahlt fuer sich. */
export function claimWeeklyReward(ctx: AppContext, trainer: Trainer, kind: string): { gold: number } {
  return tx(ctx.db, () => {
    const guild = guilds.guildOf(ctx.db, trainer.id)
    if (!guild) throw new GameError('invalid_state', { reason: 'not_in_guild' }, 409)
    const week = weekKey()
    if (!goalsForWeek(week).some((g) => g.kind === kind)) {
      throw new GameError('invalid_state', { reason: 'no_goal' }, 409)
    }
    const goal = guilds.goalOf(ctx.db, guild.id, week, kind)
    if (!goal) throw new GameError('invalid_state', { reason: 'no_goal' }, 409)
    if (goal.progress < goal.target) throw new GameError('invalid_state', { reason: 'goal_incomplete' }, 409)

    // The claim is per guild, not per member: whoever taps it pays out
    // everybody, which is what makes it a shared reward.
    if (!guilds.claimGoal(ctx.db, guild.id, week, kind)) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }
    const members = guilds.membersOf(ctx.db, guild.id)
    for (const m of members) inventory.earnGold(ctx.db, m.trainerId, GOAL_REWARD_PER_MEMBER, von(ctx, 'guild.goal'))
    logEvent(ctx.db, trainer.id, 'guild.goalClaimed', { guildId: guild.id, week, kind, members: members.length })
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

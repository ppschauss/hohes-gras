import type { BattleEventView, BattleView } from './api'
import { t } from '../i18n'

/**
 * Turn engine events into readable German lines.
 *
 * The engine emits data, not prose. Doing the wording here keeps the engine
 * free of any language, and means a second locale is a JSON file rather than
 * a change to the battle loop.
 */
export function describeEvent(event: BattleEventView, view: BattleView): string[] {
  const nameOf = (side: number, id: string): string => {
    const pool = side === 0 ? view.player.party : view.foe.party
    return pool.find((f) => f.id === id)?.name ?? id
  }
  const e = event as Record<string, unknown>
  const side = Number(e.side ?? 0)
  const who = typeof e.fighter === 'string' ? nameOf(side, e.fighter) : ''

  switch (event.type) {
    case 'move':
      return [t('log.move', { name: who, move: String(e.moveName ?? e.moveId ?? '') })]
    case 'damage': {
      const lines = [t('log.damage', { name: who, n: Number(e.amount ?? 0) })]
      if (e.critical) lines.push(t('log.critical'))
      const eff = Number(e.effectiveness ?? 1)
      if (eff !== 1) lines.push(t(`battle.eff.${eff}`))
      return lines
    }
    case 'miss': return [t('log.miss')]
    case 'weather': return [t('log.weather', { weather: t(`weather.${e.weather}`) })]
    case 'heal': return [t('log.heal', { name: who, n: Number(e.amount ?? 0) })]
    case 'status': return [t('log.status', { name: who, status: t(`status.${String(e.status)}`) })]
    case 'status_damage': return [t('log.status_damage', { name: who, status: t(`status.${String(e.status)}`) })]
    case 'status_cured': return [t('log.status_cured', { name: who })]
    case 'status_blocked': return [t('log.status_blocked', { name: who })]
    case 'stage': {
      const delta = Number(e.delta ?? 0)
      const stat = t(`stat.${String(e.stat)}`)
      if (e.capped || delta === 0) return [t('log.stage_capped', { name: who, stat })]
      return [t(delta > 0 ? 'log.stage_up' : 'log.stage_down', { name: who, stat })]
    }
    case 'confused': return [t('log.confused', { name: who })]
    case 'confusion_hit': return [t('log.confusion_hit', { name: who })]
    case 'flinch': return [t('log.flinch', { name: who })]
    case 'faint': return [t('log.faint', { name: who })]
    case 'switch': return [t('log.switch', { name: String(e.name ?? who) })]
    case 'item': return [t('log.item', { name: who, n: Number(e.healed ?? 0) })]
    case 'no_pp': return [t('log.no_pp')]
    case 'move_failed': return [t('log.move_failed')]
    case 'multi_hit': return [t('log.multi_hit', { n: Number(e.hits ?? 0) })]
    case 'end': return []
    default: return []
  }
}

export function describeTurn(events: BattleEventView[], view: BattleView): string[] {
  return events.flatMap((e) => describeEvent(e, view))
}

/** Label for a move's effectiveness against the current foe. */
export function effectivenessLabel(value: number): string | null {
  if (value === 1) return null
  const key = `battle.eff.${value}`
  const label = t(key)
  return label === key ? null : label
}

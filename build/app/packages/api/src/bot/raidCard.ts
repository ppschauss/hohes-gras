import { InlineKeyboard } from 'grammy'
import { raidProgress, TIER_SPECS, type RaidTier } from '@game/engine'
import type { AppContext } from '../context.js'
import * as raids from '../repos/raids.js'

/**
 * The raid card posted into a Telegram group.
 *
 * This is the one place where the game leaves the Mini App: a message in the
 * group chat that everyone sees, with a button that pulls them in. A raid that
 * only existed inside the app would be a solo feature with extra steps.
 */
export function renderRaidCard(ctx: AppContext, raidId: string): { text: string; keyboard: InlineKeyboard } | null {
  const raid = raids.byId(ctx.db, raidId)
  if (!raid) return null

  const species = ctx.registry.trySpecies(raid.speciesId)
  const name = species ? ctx.registry.localized(species.name, 'de') : raid.speciesId
  const parts = raids.participantsOf(ctx.db, raid.id)
  const progress = raidProgress(raid.hpLeft, raid.hpMax)
  const spec = TIER_SPECS[raid.tier as RaidTier]

  const bar = progressBar(progress)
  const lines = [
    raid.defeatedAt
      ? `💥 *${escape(name)} wurde besiegt!*`
      : `⚔️ *Raid-Boss: ${escape(name)}*`,
    `Stufe ${raid.tier} · Level ${raid.level}`,
    '',
    `${bar} ${Math.round(progress * 100)} %`,
    `${formatNumber(raid.hpLeft)} / ${formatNumber(raid.hpMax)} KP`,
    '',
  ]

  if (parts.length > 0) {
    lines.push('*Beteiligt:*')
    for (const p of parts.slice(0, 8)) {
      lines.push(`· ${escape(p.displayName)} — ${formatNumber(p.damage)} Schaden`)
    }
    if (parts.length > 8) lines.push(`… und ${parts.length - 8} weitere`)
  } else {
    lines.push('_Noch niemand dabei._')
  }

  if (raid.defeatedAt) {
    lines.push('', `🪙 ${formatNumber(spec?.goldPool ?? 0)} Gold wurden verteilt.`)
  } else {
    lines.push('', `Endet ${relativeTime(raid.expiresAt)}.`)
  }

  const keyboard = new InlineKeyboard()
  if (!raid.defeatedAt) {
    // A deep link rather than a callback: attacking needs the player's team and
    // belongs in the app, and the link carries them straight to this raid.
    keyboard.url('⚔️ Mitkämpfen', `https://t.me/${ctx.config.BOT_USERNAME ?? 'bot'}/app?startapp=raid_${raid.id.replace(/-/g, '')}`)
    keyboard.row().text('🔄 Stand aktualisieren', `raid:refresh:${raid.id}`)
  }

  return { text: lines.join('\n'), keyboard }
}

const FILLED = '█'
const EMPTY = '░'

function progressBar(ratio: number, width = 12): string {
  const filled = Math.round(ratio * width)
  return FILLED.repeat(filled) + EMPTY.repeat(Math.max(0, width - filled))
}

const formatNumber = (n: number): string => new Intl.NumberFormat('de-DE').format(n)

function relativeTime(at: number): string {
  const minutes = Math.max(0, Math.round((at - Date.now()) / 60_000))
  if (minutes < 60) return `in ${minutes} Min`
  const hours = Math.round(minutes / 60)
  return `in ${hours} Std`
}

const escape = (text: string): string => text.replace(/([_*`[\]])/g, '\\$1')

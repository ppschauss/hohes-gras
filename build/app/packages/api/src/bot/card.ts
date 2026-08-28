import type { AppContext } from '../context.js'
import { trainerCard } from '../services/social.js'
import { findById } from '../repos/trainers.js'

/**
 * Render a trainer card as Telegram-flavoured text.
 *
 * Sharing happens through the chat, not through an image: text survives
 * forwarding, is searchable, works on every client, and needs no renderer.
 */
export function renderCard(ctx: AppContext, trainerId: string): { text: string; deepLink: string } | null {
  const trainer = findById(ctx.db, trainerId)
  if (!trainer) return null

  const card = trainerCard(ctx, trainer, trainerId)
  const badgeLine = card.badges.length > 0
    ? card.badges.map((b) => b.name).join(' · ')
    : 'noch keine'

  const team = card.teamPreview.length > 0
    ? card.teamPreview.map((m) => `${m.shiny ? '✨' : ''}${m.name} Lv${m.level}`).join(', ')
    : 'noch kein Team'

  const lines = [
    `*${escapeMarkdown(card.displayName)}*`,
    `Trainer-Code: \`${card.trainerCode}\``,
    '',
    `🏅 Orden: ${escapeMarkdown(badgeLine)}`,
    `📖 Pokédex: ${card.dexCaught}/${card.dexTotal}`,
    `⚔️ Siege: ${card.battlesWon}`,
    `✨ Schillernde: ${card.shinies}`,
    `⭐ Höchstes Level: ${card.highestLevel}`,
    card.rank ? `🏆 Rang ${card.rank}` : '',
    '',
    `👥 Team: ${escapeMarkdown(team)}`,
  ].filter(Boolean)

  return {
    text: lines.join('\n'),
    deepLink: `?startapp=friend_${card.trainerCode.replace('-', '')}`,
  }
}

/** Telegram's legacy Markdown breaks on unescaped specials in user content. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`[\]])/g, '\\$1')
}

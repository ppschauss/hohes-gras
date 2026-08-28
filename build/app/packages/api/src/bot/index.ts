import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy'
import type { AppContext } from '../context.js'
import { createInvite, listInvites } from '../repos/invites.js'
import { findByTelegramId, setAdmin, countTrainers } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { renderCard } from './card.js'
import { renderRaidCard } from './raidCard.js'
import * as guildRepo from '../repos/guilds.js'
import * as raidRepo from '../repos/raids.js'

const COMMANDS = [
  { command: 'start', description: 'Spiel öffnen' },
  { command: 'spielen', description: 'Mini-App starten' },
  { command: 'karte', description: 'Deine Trainerkarte teilen' },
  { command: 'code', description: 'Deinen Trainer-Code anzeigen' },
  { command: 'hilfe', description: 'Was der Bot kann' },
]

const GROUP_COMMANDS = [
  { command: 'gilde', description: 'Chat mit deiner Gilde verbinden' },
  { command: 'raid', description: 'Laufende Raids anzeigen' },
]

const ADMIN_COMMANDS = [
  { command: 'einladen', description: 'Einladungscode erzeugen (Admin)' },
  { command: 'codes', description: 'Offene Einladungen (Admin)' },
]

export function createBot(ctx: AppContext): Bot {
  const bot = new Bot(ctx.config.BOT_TOKEN)
  const appUrl = ctx.config.PUBLIC_URL

  const openKeyboard = {
    inline_keyboard: [[{ text: '🎮 Spielen', web_app: { url: appUrl } }]],
  }

  const isAdmin = (telegramId: string): boolean => {
    if (ctx.config.adminTelegramId === telegramId) return true
    return findByTelegramId(ctx.db, telegramId)?.isAdmin === true
  }

  bot.command(['start', 'spielen'], async (c) => {
    const tgId = String(c.from?.id ?? '')
    // First contact is also how the operator learns their own numeric id,
    // which is what ADMIN_TELEGRAM_ID in secrets.env needs.
    ctx.db && logEvent(ctx.db, null, 'bot.start', { telegramId: tgId, username: c.from?.username ?? '' })
    console.log(`[bot] /start von telegram_id=${tgId} (@${c.from?.username ?? '—'})`)

    const known = findByTelegramId(ctx.db, tgId)
    const text = known
      ? `Willkommen zurück, ${known.displayName}!\nTipp auf *Spielen*, um in deinen Garten zu kommen.`
      : countTrainers(ctx.db) === 0
        ? 'Der Server ist frisch — du bist der erste Trainer und wirst automatisch Admin.\nTipp auf *Spielen*.'
        : 'Willkommen! Für den Start brauchst du einen Einladungscode.\nHast du einen, tipp auf *Spielen* und gib ihn dort ein.'

    await c.reply(text, { parse_mode: 'Markdown', reply_markup: openKeyboard })
  })

  bot.command('code', async (c) => {
    const trainer = findByTelegramId(ctx.db, String(c.from?.id ?? ''))
    if (!trainer) return c.reply('Du hast noch keinen Trainer. Tipp /start.')
    await c.reply(`Dein Trainer-Code:\n\`${trainer.trainerCode}\`\n\nFreunde können dich damit hinzufügen.`, {
      parse_mode: 'Markdown',
    })
  })

  bot.command('karte', async (c) => {
    const me = findByTelegramId(ctx.db, String(c.from?.id ?? ''))
    if (!me) return c.reply('Du hast noch keinen Trainer. Tipp /start.')
    const card = renderCard(ctx, me.id)
    if (!card) return c.reply('Karte konnte nicht erstellt werden.')
    await c.reply(card.text, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().url('🎮 Mitspielen', `https://t.me/${c.me.username}/app`),
    })
  })

  // Inline-Modus: `@bot` in einem beliebigen Chat tippen und die Karte teilen.
  // Muss beim BotFather mit /setinline freigeschaltet sein, sonst kommt hier
  // nie eine Anfrage an.
  bot.on('inline_query', async (c) => {
    const me = findByTelegramId(ctx.db, String(c.from.id))
    if (!me) {
      return c.answerInlineQuery([], {
        cache_time: 5,
        button: { text: 'Erst Trainer werden', start_parameter: 'start' },
      })
    }
    const card = renderCard(ctx, me.id)
    if (!card) return c.answerInlineQuery([], { cache_time: 5 })
    await c.answerInlineQuery(
      [{
        type: 'article',
        id: `card-${me.id}`,
        title: 'Meine Trainerkarte',
        description: `${me.displayName} — Code ${me.trainerCode}`,
        input_message_content: { message_text: card.text, parse_mode: 'Markdown' },
        reply_markup: new InlineKeyboard().url('🎮 Mitspielen', `https://t.me/${c.me.username}/app`),
      }],
      { cache_time: 30, is_personal: true },
    )
  })

  bot.command('hilfe', async (c) => {
    const lines = [
      '*OtakuPulse Poké Game*',
      '',
      '/spielen — öffnet die Mini-App',
      '/karte — teilt deine Trainerkarte',
      '/code — zeigt deinen Trainer-Code',
      '',
      '*In Gruppen*',
      '/gilde — diesen Chat mit deiner Gilde verbinden',
      '/raid — laufende Raids hier anzeigen',
      '',
      'Alles Weitere passiert in der App.',
    ]
    if (isAdmin(String(c.from?.id ?? ''))) {
      lines.push('', '*Admin*', '/einladen — neuen Code erzeugen', '/codes — offene Codes anzeigen')
    }
    await c.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: openKeyboard })
  })

  bot.command('einladen', async (c) => {
    const tgId = String(c.from?.id ?? '')
    if (!isAdmin(tgId)) return c.reply('Das kann nur ein Admin.')
    const me = findByTelegramId(ctx.db, tgId)
    const arg = (c.match ?? '').toString().trim()
    const uses = Math.min(50, Math.max(1, Number.parseInt(arg, 10) || 1))
    const invite = createInvite(ctx.db, { createdBy: me?.id ?? null, maxUses: uses, expiresInDays: 30, note: 'per Bot' })
    const deepLink = `https://t.me/${c.me.username}/app?startapp=${invite.code}`
    await c.reply(
      `Einladungscode: \`${invite.code}\`\nGültig 30 Tage, ${uses}× nutzbar.\n\nOder direkt weiterleiten:\n${deepLink}`,
      { parse_mode: 'Markdown' },
    )
  })

  bot.command('codes', async (c) => {
    if (!isAdmin(String(c.from?.id ?? ''))) return c.reply('Das kann nur ein Admin.')
    const open = listInvites(ctx.db, 20).filter((i) => i.uses < i.maxUses)
    if (open.length === 0) return c.reply('Keine offenen Einladungen. /einladen erzeugt eine.')
    const lines = open.map((i) => `\`${i.code}\` — ${i.uses}/${i.maxUses} genutzt`)
    await c.reply(['*Offene Einladungen*', ...lines].join('\n'), { parse_mode: 'Markdown' })
  })

  // --- Gruppen: Gilde an den Chat binden und Raid-Karten posten -----------

  bot.command('gilde', async (c) => {
    if (c.chat.type === 'private') {
      return c.reply('Dieses Kommando gehört in eine Gruppe: es verbindet den Chat mit deiner Gilde.')
    }
    const me = findByTelegramId(ctx.db, String(c.from?.id ?? ''))
    if (!me) return c.reply('Du brauchst zuerst einen Trainer. Schreib mir privat /start.')

    const guild = guildRepo.guildOf(ctx.db, me.id)
    if (!guild) return c.reply('Du bist in keiner Gilde. Gründe oder tritt einer in der App bei.')
    if (guildRepo.roleOf(ctx.db, guild.id, me.id) !== 'leader') {
      return c.reply('Nur die Gildenleitung kann den Chat verbinden.')
    }

    guildRepo.bindChat(ctx.db, guild.id, String(c.chat.id))
    await c.reply(
      `✅ *${guild.name}* [${guild.tag}] ist jetzt mit diesem Chat verbunden.\n` +
      'Raids erscheinen ab sofort hier.',
      { parse_mode: 'Markdown' },
    )
  })

  bot.command('raid', async (c) => {
    const me = findByTelegramId(ctx.db, String(c.from?.id ?? ''))
    if (!me) return c.reply('Du brauchst zuerst einen Trainer. Schreib mir privat /start.')
    const guild = guildRepo.guildOf(ctx.db, me.id)
    if (!guild) return c.reply('Du bist in keiner Gilde.')

    const open = raidRepo.openForGuild(ctx.db, guild.id)
    if (open.length === 0) {
      return c.reply('Gerade läuft kein Raid. In der App kann die Gilde einen beschwören.')
    }
    for (const raid of open) {
      const card = renderRaidCard(ctx, raid.id)
      if (!card) continue
      const sent = await c.reply(card.text, { parse_mode: 'Markdown', reply_markup: card.keyboard })
      raidRepo.setMessageId(ctx.db, raid.id, sent.message_id)
    }
  })

  bot.callbackQuery(/^raid:refresh:(.+)$/, async (c) => {
    const raidId = c.match?.[1]
    if (!raidId) return c.answerCallbackQuery()
    const card = renderRaidCard(ctx, raidId)
    if (!card) return c.answerCallbackQuery({ text: 'Dieser Raid existiert nicht mehr.' })
    try {
      await c.editMessageText(card.text, { parse_mode: 'Markdown', reply_markup: card.keyboard })
    } catch {
      // Telegram lehnt eine Bearbeitung ab, wenn sich nichts geaendert hat —
      // das ist kein Fehler, sondern die haeufigste Antwort auf "Aktualisieren".
    }
    await c.answerCallbackQuery({ text: 'Stand aktualisiert.' })
  })

  bot.catch((err) => {
    const e = err.error
    if (e instanceof GrammyError) console.error('[bot] Telegram-Fehler:', e.description)
    else if (e instanceof HttpError) console.error('[bot] Netzwerkfehler zu Telegram:', e.message)
    else console.error('[bot] unerwarteter Fehler:', e)
  })

  return bot
}

/** Publish the command list and the menu button, so the operator does not have
 *  to keep BotFather in sync with the code by hand. */
export async function syncBotProfile(bot: Bot, appUrl: string): Promise<void> {
  await bot.api.setMyCommands([...COMMANDS, ...GROUP_COMMANDS])
  const admin = process.env.ADMIN_TELEGRAM_ID
  if (admin) {
    await bot.api.setMyCommands([...COMMANDS, ...ADMIN_COMMANDS], {
      scope: { type: 'chat', chat_id: Number(admin) },
    }).catch(() => { /* admin hat den Bot noch nicht gestartet */ })
  }
  if (appUrl.startsWith('https://')) {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Spielen', web_app: { url: appUrl } },
    })
  } else {
    console.warn(`[bot] Menü-Button nicht gesetzt: ${appUrl} ist kein HTTPS. Telegram verlangt HTTPS für Mini-Apps.`)
  }
}

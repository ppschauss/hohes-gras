import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy'
import type { AppContext } from '../context.js'
import { findByTelegramId, setAdmin, countTrainers } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { createCode as createLinkCode, LINK_CODE_TTL_MS } from '../services/link.js'
import { eventSpecies, grantEventSpecies, grantItem } from '../services/eventGift.js'
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

const ADMIN_COMMANDS = [
  { command: 'event', description: 'Ereignis-Wesen vergeben (Admin)' },
  { command: 'gegenstand', description: 'Gegenstände vergeben (Admin)' },
]

const GROUP_COMMANDS = [
  { command: 'gilde', description: 'Chat mit deiner Gilde verbinden' },
  { command: 'raid', description: 'Laufende Raids anzeigen' },
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
        : 'Willkommen bei *Hohes Gras*!\nTipp auf *Spielen*, such dir ein Starter-Pokémon aus und los geht\'s.'

    await c.reply(text, { parse_mode: 'Markdown', reply_markup: openKeyboard })
  })

  bot.command('code', async (c) => {
    const trainer = findByTelegramId(ctx.db, String(c.from?.id ?? ''))
    if (!trainer) return c.reply('Du hast noch keinen Trainer. Tipp /start.')
    await c.reply(`Dein Trainer-Code:\n\`${trainer.trainerCode}\`\n\nFreunde können dich damit hinzufügen.`, {
      parse_mode: 'Markdown',
    })
  })

  bot.command(['browser', 'web'], async (c) => {
    const trainer = findByTelegramId(ctx.db, String(c.from?.id ?? ''))
    if (!trainer) return c.reply('Du hast noch keinen Trainer. Tipp /start.')
    // Nur im Privatchat: in einer Gruppe waere der Code fuer alle lesbar und
    // damit ein Konto zum Mitnehmen.
    if (c.chat.type !== 'private') {
      return c.reply('Das geht nur im Privatchat mit mir — ein Code in einer Gruppe wäre für alle lesbar.')
    }
    const code = createLinkCode(ctx, trainer)
    const minutes = Math.round(LINK_CODE_TTL_MS / 60_000)
    await c.reply(
      `Dein Code für den Browser:\n\n\`${code.formatted}\`\n\n`
      + `Gib ihn auf ${ctx.config.PUBLIC_URL || 'der Webseite'} ein. Gültig für ${minutes} Minuten, einmal verwendbar.\n`
      + 'Verbundene Geräte siehst du in der App unter Konto.',
      { parse_mode: 'Markdown' },
    )
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
      '/browser — Code, um dich im Browser anzumelden',
      '',
      '*In Gruppen*',
      '/gilde — diesen Chat mit deiner Gilde verbinden',
      '/raid — laufende Raids hier anzeigen',
      '',
      'Alles Weitere passiert in der App.',
    ]
    if (isAdmin(String(c.from?.id ?? ''))) {
      lines.push(
      '', '*Admin*',
      '/event — Ereignis-Wesen vergeben',
      '/gegenstand — Gegenstände vergeben',
    )
    }
    await c.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: openKeyboard })
  })

  bot.command('event', async (c) => {
    const tgId = String(c.from?.id ?? '')
    if (!isAdmin(tgId)) return c.reply('Das kann nur ein Admin.')
    const me = findByTelegramId(ctx.db, tgId)
    if (!me) return c.reply('Du hast noch keinen Trainer. Tipp /start.')

    const args = (c.match ?? '').toString().trim().split(/\s+/).filter(Boolean)
    const available = eventSpecies(ctx)
    if (args.length === 0) {
      const list = available.map((s) => `\`${s.id}\` — ${s.name}`).join('\n')
      return c.reply(
        `*Ereignis-Wesen vergeben*\n\n\`/event <Trainer-Code> [Art]\`\n\n`
        + `Verfügbar:\n${list || '— keine —'}\n\n`
        + 'Ohne Art wird die erste genommen. Vergeben wird immer schillernd, '
        + 'mit makellosen Werten, auf Level 5.',
        { parse_mode: 'Markdown' },
      )
    }

    const code = args[0]!
    const speciesId = args[1] ?? available[0]?.id
    if (!speciesId) return c.reply('Dieses Pack kennt keine Ereignis-Arten.')

    try {
      const gift = grantEventSpecies(ctx, me, code, speciesId)
      await c.reply(
        `✨ *${gift.speciesName}* liegt jetzt in der Box von *${gift.trainerName}* `
        + `— Level ${gift.level}, schillernd, makellose Werte.`,
        { parse_mode: 'Markdown' },
      )
    } catch (err) {
      const code2 = err instanceof Error ? err.message : 'unbekannt'
      await c.reply(
        code2 === 'not_found'
          ? 'Kein Trainer mit diesem Code — oder die Art gibt es nicht.'
          : `Ging nicht: ${code2}`,
      )
    }
  })

  bot.command(['gegenstand', 'item'], async (c) => {
    const tgId = String(c.from?.id ?? '')
    if (!isAdmin(tgId)) return c.reply('Das kann nur ein Admin.')
    const me = findByTelegramId(ctx.db, tgId)
    if (!me) return c.reply('Du hast noch keinen Trainer. Tipp /start.')

    const args = (c.match ?? '').toString().trim().split(/\s+/).filter(Boolean)
    if (args.length < 2) {
      return c.reply(
        '*Gegenstand vergeben*\n\n`/gegenstand <Trainer-Code> <Gegenstand-Id> [Anzahl]`\n\n'
        + 'Beispiel: `/gegenstand ABCD1234 lure-legendary 250`\n'
        + 'Ohne Anzahl wird einer vergeben.',
        { parse_mode: 'Markdown' },
      )
    }

    try {
      const gift = grantItem(ctx, me, args[0]!, args[1]!, Number.parseInt(args[2] ?? '1', 10))
      await c.reply(
        `📦 *${gift.quantity}× ${gift.itemName}* liegen jetzt im Beutel von *${gift.trainerName}* `
        + `— insgesamt ${gift.total}.`,
        { parse_mode: 'Markdown' },
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unbekannt'
      await c.reply(
        reason === 'not_found'
          ? 'Kein Trainer mit diesem Code — oder den Gegenstand gibt es nicht.'
          : `Ging nicht: ${reason}`,
      )
    }
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

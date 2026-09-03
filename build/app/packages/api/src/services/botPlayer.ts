/**
 * Trainer, die der Server selbst spielt.
 *
 * Der Wunsch dahinter war "damit da etwas mehr los ist": eine Rangliste mit
 * zwei Namen, ein leerer Marktplatz und ein Chat ohne Zeilen fuehlen sich
 * auch dann tot an, wenn das Spiel dahinter vollstaendig ist.
 *
 * Der wichtigste Entwurfsentscheid steckt darin, was diese Datei *nicht* tut:
 * sie schreibt an keiner Stelle selbst in die Datenbank. Jede Handlung geht
 * durch denselben Dienst, den auch ein Mensch ueber die Oberflaeche ausloest —
 * `explore`, `throwBall`, `performCare`, `createListing`. Damit gilt fuer die
 * Bots jede Regel, die fuer Spieler gilt: Energie, Beutelgrenzen, Boxplatz,
 * Preisgrenzen im Markt. Ein Bot, der an den Regeln vorbei Pokemon bekaeme,
 * waere kein Mitspieler, sondern eine Verzierung.
 *
 * Was sie stattdessen kostet: sie muss mit Absagen umgehen koennen. Keine
 * Energie, Box voll, kein Ball mehr — all das wirft, und all das ist normal.
 * Deshalb faengt `versuche()` jede Absage ab und geht zur naechsten Handlung
 * ueber, statt den ganzen Durchlauf abzubrechen.
 */
import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as trainers from '../repos/trainers.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { von } from './ledger.js'
import { chooseStarter, performCare, startRegions, starterSpeciesFor } from './garden.js'
import { explore, throwBall } from './safari.js'
import { createListing } from './social.js'
import * as social from '../repos/social.js'

/** Wie ein Bot spielt. Die Unterschiede sind klein, aber sie reichen, damit
 *  drei Namen in der Rangliste nicht dreimal dieselbe Kurve beschreiben. */
export interface BotProfil {
  /** Stabile Kennung; sie steht auch in `telegram_id` und macht das Anlegen
   *  wiederholbar, ohne dass eine zweite Instanz entsteht. */
  key: string
  name: string
  /** Wie oft je Durchlauf gefangen statt gepflegt wird, 0..1. */
  jagdlust: number
  /** Ab wie vielen Pokemon in der Box eines auf den Markt wandert. */
  marktAb: number
  /** Womit geworfen wird, in dieser Reihenfolge — der erste vorhandene Ball. */
  baelle: string[]
}

export const BOTS: BotProfil[] = [
  {
    key: 'bot-mira', name: 'Mira',
    jagdlust: 0.8, marktAb: 12, baelle: ['great-ball', 'poke-ball'],
  },
  {
    key: 'bot-kenji', name: 'Kenji',
    jagdlust: 0.5, marktAb: 20, baelle: ['poke-ball'],
  },
  {
    key: 'bot-yuki', name: 'Yuki',
    jagdlust: 0.3, marktAb: 8, baelle: ['great-ball', 'poke-ball'],
  },
]

/** Startausstattung. Bewusst knapp: ein Bot soll sich versorgen, nicht
 *  ausgestattet werden. */
const AUSSTATTUNG: Array<{ itemId: string; menge: number }> = [
  { itemId: 'poke-ball', menge: 30 },
  { itemId: 'oran-berry', menge: 20 },
  { itemId: 'razz-berry', menge: 10 },
]

const PFLEGE = ['feed', 'play', 'wash', 'rest'] as const

/** Ein Angebot, das noch steht: weder verkauft noch zurueckgezogen. */
const offenesAngebot = (l: social.Listing): boolean => l.soldAt === null && l.cancelledAt === null

/**
 * Eine Handlung versuchen und eine Absage hinnehmen.
 *
 * Spielregeln melden sich als `GameError` — keine Energie, Box voll, kein
 * Ball. Das sind erwartete Antworten und keine Stoerungen; nur alles andere
 * darf laut werden, sonst verschluckt diese Schleife echte Fehler.
 */
function versuche<T>(was: string, fn: () => T): T | null {
  try {
    return fn()
  } catch (err) {
    if (err instanceof GameError) return null
    console.error(`[bot] ${was} fehlgeschlagen:`, (err as Error).message)
    return null
  }
}

/** Ein Zufallsgenerator, der nicht von `Math.random` abhaengt: derselbe
 *  Durchlauf soll sich im Test wiederholen lassen. */
export type Wuerfel = () => number

const waehle = <T>(liste: readonly T[], rng: Wuerfel): T | undefined =>
  liste.length === 0 ? undefined : liste[Math.floor(rng() * liste.length)]

/**
 * Region und Startpokemon in einem Zug waehlen.
 *
 * Beides gehoert zusammen, und zwar zwingend: `starterSpeciesFor` liefert ohne
 * Regionsangabe die Arten *aller* Startregionen, `chooseStarter` prueft die
 * Wahl aber gegen *eine*. Wer die Art ohne ihre Region weiterreicht, waehlt
 * also aus einem groesseren Topf, als hinterher akzeptiert wird.
 */
export function starterFuer(
  ctx: AppContext, trainer: Trainer, rng: Wuerfel,
): { regionId: string; speciesId: string } | null {
  const region = startRegions(ctx, trainer)[0]
  if (!region) return null
  const art = waehle(starterSpeciesFor(ctx, trainer, region.regionId), rng)
  return art ? { regionId: region.regionId, speciesId: art } : null
}

/**
 * Die Bot-Konten anlegen, falls sie fehlen.
 *
 * Idempotent ueber `telegram_id`: der Aufruf darf bei jedem Serverstart und
 * bei jedem Durchlauf passieren, ohne dass ein vierter Mira entsteht.
 */
export function ensureBots(ctx: AppContext, rng: Wuerfel = Math.random): Trainer[] {
  const heraus: Trainer[] = []
  for (const profil of BOTS) {
    const da = trainers.findByTelegramId(ctx.db, profil.key)
    if (da) { heraus.push(da); continue }

    const neu = tx(ctx.db, () => {
      const t = trainers.createTrainer(ctx.db, {
        telegramId: profil.key,
        displayName: profil.name,
        locale: 'de',
        isAdmin: false,
        startingGold: 3000,
        startingAreaId: ctx.registry.manifest.startingArea,
      })
      ctx.db.prepare('UPDATE trainers SET is_bot = 1 WHERE id = ?').run(t.id)
      for (const a of AUSSTATTUNG) {
        inventory.grant(ctx.db, t.id, a.itemId, a.menge, von(ctx, 'bot.setup'))
      }
      logEvent(ctx.db, t.id, 'bot.created', { key: profil.key })
      return trainers.findById(ctx.db, t.id)!
    })

    // Der Starter steht ausserhalb: `chooseStarter` fuehrt seine eigene
    // Transaktion, und verschachtelte Transaktionen kann better-sqlite3 nicht.
    const wahl = starterFuer(ctx, neu, rng)
    if (wahl) {
      /*
       * Hier wird die Absage *nicht* verschluckt.
       *
       * Ein Bot ohne Startpokemon ist kein normaler Zustand, sondern ein
       * Fehler im Anlegen — und genau der ist schon einmal still
       * durchgegangen: zwei von drei Bots standen ohne Starter da, weil die
       * Art aus der falschen Region kam, und `versuche()` hat es geschluckt.
       */
      try {
        chooseStarter(ctx, neu, wahl.speciesId, wahl.regionId)
      } catch (err) {
        console.error(`[bot] ${profil.name} bekam keinen Starter:`, (err as Error).message)
      }
    }

    heraus.push(trainers.findById(ctx.db, neu.id)!)
  }
  return heraus
}

/** Welcher Ball gerade da ist — der erste aus der Vorliebe des Bots. */
const ballVon = (ctx: AppContext, bot: Trainer, profil: BotProfil): string | null =>
  profil.baelle.find((id) => inventory.quantityOf(ctx.db, bot.id, id) > 0) ?? null

/**
 * Nachkaufen, wenn die Baelle ausgehen.
 *
 * Ohne das laeuft ein Bot nach ein paar Tagen leer und steht still — und ein
 * stillstehender Bot ist genau das, was er nicht sein soll. Gold verdient er
 * sich beim Fangen; hier wird es wieder ausgegeben.
 */
function kaufeBaelle(ctx: AppContext, bot: Trainer): void {
  const ball = ctx.registry.tryItem('poke-ball')
  if (!ball?.price) return
  if (inventory.quantityOf(ctx.db, bot.id, 'poke-ball') >= 10) return
  const gold = inventory.goldOf(ctx.db, bot.id)
  const menge = Math.min(20, Math.floor(gold / ball.price))
  if (menge < 1) return
  tx(ctx.db, () => {
    inventory.spendGold(ctx.db, bot.id, ball.price! * menge)
    inventory.grant(ctx.db, bot.id, 'poke-ball', menge, von(ctx, 'bot.shop'))
  })
}

/**
 * Ein Pokemon aus der Box anbieten.
 *
 * Erst ab `marktAb`, damit ein Bot nicht sein letztes Pokemon verkauft, und
 * nie das Team. Der Preis richtet sich nach Level — grob, aber nachvollziehbar,
 * und vor allem in denselben Grenzen, die fuer Spieler gelten.
 */
function biete(ctx: AppContext, bot: Trainer, profil: BotProfil, rng: Wuerfel): void {
  const offen = social.listingsOfSeller(ctx.db, bot.id).filter(offenesAngebot)
  if (offen.length >= 3) return

  const box = creatures.boxOf(ctx.db, bot.id, 200, 0)
  if (box.length < profil.marktAb) return

  // `boxOf` liefert nur, was ausserhalb des Teams liegt — das Team kann hier
  // also gar nicht erst zum Verkauf stehen.
  const kandidat = waehle(box, rng)
  if (!kandidat) return

  const preis = Math.max(200, Math.round(kandidat.level * 45 * (0.8 + rng() * 0.6)))
  versuche('markt', () => createListing(ctx, bot, kandidat.id, preis, ''))
}

/** Was ein Durchlauf getan hat — fuer das Protokoll und die Tests. */
export interface BotBericht {
  name: string
  erkundet: number
  gefangen: number
  gepflegt: number
  angeboten: number
}

/**
 * Ein Spielzug fuer einen Bot.
 *
 * `handlungen` begrenzt, wie viel je Durchlauf passiert. Die eigentliche
 * Bremse ist aber die Energie: sie waechst mit der Zeit, und ein Bot, der
 * alle zwanzig Minuten laeuft, kann nicht mehr ausgeben als nachwaechst.
 */
export function spieleZug(
  ctx: AppContext, bot: Trainer, profil: BotProfil, handlungen = 6, rng: Wuerfel = Math.random,
): BotBericht {
  const bericht: BotBericht = { name: profil.name, erkundet: 0, gefangen: 0, gepflegt: 0, angeboten: 0 }
  kaufeBaelle(ctx, bot)

  for (let i = 0; i < handlungen; i++) {
    // Der Trainer wird je Handlung neu gelesen: Energie und Gold aendern sich
    // mit jeder, und ein veralteter Stand wuerde Ausgaben erlauben, die es
    // nicht mehr gibt.
    const frisch = trainers.findById(ctx.db, bot.id)
    if (!frisch) return bericht

    if (rng() < profil.jagdlust) {
      const ball = ballVon(ctx, frisch, profil)
      if (!ball) continue
      const fund = versuche('erkunden', () => explore(ctx, frisch, ball, null))
      if (!fund) continue
      bericht.erkundet++
      if (fund.kind !== 'encounter') continue
      const wurf = versuche('werfen', () => throwBall(ctx, frisch, ball, null))
      if (wurf?.caught) bericht.gefangen++
    } else {
      const was = waehle(PFLEGE, rng)!
      if (versuche('pflege', () => performCare(ctx, frisch, was))) bericht.gepflegt++
    }
  }

  /*
   * Die Ranglistenzahlen auffrischen.
   *
   * `leaderboardView` tut das nur fuer den, der gerade hinsieht. Ein Bot sieht
   * nie hin — ohne diesen Aufruf haette er keine Zeile in `leaderboard_stats`
   * und stuende trotz aller Faenge nirgends.
   */
  versuche('rangliste', () => social.refreshStats(ctx.db, bot.id))

  const vorher = social.listingsOfSeller(ctx.db, bot.id).filter(offenesAngebot).length
  biete(ctx, bot, profil, rng)
  bericht.angeboten = social.listingsOfSeller(ctx.db, bot.id).filter(offenesAngebot).length - vorher
  return bericht
}

/** Ein Durchlauf ueber alle Bots — das, was die getaktete Aufgabe aufruft. */
export function tick(ctx: AppContext, handlungen = 6, rng: Wuerfel = Math.random): BotBericht[] {
  const konten = ensureBots(ctx, rng)
  const berichte: BotBericht[] = []
  for (const bot of konten) {
    const profil = BOTS.find((p) => p.key === bot.telegramId)
    if (!profil) continue
    berichte.push(spieleZug(ctx, bot, profil, handlungen, rng))
  }
  return berichte
}

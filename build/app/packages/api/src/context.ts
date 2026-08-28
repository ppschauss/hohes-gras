import { Registry, loadPack } from '@game/content'
import { join } from 'node:path'
import type { Config } from './config.js'
import { migrate, openDb, type Db } from './db/index.js'

/** Everything a request handler may need, assembled once at boot and passed
 *  explicitly. No module-level singletons: tests construct their own context
 *  against an in-memory database. */
export interface AppContext {
  config: Config
  db: Db
  registry: Registry
  startedAt: number
}

export async function createContext(config: Config): Promise<AppContext> {
  const db = openDb(config.dbPath)
  const ran = migrate(db)
  if (ran.length) console.log(`[db] Migrationen angewendet: ${ran.join(', ')}`)

  const packDir = join(config.packsDir, config.CONTENT_PACK)
  const pack = await loadPack(packDir)
  console.log(
    `[content] Pack "${pack.manifest.id}" v${pack.manifest.version}: ` +
    `${pack.species.size} Arten, ${pack.moves.size} Attacken, ${pack.areas.size} Gebiete`,
  )

  const registry = new Registry(pack)
  assertPackSatisfiesGameRules(registry)

  return { config, db, registry, startedAt: Date.now() }
}

/**
 * Item ids the game logic names directly.
 *
 * The engine is content-agnostic, but a few rules are not: the starter kit
 * hands out balls, feeding costs a berry, the default garden background has a
 * name. A pack missing one of those would fail silently at the worst moment —
 * a player feeding a team with an item that does not exist. Catching it at boot
 * turns a mystery into a startup error naming the missing id.
 */
const REQUIRED_ITEM_IDS = [
  'poke-ball',    // Startausruestung und Fang
  'oran-berry',   // Kosten des Fuetterns (CARE_RULES.feed)
  'razz-berry',   // Startausruestung
  'potion',       // Startausruestung
  'bg-classic',   // Vorgabe-Hintergrund neuer Trainer
] as const

function assertPackSatisfiesGameRules(registry: Registry): void {
  const missing = REQUIRED_ITEM_IDS.filter((id) => !registry.tryItem(id))
  if (missing.length) {
    throw new Error(
      `Content-Pack "${registry.manifest.id}" fehlen Items, die die Spiellogik fest benennt: ` +
      `${missing.join(', ')}. Ohne sie brechen Startausrüstung und Pflege.`,
    )
  }
}

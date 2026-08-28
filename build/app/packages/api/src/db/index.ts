import Database from 'better-sqlite3'
import { readFileSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Db = Database.Database

const here = dirname(fileURLToPath(import.meta.url))
/** dist/db/index.js -> ../../migrations ; src/db/index.ts -> ../../migrations */
const MIGRATIONS_DIR = join(here, '..', '..', 'migrations')

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  // WAL lets the scheduler write while requests read. NORMAL sync is the right
  // trade for a game: a crash can lose the last transaction, not the database.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

/** Apply every migration file exactly once, in filename order, each inside its
 *  own transaction. Filenames are the version, so a half-applied deploy can be
 *  resumed simply by starting the server again. */
export function migrate(db: Db, migrationsDir = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  ) STRICT`)

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name),
  )
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const ran: string[] = []

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    const tx = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now())
    })
    try {
      tx()
    } catch (err) {
      throw new Error(`Migration "${file}" fehlgeschlagen: ${(err as Error).message}`)
    }
    ran.push(file)
  }
  return ran
}

/** Wrap a unit of work in a transaction. better-sqlite3 is synchronous, so the
 *  callback must be too — that is deliberate: it makes "read state, decide,
 *  write result" atomic without any await hiding a race in the middle. */
export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)()
}

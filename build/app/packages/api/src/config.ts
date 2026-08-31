import { z } from 'zod'

/** Fail fast on a bad environment: a server that boots with a missing bot
 *  token only to break on the first message is worse than one that refuses. */
const EnvSchema = z.object({
  BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, 'BOT_TOKEN sieht nicht wie ein Telegram-Token aus'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET braucht mindestens 32 Zeichen'),
  ADMIN_TELEGRAM_ID: z.string().regex(/^\d*$/).default(''),
  PUBLIC_URL: z.string().url().default('http://localhost:3010'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('/data'),
  CONTENT_PACK: z.string().default('kanto'),
  TZ: z.string().default('Europe/Berlin'),
  /** Set to "1" to skip Telegram signature checks. Local development only —
   *  the server refuses to start with this on unless NODE_ENV is development. */
  DEV_AUTH_BYPASS: z.string().default('0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /*
   * Verbund — alle drei leer heisst: es gibt keinen, und nichts aendert sich.
   *
   * Das ist die wichtigste Eigenschaft daran. Eine Instanz ohne Verbund
   * verhaelt sich exakt wie vorher; keine Anfrage geht hinaus, kein Fehler
   * kommt herein. Siehe `docs/VERBUND.md`.
   */
  HUB_URL: z.string().default(''),
  HUB_INSTANCE_ID: z.string().default(''),
  HUB_SECRET: z.string().default(''),
  /** Der Git-Stand, mit dem dieses Image gebaut wurde. Setzt das Dockerfile. */
  GIT_SHA: z.string().default('unbekannt'),
})

export type Config = z.infer<typeof EnvSchema> & {
  /** Filled in at boot from getMe, so links can point at the right bot. */
  BOT_USERNAME?: string
  packsDir: string
  mediaDir: string
  backupsDir: string
  dbPath: string
  devAuthBypass: boolean
  adminTelegramId: string | null
  /** Ist ein Verbund eingerichtet? Alles Weitere haengt daran. */
  hubEnabled: boolean
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Konfiguration unvollständig (secrets.env prüfen):\n${lines.join('\n')}`)
  }
  const c = parsed.data
  const devAuthBypass = c.DEV_AUTH_BYPASS === '1'
  if (devAuthBypass && c.NODE_ENV === 'production') {
    throw new Error('DEV_AUTH_BYPASS=1 ist im Produktionsmodus nicht erlaubt.')
  }
  return {
    ...c,
    hubEnabled: Boolean(c.HUB_URL && c.HUB_INSTANCE_ID && c.HUB_SECRET),
    packsDir: `${c.DATA_DIR}/packs`,
    mediaDir: `${c.DATA_DIR}/media`,
    backupsDir: `${c.DATA_DIR}/backups`,
    dbPath: `${c.DATA_DIR}/game.db`,
    devAuthBypass,
    adminTelegramId: c.ADMIN_TELEGRAM_ID === '' ? null : c.ADMIN_TELEGRAM_ID,
  }
}

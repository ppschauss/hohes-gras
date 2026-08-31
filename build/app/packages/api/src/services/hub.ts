import { sign } from '@game/hub'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { logEvent } from '../repos/events.js'
import { requireAdmin } from './admin.js'

/**
 * Die Instanz-Seite des Verbunds.
 *
 * Alles hier ist freiwillig und darf scheitern. Ist kein Verbund eingerichtet,
 * tut jede Funktion nichts; ist er eingerichtet, aber nicht erreichbar, wird
 * das geloggt und das Spiel läuft weiter. Es gibt bewusst keinen Pfad, auf dem
 * ein Fehler des Verbunds eine Spielaktion scheitern lässt — das ist die
 * Bedingung dafür, dass man ihn überhaupt einschalten kann.
 *
 * Der Entwurf steht in `docs/VERBUND.md`.
 */

/** Wie lange eine geholte Rangliste gilt. Sie ändert sich in Minuten nicht
 *  sichtbar, und jeder Blick soll nicht über die Leitung gehen. */
export const LEADERBOARD_TTL_MS = 5 * 60_000

export interface HubLeaderboardRow {
  trainerId: string
  displayName: string
  instanceId: string
  badges: number
  dexCaught: number
  battlesWon: number
  level: number
}

const enabled = (ctx: AppContext): boolean => ctx.config.hubEnabled

/**
 * Ein GET darf nichts zu sagen haben.
 *
 * Signiert wird der Rumpf, geschickt wird er bei GET nicht — `fetch` verbietet
 * das. Wer trotzdem Parameter mitgibt, signiert etwas anderes, als ankommt, und
 * erntet eine 401, die nach einem Schlüsselproblem aussieht statt nach dem, was
 * es ist. Genau so ist der Chat beim ersten Versuch gescheitert: der Client
 * signierte `{"since":N}` und schickte nichts.
 *
 * Lieber laut hier als leise dort. Parameter gehören in einen POST.
 */
export function assertGetHasNoBody(method: string, path: string, raw: string): void {
  if (method === 'GET' && raw !== '{}') {
    throw new Error(`GET ${path} mit Rumpf: Parameter gehoeren in einen POST.`)
  }
}

/** Eine signierte Anfrage an den Verbund. Wirft nie — der Aufrufer bekommt null. */
async function call(
  ctx: AppContext, method: 'GET' | 'POST' | 'PUT', path: string, body: unknown = {},
): Promise<unknown | null> {
  if (!enabled(ctx)) return null
  const raw = JSON.stringify(body ?? {})

  assertGetHasNoBody(method, path, raw)

  const timestamp = Date.now()
  try {
    const signature = await sign(ctx.config.HUB_SECRET, method, path, timestamp, raw)
    const res = await fetch(`${ctx.config.HUB_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-hub-instance': ctx.config.HUB_INSTANCE_ID,
        'x-hub-timestamp': String(timestamp),
        'x-hub-signature': signature,
      },
      /*
       * Signiert wird immer `raw` — geschickt wird es nur, wenn die Methode
       * einen Rumpf erlaubt. `fetch` weist ein GET mit Rumpf rundheraus ab
       * („Request with GET/HEAD method cannot have body"), und weil die Tests
       * `fetch` ersetzt hatten, fiel das erst beim Lauf gegen den echten
       * Worker auf. Die Gegenseite liest einen leeren Rumpf als "{}".
       */
      body: method === 'GET' ? undefined : raw,
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) {
      console.warn(`[hub] ${method} ${path} → ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn(`[hub] ${method} ${path} nicht erreichbar: ${(err as Error).message}`)
    return null
  }
}

/**
 * Wie `call`, aber redselig.
 *
 * `call` verschluckt jede Fehlerantwort zu `null` — richtig für den
 * Hintergrundabgleich, der niemanden stören soll. Für eine Handlung, die
 * jemand gerade ausgelöst hat, ist es falsch: ein unbekannter Trainer-Code
 * meldete sich als „Verbund nicht erreichbar", und der Spieler suchte den
 * Fehler bei sich zu Hause statt in seiner Eingabe.
 *
 * Diese Fassung reicht den Grund des Verbunds durch.
 */
async function callOrThrow(
  ctx: AppContext, method: 'GET' | 'POST' | 'PUT', path: string, body: unknown = {},
): Promise<Record<string, unknown>> {
  if (!enabled(ctx)) throw new GameError('invalid_state', { reason: 'no_hub' }, 409)
  const raw = JSON.stringify(body ?? {})
  assertGetHasNoBody(method, path, raw)
  const timestamp = Date.now()

  let res: Response
  try {
    const signature = await sign(ctx.config.HUB_SECRET, method, path, timestamp, raw)
    res = await fetch(`${ctx.config.HUB_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-hub-instance': ctx.config.HUB_INSTANCE_ID,
        'x-hub-timestamp': String(timestamp),
        'x-hub-signature': signature,
      },
      body: method === 'GET' ? undefined : raw,
      signal: AbortSignal.timeout(8_000),
    })
  } catch (err) {
    console.warn(`[hub] ${method} ${path} nicht erreichbar: ${(err as Error).message}`)
    throw new GameError('invalid_state', { reason: 'hub_unreachable' }, 503)
  }

  const antwort = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    /*
     * Den Grund des Verbunds weiterreichen, nicht einen eigenen erfinden.
     *
     * Aber nur, wenn er zu unseren Fehlerarten gehoert: der Verbund ist ein
     * fremder Dienst, und was er sagt, gehoert geprueft, bevor es als eigener
     * Code weitergegeben wird.
     */
    const code = String(antwort.error ?? '')
    const bekannt = (ERROR_CODES as readonly string[]).includes(code)
    throw new GameError(
      bekannt ? (code as (typeof ERROR_CODES)[number]) : 'invalid_state',
      (antwort.detail ?? {}) as Record<string, unknown>,
      res.status,
    )
  }
  return antwort
}

/**
 * Die globale Id eines Trainers, falls sie schon bekannt ist.
 *
 * Gerechnet wird sie im Verbund, nicht hier: das Salz liegt dort, und genau
 * deshalb kann eine Instanz keine Ids für fremde Spieler erfinden.
 */
export function linkedId(ctx: AppContext, trainerId: string): string | null {
  const row = ctx.db.prepare('SELECT global_id AS id FROM hub_links WHERE trainer_id = ?')
    .get(trainerId) as { id: string } | undefined
  return row?.id ?? null
}

interface Snapshot {
  trainerId: string
  globalId: string
  badges: number
  dexCaught: number
  battlesWon: number
  level: number
  rating: number
  score: number
}

/**
 * Wessen Profil hinaus darf.
 *
 * Wer sich lokal aus der Rangliste genommen hat, taucht auch global nicht auf.
 * Das ist keine Kleinigkeit: der Schalter hieß immer „nicht in der Rangliste",
 * und eine zweite, größere Rangliste wäre genau das, was er verhindern soll.
 */
export function pending(ctx: AppContext, limit = 50): Snapshot[] {
  return ctx.db.prepare(
    `SELECT t.id AS trainerId, l.global_id AS globalId,
            s.badges, s.dex_caught AS dexCaught, s.battles_won AS battlesWon,
            s.highest_level AS level, COALESCE(p.rating, 0) AS rating, s.score
       FROM hub_links l
       JOIN trainers t ON t.id = l.trainer_id
       JOIN leaderboard_stats s ON s.trainer_id = t.id
       LEFT JOIN pvp_ratings p ON p.trainer_id = t.id
      WHERE t.hide_leaderboard = 0 AND t.is_banned = 0 AND s.score != l.pushed_score
      ORDER BY s.updated_at DESC
      LIMIT ?`,
  ).all(limit) as Snapshot[]
}

/** Die geänderten Profile hochschieben. Gibt zurück, wie viele durchkamen. */
export async function pushProfiles(ctx: AppContext, limit = 50): Promise<number> {
  if (!enabled(ctx)) return 0
  let sent = 0
  for (const row of pending(ctx, limit)) {
    const ok = await call(ctx, 'PUT', '/profiles', {
      trainerId: row.globalId,
      badges: row.badges,
      dexCaught: row.dexCaught,
      battlesWon: row.battlesWon,
      level: row.level,
      rating: row.rating,
    })
    if (!ok) break // Erreichbarkeitsproblem — der Rest wartet auf den nächsten Lauf.
    ctx.db.prepare('UPDATE hub_links SET pushed_score = ?, synced_at = ? WHERE trainer_id = ?')
      .run(row.score, Date.now(), row.trainerId)
    sent++
  }
  return sent
}

/**
 * Die zuletzt geholte globale Rangliste, ohne Netz.
 *
 * Die Ansicht ist synchron und soll es bleiben: ein Blick auf die Rangliste
 * darf nicht auf eine fremde Leitung warten. Geholt wird im Hintergrund, hier
 * wird nur gelesen — und ist noch nie etwas angekommen, gibt es eben nichts.
 */
export function cachedLeaderboard(ctx: AppContext): HubLeaderboardRow[] | null {
  if (!enabled(ctx)) return null
  const row = ctx.db.prepare('SELECT payload FROM hub_cache WHERE key = ?')
    .get('leaderboard') as { payload: string } | undefined
  return row ? (JSON.parse(row.payload) as HubLeaderboardRow[]) : null
}

/**
 * Die globale Rangliste holen und ablegen.
 *
 * Kommt nichts an, bleibt der alte Stand stehen statt einer leeren Liste. Eine
 * Rangliste von gestern ist besser als gar keine.
 */
export async function refreshLeaderboard(ctx: AppContext): Promise<number> {
  if (!enabled(ctx)) return 0
  const res = await call(ctx, 'GET', '/leaderboard') as { rows?: HubLeaderboardRow[] } | null
  if (!res?.rows) return 0
  ctx.db.prepare(
    `INSERT INTO hub_cache (key, payload, fetched_at) VALUES ('leaderboard', ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  ).run(JSON.stringify(res.rows), Date.now())
  return res.rows.length
}

/**
 * Trainer, die der Verbund noch nicht kennt.
 *
 * Angemeldet wird im Hintergrund, nicht beim Einloggen: ein langsamer Verbund
 * darf niemanden am Spielen hindern, und es eilt nicht.
 */
export async function linkNew(ctx: AppContext, limit = 20): Promise<number> {
  if (!enabled(ctx)) return 0
  const rows = ctx.db.prepare(
    `SELECT id, telegram_id AS telegramId, display_name AS displayName, trainer_code AS code
       FROM trainers WHERE is_banned = 0 AND id NOT IN (SELECT trainer_id FROM hub_links)
       ORDER BY created_at LIMIT ?`,
  ).all(limit) as Array<{ id: string; telegramId: string; displayName: string; code: string }>

  let linked = 0
  for (const row of rows) {
    const res = await call(ctx, 'POST', '/trainers', {
      // Der Trainer-Code geht mit: ohne ihn kann einen niemand auf einer
      // fremden Instanz finden. Die Telegram-Id bleibt hier.
      telegramId: row.telegramId, displayName: row.displayName, code: row.code,
    }) as { id?: string } | null
    if (!res?.id) break
    ctx.db.prepare(
      `INSERT INTO hub_links (trainer_id, global_id, synced_at, code_pushed) VALUES (?, ?, ?, 1)
       ON CONFLICT(trainer_id) DO UPDATE SET global_id = excluded.global_id, code_pushed = 1`,
    ).run(row.id, res.id, Date.now())
    linked++
  }
  return linked
}


/* ------------------------------------------------------- Aktualisierung */

/**
 * Wie ein Update abläuft — und warum so.
 *
 * Der Verbund **sagt** nur, welcher Stand aktuell ist. Angestoßen wird nichts
 * von außen: was auf einer fremden Maschine passiert, entscheidet deren
 * Besitzer. Er bekommt eine Nachricht und einen Knopf.
 *
 * Und der Knopf baut **nicht** selbst. Ein Container, der sich selbst neu
 * bauen darf, braucht den Docker-Socket des Wirts — das ist Zugriff auf alles,
 * was auf der Maschine läuft. Bei sich zu Hause mag man das vertreten; einer
 * fremden Installation ist es nicht zuzumuten.
 *
 * Stattdessen legt der Knopf eine **Marke** in `data/` ab. Ein kleiner Wächter
 * auf dem Wirt (`./manage.sh watch`) sieht sie, sichert die Datenbank, holt
 * den neuen Stand, baut neu und prüft danach, ob der Dienst antwortet — sonst
 * kehrt er zum alten zurück. Der Container bekommt kein einziges Recht dazu.
 */

/** Wo die Marke liegt. Der Wächter sucht genau hier. */
export const UPDATE_FLAG = 'update-requested'

export interface ReleaseInfo {
  /** Der Stand, mit dem dieses Image gebaut wurde. */
  current: string
  /** Der Stand, den der Verbund als aktuell nennt — null, wenn unbekannt. */
  latest: string | null
  notes: string
  /** Läuft hier ein veralteter Stand? */
  outdated: boolean
  /** Ist schon ein Update angefordert und wartet auf den Wächter? */
  pending: boolean
}

/**
 * Den aktuellen Stand beim Verbund erfragen und ablegen.
 *
 * Wie die Rangliste über den Zwischenspeicher, aus demselben Grund: die
 * Ansicht soll nie auf eine fremde Leitung warten.
 */
export async function refreshRelease(ctx: AppContext): Promise<string | null> {
  if (!enabled(ctx)) return null
  const res = await call(ctx, 'GET', '/release') as
    { release: { sha: string; notes: string } | null } | null
  if (!res?.release) return null
  ctx.db.prepare(
    `INSERT INTO hub_cache (key, payload, fetched_at) VALUES ('release', ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  ).run(JSON.stringify(res.release), Date.now())
  return res.release.sha
}

/** Was die Anzeige über den Stand weiß — ohne Netz. */
export function releaseInfo(ctx: AppContext, trainer?: Trainer): ReleaseInfo {
  if (trainer) requireAdmin(trainer)
  const row = ctx.db.prepare("SELECT payload FROM hub_cache WHERE key = 'release'")
    .get() as { payload: string } | undefined
  let latest: { sha: string; notes: string } | null = null
  if (row) { try { latest = JSON.parse(row.payload) } catch { latest = null } }

  const current = ctx.config.GIT_SHA
  return {
    current,
    latest: latest?.sha ?? null,
    notes: latest?.notes ?? '',
    /*
     * „unbekannt" heißt: aus einem Archiv gebaut, ohne Repository. Dann gibt
     * es nichts zu vergleichen, und ein Update-Hinweis wäre geraten.
     */
    outdated: Boolean(latest && current !== 'unbekannt' && !latest.sha.startsWith(current)
      && !current.startsWith(latest.sha)),
    pending: existsSync(join(ctx.config.DATA_DIR, UPDATE_FLAG)),
  }
}

/**
 * Das Update anfordern.
 *
 * Schreibt die Marke, mehr nicht. Die eigentliche Arbeit tut der Wächter auf
 * dem Wirt — und wenn keiner läuft, passiert schlicht nichts, statt dass
 * irgendetwas halb geschieht.
 */
export function requestUpdate(ctx: AppContext, trainer: Trainer): ReleaseInfo {
  // Nur der Betreiber. Die Routen unter /api/admin sind nicht durch die
  // Schicht davor geschuetzt, sondern durch diese Zeile — so wie ueberall
  // sonst in `services/admin.ts` auch.
  requireAdmin(trainer)
  const info = releaseInfo(ctx)
  if (!info.outdated) throw new GameError('invalid_state', { reason: 'already_current' }, 409)
  writeFileSync(join(ctx.config.DATA_DIR, UPDATE_FLAG), `${info.latest}\n`, 'utf8')
  logEvent(ctx.db, trainer.id, 'update.requested', { from: info.current, to: info.latest })
  return { ...info, pending: true }
}


/* -------------------------------------------------------------------- Chat */

/**
 * Der globale Chat.
 *
 * Wie die Rangliste über einen lokalen Zwischenspeicher: die Ansicht liest nur
 * daraus, geholt wird im Hintergrund. Ein Blick in den Chat darf nie auf eine
 * fremde Leitung warten, und ein stummer Verbund soll die letzten Nachrichten
 * stehen lassen statt eines leeren Fensters.
 */

/** Wie oft höchstens geholt wird, wenn jemand den Chat offen hat. */
export const CHAT_POLL_MS = 8_000

export interface ChatMessage {
  id: number
  trainerId: string
  instanceId: string
  name: string
  body: string
  createdAt: number
}

/** Die höchste Nummer, die wir kennen — der Verbund schickt nur Neueres. */
const lastChatId = (ctx: AppContext): number =>
  (ctx.db.prepare('SELECT MAX(id) AS id FROM chat_cache').get() as { id: number | null }).id ?? 0

/**
 * Neues holen und ablegen.
 *
 * Gibt zurück, wie viele dazukamen. Scheitert der Abruf, bleibt der alte Stand
 * stehen — auch das ist eine Antwort.
 */
export async function refreshChat(ctx: AppContext): Promise<number> {
  if (!enabled(ctx)) return 0
  const res = await call(ctx, 'POST', '/chat/read', { since: lastChatId(ctx) }) as
    { messages?: ChatMessage[] } | null
  if (!res?.messages?.length) return 0

  const einfuegen = ctx.db.prepare(
    `INSERT INTO chat_cache (id, trainer_id, instance_id, name, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  )
  for (const m of res.messages) {
    einfuegen.run(m.id, m.trainerId, m.instanceId, m.name, m.body, m.createdAt)
  }
  // Alt aufräumen: der Verbund hebt auf, die Kopie muss es nicht.
  ctx.db.prepare(
    'DELETE FROM chat_cache WHERE id <= (SELECT MAX(id) - 500 FROM chat_cache)',
  ).run()
  return res.messages.length
}

/**
 * Neues holen, aber nicht öfter als nötig.
 *
 * Der Bildschirm fragt im Sekundentakt nach; der Verbund muss das nicht
 * mitbekommen. Der Zeitpunkt des letzten Abrufs steht in `hub_cache` und
 * übersteht damit einen Neustart.
 */
export async function refreshChatThrottled(ctx: AppContext): Promise<number> {
  if (!enabled(ctx)) return 0
  const row = ctx.db.prepare("SELECT fetched_at AS at FROM hub_cache WHERE key = 'chat_at'")
    .get() as { at: number } | undefined
  if (row && Date.now() - row.at < CHAT_POLL_MS) return 0
  ctx.db.prepare(
    `INSERT INTO hub_cache (key, payload, fetched_at) VALUES ('chat_at', '', ?)
     ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at`,
  ).run(Date.now())
  return refreshChat(ctx)
}

/** Was im Chat steht — ohne Netz. */
export function chatView(ctx: AppContext, trainer: Trainer) {
  if (!enabled(ctx)) return { enabled: false as const, messages: [], me: null }
  const rows = ctx.db.prepare(
    `SELECT id, trainer_id AS trainerId, instance_id AS instanceId, name, body,
            created_at AS createdAt
       FROM chat_cache ORDER BY id DESC LIMIT 80`,
  ).all() as ChatMessage[]
  const me = linkedId(ctx, trainer.id)
  return {
    enabled: true as const,
    // Aufsteigend, damit das Neueste unten steht wie in jedem Chat.
    messages: rows.reverse().map((m) => ({ ...m, isSelf: m.trainerId === me })),
    me,
  }
}

/**
 * Etwas sagen.
 *
 * Die Nachricht geht zum Verbund und kommt beim nächsten Abruf zurück — auch
 * die eigene. Das ist einen Wimpernschlag langsamer als sie sofort lokal
 * einzutragen, aber alle sehen dann dieselbe Reihenfolge, und die Nummer
 * vergibt genau eine Stelle.
 */
export async function sendChat(ctx: AppContext, trainer: Trainer, text: string): Promise<number> {
  if (!enabled(ctx)) throw new GameError('invalid_state', { reason: 'no_hub' }, 409)
  const globalId = linkedId(ctx, trainer.id)
  if (!globalId) throw new GameError('invalid_state', { reason: 'not_linked' }, 409)

  const sauber = text.replace(/\s+/g, ' ').trim()
  if (sauber.length === 0) throw new GameError('validation_failed', { field: 'text' })

  const res = await callOrThrow(ctx, 'POST', '/chat', { trainerId: globalId, text: sauber })
  logEvent(ctx.db, trainer.id, 'chat.sent', { id: res.id })
  await refreshChat(ctx)
  return Number(res.id)
}


/**
 * Trainer-Codes nachreichen.
 *
 * Wer angemeldet wurde, bevor es die Freundes-Funktion gab, hat im Verbund
 * keinen Code — und ohne ihn findet ihn niemand. Der Abgleich schickt ihn
 * einmal nach; `code_pushed` merkt sich, für wen das erledigt ist, damit nicht
 * bei jedem Lauf alle noch einmal geschickt werden.
 */
export async function pushCodes(ctx: AppContext, limit = 50): Promise<number> {
  if (!enabled(ctx)) return 0
  const rows = ctx.db.prepare(
    `SELECT t.telegram_id AS telegramId, t.display_name AS displayName, t.trainer_code AS code,
            l.trainer_id AS trainerId
       FROM hub_links l JOIN trainers t ON t.id = l.trainer_id
      WHERE l.code_pushed = 0 LIMIT ?`,
  ).all(limit) as Array<{ telegramId: string; displayName: string; code: string; trainerId: string }>

  let sent = 0
  for (const row of rows) {
    const res = await call(ctx, 'POST', '/trainers', {
      telegramId: row.telegramId, displayName: row.displayName, code: row.code,
    })
    if (!res) break
    ctx.db.prepare('UPDATE hub_links SET code_pushed = 1 WHERE trainer_id = ?').run(row.trainerId)
    sent++
  }
  return sent
}

/* ---------------------------------------------------------- Globale Freunde */

/**
 * Freunde über Instanzgrenzen.
 *
 * Anders als die lokale Freundschaft liegt diese im Verbund und nicht in
 * `friendships` — dort verweisen beide Spalten auf `trainers(id)`, und ein
 * Trainer auf einer fremden Instanz hat hier keine Zeile. Sie im Verbund zu
 * halten ist deshalb nicht bequemer, sondern das Einzige, was geht.
 *
 * Gesucht wird über den **Trainer-Code**: der ist ohnehin zum Weitergeben
 * gemacht, und eine Instanz kann damit nicht die Liste aller Spieler des
 * Verbunds herunterladen.
 */

export interface GlobalFriend {
  trainerId: string
  displayName: string
  instanceId: string
  code: string
  badges: number
  dexCaught: number
  battlesWon: number
  level: number
}

export interface GlobalFriendsView {
  enabled: boolean
  /** Der eigene Code — zum Weitergeben. */
  myCode: string | null
  friends: GlobalFriend[]
  incoming: GlobalFriend[]
  outgoing: GlobalFriend[]
}

const leer = (): GlobalFriendsView =>
  ({ enabled: false, myCode: null, friends: [], incoming: [], outgoing: [] })

export async function globalFriends(ctx: AppContext, trainer: Trainer): Promise<GlobalFriendsView> {
  if (!enabled(ctx)) return leer()
  const globalId = linkedId(ctx, trainer.id)
  if (!globalId) return { ...leer(), enabled: true, myCode: trainer.trainerCode }

  const res = await call(ctx, 'POST', '/friends', { trainerId: globalId }) as
    { friends?: GlobalFriend[]; incoming?: GlobalFriend[]; outgoing?: GlobalFriend[] } | null
  return {
    enabled: true,
    myCode: trainer.trainerCode,
    friends: res?.friends ?? [],
    incoming: res?.incoming ?? [],
    outgoing: res?.outgoing ?? [],
  }
}

/** Wer nicht angemeldet ist, kann keine Freunde im Verbund haben. */
function requireGlobalId(ctx: AppContext, trainer: Trainer): string {
  if (!enabled(ctx)) throw new GameError('invalid_state', { reason: 'no_hub' }, 409)
  const id = linkedId(ctx, trainer.id)
  if (!id) throw new GameError('invalid_state', { reason: 'not_linked' }, 409)
  return id
}

/** Gibt zurück, ob es gleich eine Freundschaft wurde — das passiert, wenn die
 *  andere Seite schon gefragt hatte. */
export async function requestGlobalFriend(
  ctx: AppContext, trainer: Trainer, code: string,
): Promise<boolean> {
  const globalId = requireGlobalId(ctx, trainer)
  const sauber = code.trim().toUpperCase()
  if (sauber === trainer.trainerCode) throw new GameError('validation_failed', { reason: 'self' })

  const res = await callOrThrow(ctx, 'POST', '/friends/request', { trainerId: globalId, code: sauber })
  logEvent(ctx.db, trainer.id, 'hub.friendRequested', { code: sauber })
  return Boolean((res as { accepted?: boolean }).accepted)
}

export async function respondGlobalFriend(
  ctx: AppContext, trainer: Trainer, otherId: string, accept: boolean,
): Promise<void> {
  const globalId = requireGlobalId(ctx, trainer)
  await callOrThrow(ctx, 'POST', '/friends/respond', { trainerId: globalId, otherId, accept })
  logEvent(ctx.db, trainer.id, 'hub.friendResponded', { otherId, accept })
}

export async function removeGlobalFriend(
  ctx: AppContext, trainer: Trainer, otherId: string,
): Promise<void> {
  const globalId = requireGlobalId(ctx, trainer)
  await callOrThrow(ctx, 'POST', '/friends/remove', { trainerId: globalId, otherId })
  logEvent(ctx.db, trainer.id, 'hub.friendRemoved', { otherId })
}

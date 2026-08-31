import type { InstanceRow, ChatRow, ProfileRow, ReleaseRow, Store, TrainerRow } from './store.js'

/**
 * Der Speicher auf Cloudflare D1.
 *
 * Nur Abfragen — die gesamte Logik liegt in `service.ts` und wird ohne
 * Cloudflare getestet. Was hier schiefgehen kann, ist ein Tippfehler in einem
 * Spaltennamen, und den findet das Schema beim ersten Aufruf.
 */

/** Die Teilmenge von D1, die wir benutzen. Als eigene Schnittstelle, damit
 *  dieses Paket keine Cloudflare-Typen braucht. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>
      all<T>(): Promise<{ results: T[] }>
      run(): Promise<unknown>
    }
  }
}

/**
 * Die Punktzahl, nach der global sortiert wird.
 *
 * Bewusst dieselbe Gewichtung wie lokal: Orden zählen am schwersten, weil sie
 * am wenigsten nebenbei passieren, dann der Dex, dann die Kämpfe. Wer die
 * Formel ändert, ändert sie an beiden Stellen — sonst steht derselbe Spieler
 * in zwei Listen an verschiedenen Plätzen und keiner weiß, welche stimmt.
 */
export const SCORE_SQL = '(p.badges * 1000 + p.dex_caught * 10 + p.battles_won)'

export function d1Store(db: D1Like): Store {
  return {
    async trainerByCode(code) {
      return db.prepare(
        `SELECT id, instance_id AS instanceId, display_name AS displayName, code,
                created_at AS createdAt, updated_at AS updatedAt
           FROM trainers WHERE code = ? AND code != ''`,
      ).bind(code).first<TrainerRow>()
    },

    async addFriend(row) {
      await db.prepare(
        `INSERT INTO friends (low_id, high_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      ).bind(row.lowId, row.highId, row.createdAt).run()
    },

    async removeFriend(a, b) {
      const [low, high] = [a, b].sort()
      await db.prepare('DELETE FROM friends WHERE low_id = ? AND high_id = ?').bind(low, high).run()
    },

    async friendsOf(trainerId) {
      const res = await db.prepare(
        `SELECT CASE WHEN low_id = ? THEN high_id ELSE low_id END AS other
           FROM friends WHERE low_id = ? OR high_id = ?`,
      ).bind(trainerId, trainerId, trainerId).all<{ other: string }>()
      return res.results.map((r) => r.other)
    },

    async addFriendRequest(row) {
      await db.prepare(
        `INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      ).bind(row.fromId, row.toId, row.createdAt).run()
    },

    async removeFriendRequest(fromId, toId) {
      await db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?')
        .bind(fromId, toId).run()
    },

    async requestsFor(trainerId) {
      const ein = await db.prepare('SELECT from_id AS id FROM friend_requests WHERE to_id = ?')
        .bind(trainerId).all<{ id: string }>()
      const aus = await db.prepare('SELECT to_id AS id FROM friend_requests WHERE from_id = ?')
        .bind(trainerId).all<{ id: string }>()
      return { incoming: ein.results.map((r) => r.id), outgoing: aus.results.map((r) => r.id) }
    },

    async profilesOf(ids) {
      if (ids.length === 0) return []
      /*
       * Platzhalter statt eingesetzter Werte — die Ids kommen zwar aus der
       * eigenen Datenbank, aber eine Abfrage, die Zeichenketten zusammenklebt,
       * ist eine, die beim naechsten Mal jemand anders fuellt.
       */
      const marks = ids.map(() => '?').join(',')
      const res = await db.prepare(
        `SELECT t.id AS trainerId, t.display_name AS displayName, t.instance_id AS instanceId, t.code,
                COALESCE(p.badges,0) AS badges, COALESCE(p.dex_caught,0) AS dexCaught,
                COALESCE(p.battles_won,0) AS battlesWon, COALESCE(p.rating,0) AS rating,
                COALESCE(p.level,0) AS level, COALESCE(p.updated_at,0) AS updatedAt
           FROM trainers t LEFT JOIN profiles p ON p.trainer_id = t.id
          WHERE t.id IN (${marks})`,
      ).bind(...ids).all<ProfileRow & { displayName: string; instanceId: string; code: string }>()
      return res.results
    },

    async addChat(row) {
      await db.prepare(
        'INSERT INTO chat (trainer_id, instance_id, name, body, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(row.trainerId, row.instanceId, row.name, row.body, row.createdAt).run()
      const last = await db.prepare('SELECT MAX(id) AS id FROM chat').bind().first<{ id: number }>()
      return last?.id ?? 0
    },

    async chatSince(since, limit) {
      /*
       * Die neuesten `limit`, dann wieder aufsteigend.
       *
       * `ORDER BY id DESC LIMIT n` holt das Ende der Liste; ohne das zweite
       * Sortieren kaeme der Chat verkehrt herum an, sobald jemand mit
       * `since = 0` einsteigt.
       */
      const res = await db.prepare(
        `SELECT id, trainer_id AS trainerId, instance_id AS instanceId, name, body,
                created_at AS createdAt
           FROM (SELECT * FROM chat WHERE id > ? ORDER BY id DESC LIMIT ?)
          ORDER BY id ASC`,
      ).bind(since, limit).all<ChatRow>()
      return res.results
    },

    async chatCountSince(instanceId, after) {
      const row = await db.prepare(
        'SELECT COUNT(*) AS n FROM chat WHERE instance_id = ? AND created_at >= ?',
      ).bind(instanceId, after).first<{ n: number }>()
      return row?.n ?? 0
    },

    async getRelease() {
      return db.prepare(
        'SELECT sha, notes, published_at AS publishedAt FROM releases WHERE id = 1',
      ).bind().first<ReleaseRow>()
    },

    async putRelease(row) {
      // Genau eine Zeile: es gibt einen aktuellen Stand, nicht viele.
      await db.prepare(
        `INSERT INTO releases (id, sha, notes, published_at) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sha = excluded.sha, notes = excluded.notes, published_at = excluded.published_at`,
      ).bind(row.sha, row.notes, row.publishedAt).run()
    },

    async getInstance(id) {
      return db.prepare(
        `SELECT id, name, secret, created_at AS createdAt, trust, blocked_at AS blockedAt
           FROM instances WHERE id = ?`,
      ).bind(id).first<InstanceRow>()
    },

    async putInstance(row) {
      await db.prepare(
        `INSERT INTO instances (id, name, secret, created_at, trust, blocked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, trust = excluded.trust, blocked_at = excluded.blocked_at`,
      ).bind(row.id, row.name, row.secret, row.createdAt, row.trust, row.blockedAt).run()
    },

    async getTrainer(id) {
      return db.prepare(
        `SELECT id, instance_id AS instanceId, display_name AS displayName, code,
                created_at AS createdAt, updated_at AS updatedAt
           FROM trainers WHERE id = ?`,
      ).bind(id).first<TrainerRow>()
    },

    async putTrainer(row) {
      await db.prepare(
        `INSERT INTO trainers (id, instance_id, display_name, code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           instance_id = excluded.instance_id,
           display_name = excluded.display_name,
           code = excluded.code,
           updated_at = excluded.updated_at`,
      ).bind(row.id, row.instanceId, row.displayName, row.code, row.createdAt, row.updatedAt).run()
    },

    async countTrainers(instanceId) {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM trainers WHERE instance_id = ?')
        .bind(instanceId).first<{ n: number }>()
      return row?.n ?? 0
    },

    async putProfile(row) {
      await db.prepare(
        `INSERT INTO profiles (trainer_id, badges, dex_caught, battles_won, rating, level, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(trainer_id) DO UPDATE SET
           badges = excluded.badges, dex_caught = excluded.dex_caught,
           battles_won = excluded.battles_won, rating = excluded.rating,
           level = excluded.level, updated_at = excluded.updated_at`,
      ).bind(row.trainerId, row.badges, row.dexCaught, row.battlesWon, row.rating, row.level, row.updatedAt)
        .run()
    },

    async topProfiles(limit) {
      const res = await db.prepare(
        `SELECT p.trainer_id AS trainerId, t.display_name AS displayName, t.instance_id AS instanceId,
                p.badges, p.dex_caught AS dexCaught, p.battles_won AS battlesWon,
                p.rating, p.level, p.updated_at AS updatedAt
           FROM profiles p
           JOIN trainers t ON t.id = p.trainer_id
           JOIN instances i ON i.id = t.instance_id
          WHERE i.blocked_at IS NULL
          ORDER BY ${SCORE_SQL} DESC, t.created_at ASC
          LIMIT ?`,
      ).bind(limit).all<ProfileRow & { displayName: string; instanceId: string }>()
      return res.results
    },

    async rankOf(trainerId) {
      const me = await db.prepare(
        `SELECT ${SCORE_SQL} AS score FROM profiles p WHERE p.trainer_id = ?`,
      ).bind(trainerId).first<{ score: number }>()
      if (!me) return null
      const row = await db.prepare(
        `SELECT COUNT(*) + 1 AS rank FROM profiles p WHERE ${SCORE_SQL} > ?`,
      ).bind(me.score).first<{ rank: number }>()
      return row?.rank ?? null
    },
  }
}

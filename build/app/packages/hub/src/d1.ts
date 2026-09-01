import type {
  OrderRow, InstanceRow, ChatRow, MarketRow, ProfileRow, ReleaseRow, Store, TrainerRow } from './store.js'

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
      /** D1 meldet die Zahl der getroffenen Zeilen. Ein bedingtes UPDATE
       *  braucht sie: sie ist die Antwort auf "war er noch in dem Zustand?". */
      run(): Promise<{ meta?: { changes?: number } }>
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

    async replaceMarket(instanceId, rows) {
      /*
       * Erst leeren, dann schreiben.
       *
       * D1 kennt keine Transaktion ueber mehrere Anweisungen, also kann
       * zwischen beiden Schritten ein Leser einen leeren Aushang dieser
       * Instanz sehen. Das ist der harmlose Ausgang: ein Angebot kurz nicht zu
       * zeigen ist besser, als eines zu zeigen, das es nicht mehr gibt.
       */
      await db.prepare('DELETE FROM market WHERE instance_id = ?').bind(instanceId).run()
      for (const r of rows) {
        await db.prepare(
          `INSERT INTO market (id, instance_id, trainer_id, seller_name, price, note,
                               species_name, level, shiny, iv_percent, sprite, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(r.id, instanceId, r.trainerId, r.sellerName, r.price, r.note,
               r.speciesName, r.level, r.shiny ? 1 : 0, r.ivPercent, r.sprite, r.createdAt).run()
      }
    },
    async openMarket(limit) {
      const res = await db.prepare(
        `SELECT id, instance_id AS instanceId, trainer_id AS trainerId, seller_name AS sellerName,
                price, note, species_name AS speciesName, level, shiny, iv_percent AS ivPercent,
                sprite, created_at AS createdAt
           FROM market ORDER BY created_at DESC LIMIT ?`,
        // SQLite kennt kein Wahrheitswert-Feld: `shiny` kommt als 0 oder 1
        // zurueck und wird hier wieder zu dem, was die Schnittstelle verspricht.
      ).bind(limit).all<Omit<MarketRow, 'shiny'> & { shiny: number }>()
      return res.results.map((r) => ({ ...r, shiny: r.shiny === 1 }))
    },
    async createOrder(row) {
      /*
       * Erst schauen, dann schreiben.
       *
       * D1 kennt keine Transaktion ueber mehrere Anweisungen, also ist das
       * Fenster zwischen Pruefung und Einfuegung theoretisch offen. Es bleibt
       * folgenlos: der Vorgang traegt eine eigene Kennung, und die zweite
       * Bestellung faende beim naechsten Abgleich eine bereits belegte
       * Zustellung vor und braeche mit `aborted` ab — das Gold kommt zurueck.
       */
      const offen = await db.prepare(
        `SELECT id FROM market_orders WHERE listing_id = ? AND status IN ('reserved','delivered')`,
      ).bind(row.listingId).first()
      if (offen) return null
      await db.prepare(
        `INSERT INTO market_orders (id, listing_id, seller_instance_id, seller_trainer_id,
                                    buyer_instance_id, buyer_trainer_id, price, status,
                                    creature, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id, row.listingId, row.sellerInstanceId, row.sellerTrainerId,
        row.buyerInstanceId, row.buyerTrainerId, row.price, row.status,
        row.creature, row.reason, row.createdAt, row.updatedAt,
      ).run()
      return row
    },
    async ordersFor(instanceId) {
      const res = await db.prepare(
        `SELECT * FROM market_orders WHERE seller_instance_id = ? OR buyer_instance_id = ?
          ORDER BY created_at ASC`,
      ).bind(instanceId, instanceId).all<Record<string, unknown>>()
      return (res.results ?? []).map(orderAus)
    },
    async getOrder(id) {
      const row = await db.prepare('SELECT * FROM market_orders WHERE id = ?')
        .bind(id).first<Record<string, unknown>>()
      return row ? orderAus(row) : null
    },
    async advanceOrder(id, von, nach, felder, now) {
      // Die Bedingung auf den alten Zustand ist die ganze Sicherung: eine
      // zweite Zustellung derselben Nachricht trifft ihn nicht mehr an.
      const res = await db.prepare(
        `UPDATE market_orders
            SET status = ?, updated_at = ?,
                creature = COALESCE(?, creature),
                reason = COALESCE(?, reason)
          WHERE id = ? AND status = ?`,
      ).bind(nach, now, felder.creature ?? null, felder.reason ?? null, id, von).run()
      return (res.meta?.changes ?? 0) > 0
    },
    async staleOrders(status, older) {
      const res = await db.prepare(
        'SELECT * FROM market_orders WHERE status = ? AND updated_at < ?',
      ).bind(status, older).all<Record<string, unknown>>()
      return (res.results ?? []).map(orderAus)
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

/** Eine Zeile aus `market_orders` in die Form, die der Dienst kennt. */
function orderAus(r: Record<string, unknown>): OrderRow {
  return {
    id: String(r.id),
    listingId: String(r.listing_id),
    sellerInstanceId: String(r.seller_instance_id),
    sellerTrainerId: String(r.seller_trainer_id),
    buyerInstanceId: String(r.buyer_instance_id),
    buyerTrainerId: String(r.buyer_trainer_id),
    price: Number(r.price),
    status: String(r.status) as OrderRow['status'],
    creature: r.creature === null || r.creature === undefined ? null : String(r.creature),
    reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}

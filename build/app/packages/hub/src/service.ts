import { globalTrainerId, verify, type SignedRequest } from './auth.js'
import type { ProfileRow, Store } from './store.js'

/**
 * Der Verbund-Dienst.
 *
 * Kein Fastify, kein Worker, kein Netz — nur eine Funktion, die eine Anfrage
 * entgegennimmt und eine Antwort zurückgibt. Der Worker ist danach zwanzig
 * Zeilen, die HTTP hierhin übersetzen, und der Test kommt ganz ohne aus.
 *
 * Was hier liegt, ist bewusst wenig: Identitäten und Profil-Schnappschüsse.
 * Beides lässt sich nur anhängen oder überschreiben, nie zusammenführen —
 * genau deshalb kann es keine Konflikte geben. Warum das so geschnitten ist,
 * steht in `docs/VERBUND.md`.
 */

export interface HubConfig {
  store: Store
  /** Salz für die globale Trainer-Id. Ändert sich nie, sonst wechseln alle Ids. */
  idSalt: string
  /** Wer neue Instanzen anmelden darf. */
  adminSecret: string
  now?: () => number
}

export interface HubRequest {
  method: string
  path: string
  body: unknown
  /**
   * Der Rumpf, wie er ankam.
   *
   * Signiert wird der Text, nicht das Objekt. Ohne das haenge die Pruefung
   * daran, dass `JSON.stringify` beim Empfaenger dieselbe Zeichenkette
   * erzeugt wie beim Absender — dieselbe Reihenfolge der Schluessel, dieselbe
   * Zahlendarstellung. Das gilt heute und muss morgen nicht gelten.
   */
  rawBody?: string
  auth?: SignedRequest
  /** Nur für die Anmeldung neuer Instanzen. */
  adminSecret?: string
}

export interface HubResponse {
  status: number
  body: unknown
}

const bad = (status: number, error: string, detail: unknown = {}): HubResponse =>
  ({ status, body: { error, detail } })

/** Wie viele Trainer eine Instanz je Tag anlegen darf. Eine Instanz, die
 *  Hunderte erfindet, faellt damit auf, bevor sie handeln kann. */
export const TRAINERS_PER_INSTANCE = 500

/** Wie lang eine Nachricht sein darf. Laenger wird abgeschnitten, nicht abgelehnt. */
export const CHAT_MAX_LENGTH = 400
/** Wie viele Nachrichten eine Instanz je Fenster schicken darf. */
export const CHAT_PER_INSTANCE_PER_WINDOW = 60
export const CHAT_WINDOW_MS = 60_000
/** Wie viele auf einmal ausgeliefert werden. */
export const CHAT_PAGE = 50

export function createHub(config: HubConfig) {
  const now = config.now ?? (() => Date.now())
  const { store } = config

  return async function handle(req: HubRequest): Promise<HubResponse> {
    const body = req.body ?? {}
    const raw = req.rawBody ?? JSON.stringify(body)

    /* ------------------------------------------------ Instanz anmelden */
    if (req.method === 'POST' && req.path === '/instances') {
      if (req.adminSecret !== config.adminSecret) return bad(401, 'unauthorized')
      const { id, name } = body as { id?: string; name?: string }
      if (!id || !/^[a-z0-9-]{3,32}$/.test(id)) return bad(400, 'validation_failed', { field: 'id' })
      if (await store.getInstance(id)) return bad(409, 'invalid_state', { reason: 'already_registered' })

      // Das Geheimnis verlaesst den Dienst genau hier, ein einziges Mal.
      const secret = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((b) => b.toString(16).padStart(2, '0')).join('')
      await store.putInstance({
        id, name: (name ?? id).slice(0, 40), secret, createdAt: now(),
        // Neue duerfen zuerst nur lesen; Handel wird freigeschaltet, nicht
        // mitgeliefert. Siehe VERBUND.md, "Vertrauensstufen".
        trust: 'read', blockedAt: null,
      })
      return { status: 200, body: { id, secret } }
    }

    /* -------------------------------------------- Version setzen (Admin) */
    if (req.method === 'PUT' && req.path === '/release') {
      if (req.adminSecret !== config.adminSecret) return bad(401, 'unauthorized')
      const { sha, notes } = body as { sha?: string; notes?: string }
      if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return bad(400, 'validation_failed', { field: 'sha' })
      const release = { sha, notes: (notes ?? '').slice(0, 200), publishedAt: now() }
      await store.putRelease(release)
      return { status: 200, body: { release } }
    }

    /* ------------------------------------------------------ ab hier signiert */
    if (!req.auth) return bad(401, 'unauthorized')
    const instance = await store.getInstance(req.auth.instanceId)
    if (!instance) return bad(401, 'unauthorized', { reason: 'unknown_instance' })
    if (instance.blockedAt !== null) return bad(403, 'banned')

    const check = await verify(instance.secret, req.auth, req.method, req.path, raw, now())
    if (!check.ok) return bad(401, 'unauthorized', { reason: check.reason })

    /* ------------------------------------------------------ Trainer melden */
    if (req.method === 'POST' && req.path === '/trainers') {
      const { telegramId, displayName, code } = body as
        { telegramId?: string; displayName?: string; code?: string }
      if (!telegramId) return bad(400, 'validation_failed', { field: 'telegramId' })

      const id = await globalTrainerId(String(telegramId), config.idSalt)
      const existing = await store.getTrainer(id)
      if (!existing && (await store.countTrainers(instance.id)) >= TRAINERS_PER_INSTANCE) {
        return bad(429, 'rate_limited', { reason: 'too_many_trainers' })
      }
      await store.putTrainer({
        id,
        // Wechselt ein Spieler die Instanz, folgt ihm seine Id — die Heimat
        // ist die zuletzt gesehene, nicht die erste.
        instanceId: instance.id,
        /*
         * Ein Name, der nicht mitkommt, ist kein leerer Name.
         *
         * Stand hier `displayName ?? '—'`, machte jede Anfrage ohne Namen aus
         * einem bekannten Trainer einen namenlosen. Der Client schickt heute
         * immer einen mit — aber „heute schickt niemand das" ist keine
         * Zusicherung, und die Rangliste voller Striche faellt erst auf,
         * wenn sie schon so aussieht.
         */
        displayName: (displayName ?? existing?.displayName ?? '—').slice(0, 32),
        // Wie der Name: was nicht mitkommt, loescht nichts.
        code: (code ?? existing?.code ?? '').slice(0, 16).toUpperCase(),
        createdAt: existing?.createdAt ?? now(),
        updatedAt: now(),
      })
      return { status: 200, body: { id } }
    }

    /* ----------------------------------------------------- Profil schieben */
    if (req.method === 'PUT' && req.path === '/profiles') {
      const p = body as Partial<ProfileRow> & { trainerId?: string }
      if (!p.trainerId) return bad(400, 'validation_failed', { field: 'trainerId' })
      const trainer = await store.getTrainer(p.trainerId)
      if (!trainer) return bad(404, 'not_found')
      // Nur die eigene Herde: eine Instanz schreibt keine fremden Profile.
      if (trainer.instanceId !== instance.id) return bad(403, 'not_owner')

      const num = (v: unknown, max: number) =>
        Math.max(0, Math.min(max, Math.floor(typeof v === 'number' && Number.isFinite(v) ? v : 0)))
      await store.putProfile({
        trainerId: p.trainerId,
        // Obergrenzen aus dem Spiel: was darueber liegt, kann es nicht geben.
        badges: num(p.badges, 26),
        dexCaught: num(p.dexCaught, 1000),
        battlesWon: num(p.battlesWon, 1_000_000),
        rating: num(p.rating, 5000),
        level: num(p.level, 500),
        updatedAt: now(),
      })
      return { status: 200, body: { ok: true } }
    }

    /* ---------------------------------------------------------- Version */
    /*
     * Welcher Stand aktuell ist.
     *
     * Lesen darf jede angemeldete Instanz, setzen nur der Admin. Der Verbund
     * *sagt* damit lediglich, was aktuell ist — er stoesst nichts an. Was auf
     * einer fremden Maschine passiert, entscheidet deren Besitzer.
     */
    if (req.method === 'GET' && req.path === '/release') {
      const release = await store.getRelease()
      return { status: 200, body: { release } }
    }

    /* ------------------------------------------------------------ Freunde */
    /*
     * Jemanden über seinen Trainer-Code finden.
     *
     * Der Code ist ohnehin dafür gemacht, weitergegeben zu werden — anders als
     * die Telegram-Id, die deshalb gar nicht erst im Verbund liegt. Gesucht
     * wird einzeln: eine Instanz soll nicht die Liste aller Spieler des
     * Verbunds herunterladen können.
     */
    if (req.method === 'POST' && req.path === '/trainers/find') {
      const { code } = body as { code?: string }
      if (!code || !/^[A-Z0-9-]{4,16}$/i.test(code)) return bad(400, 'validation_failed', { field: 'code' })
      const gefunden = await store.trainerByCode(code.toUpperCase())
      if (!gefunden) return { status: 200, body: { trainer: null } }
      const [profil] = await store.profilesOf([gefunden.id])
      return { status: 200, body: { trainer: profil ?? null } }
    }

    if (req.method === 'POST' && req.path === '/friends') {
      const { trainerId } = body as { trainerId?: string }
      if (!trainerId) return bad(400, 'validation_failed', { field: 'trainerId' })
      const wer = await store.getTrainer(trainerId)
      if (!wer) return bad(404, 'not_found')
      // Nur die eigene Herde: eine Instanz liest keine fremden Freundeslisten.
      if (wer.instanceId !== instance.id) return bad(403, 'not_owner')

      const ids = await store.friendsOf(trainerId)
      const { incoming, outgoing } = await store.requestsFor(trainerId)
      return {
        status: 200,
        body: {
          friends: await store.profilesOf(ids),
          incoming: await store.profilesOf(incoming),
          outgoing: await store.profilesOf(outgoing),
        },
      }
    }

    if (req.method === 'POST' && req.path === '/friends/request') {
      const { trainerId, code } = body as { trainerId?: string; code?: string }
      if (!trainerId || !code) return bad(400, 'validation_failed')
      const wer = await store.getTrainer(trainerId)
      if (!wer) return bad(404, 'not_found')
      if (wer.instanceId !== instance.id) return bad(403, 'not_owner')

      const ziel = await store.trainerByCode(code.toUpperCase())
      if (!ziel) return bad(404, 'not_found', { reason: 'unknown_code' })
      if (ziel.id === trainerId) return bad(400, 'validation_failed', { reason: 'self' })

      const schon = await store.friendsOf(trainerId)
      if (schon.includes(ziel.id)) return bad(409, 'invalid_state', { reason: 'already_friends' })

      /*
       * Hat die andere Seite schon gefragt, ist das hier die Zusage.
       *
       * Ohne das müsste man erst eine Anfrage schicken, die drüben neben der
       * eigenen liegt, und dann warten — zwei Leute, die gleichzeitig auf
       * denselben Knopf drücken, wären sonst nie befreundet.
       */
      const offen = await store.requestsFor(trainerId)
      if (offen.incoming.includes(ziel.id)) {
        const [low, high] = [trainerId, ziel.id].sort()
        await store.addFriend({ lowId: low!, highId: high!, createdAt: now() })
        await store.removeFriendRequest(ziel.id, trainerId)
        return { status: 200, body: { accepted: true } }
      }

      await store.addFriendRequest({ fromId: trainerId, toId: ziel.id, createdAt: now() })
      return { status: 200, body: { accepted: false } }
    }

    if (req.method === 'POST' && req.path === '/friends/respond') {
      const { trainerId, otherId, accept } = body as
        { trainerId?: string; otherId?: string; accept?: boolean }
      if (!trainerId || !otherId) return bad(400, 'validation_failed')
      const wer = await store.getTrainer(trainerId)
      if (!wer) return bad(404, 'not_found')
      if (wer.instanceId !== instance.id) return bad(403, 'not_owner')

      await store.removeFriendRequest(otherId, trainerId)
      if (accept) {
        const [low, high] = [trainerId, otherId].sort()
        await store.addFriend({ lowId: low!, highId: high!, createdAt: now() })
      }
      return { status: 200, body: { ok: true } }
    }

    if (req.method === 'POST' && req.path === '/friends/remove') {
      const { trainerId, otherId } = body as { trainerId?: string; otherId?: string }
      if (!trainerId || !otherId) return bad(400, 'validation_failed')
      const wer = await store.getTrainer(trainerId)
      if (!wer) return bad(404, 'not_found')
      if (wer.instanceId !== instance.id) return bad(403, 'not_owner')
      await store.removeFriend(trainerId, otherId)
      await store.removeFriendRequest(trainerId, otherId)
      await store.removeFriendRequest(otherId, trainerId)
      return { status: 200, body: { ok: true } }
    }

    /* --------------------------------------------------------------- Chat */
    /*
     * Ein Raum für den ganzen Verbund.
     *
     * Geschrieben wird nur im Namen eigener Trainer — dieselbe Regel wie bei
     * den Profilen, und aus demselben Grund: sonst könnte eine Instanz im
     * Namen fremder Spieler reden.
     */
    if (req.method === 'POST' && req.path === '/chat') {
      const { trainerId, text } = body as { trainerId?: string; text?: string }
      if (!trainerId || typeof text !== 'string') return bad(400, 'validation_failed')
      const sauber = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH)
      if (sauber.length === 0) return bad(400, 'validation_failed', { field: 'text' })

      const trainer = await store.getTrainer(trainerId)
      if (!trainer) return bad(404, 'not_found')
      if (trainer.instanceId !== instance.id) return bad(403, 'not_owner')

      // Eine Instanz, die flutet, faellt hier auf, bevor der Raum unlesbar ist.
      const zuletzt = await store.chatCountSince(instance.id, now() - CHAT_WINDOW_MS)
      if (zuletzt >= CHAT_PER_INSTANCE_PER_WINDOW) {
        return bad(429, 'rate_limited', { reason: 'too_chatty' })
      }

      const id = await store.addChat({
        trainerId, instanceId: instance.id, name: trainer.displayName,
        body: sauber, createdAt: now(),
      })
      return { status: 200, body: { id } }
    }

    /*
     * Lesen ist ein POST, und das ist Absicht.
     *
     * Signiert wird der Rumpf. Ein GET darf laut `fetch` keinen tragen — also
     * muesste `since` in die Adresse, und die steckt nicht in der Signatur.
     * Genau daran ist der erste Versuch gescheitert: der Client signierte
     * `{"since":N}` und schickte nichts, die Gegenseite rechnete mit `{}`.
     */
    if (req.method === 'POST' && req.path === '/chat/read') {
      const { since } = body as { since?: number }
      const von = typeof since === 'number' && Number.isFinite(since) ? Math.max(0, Math.floor(since)) : 0
      return { status: 200, body: { messages: await store.chatSince(von, CHAT_PAGE) } }
    }

    /* -------------------------------------------------------- Rangliste */
    if (req.method === 'GET' && req.path === '/leaderboard') {
      const rows = await store.topProfiles(50)
      return { status: 200, body: { rows } }
    }

    return bad(404, 'not_found')
  }
}

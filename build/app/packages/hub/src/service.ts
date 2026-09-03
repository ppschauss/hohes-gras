import { globalTrainerId, verify, type SignedRequest } from './auth.js'
import type { MarketRow, ProfileRow, Store } from './store.js'

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
  /**
   * Wer sich selbst anmelden darf.
   *
   * Getrennt vom Admin-Geheimnis, und das ist der ganze Punkt: das Admin-
   * Geheimnis oeffnet zwei Tueren, denn mit ihm setzt man auch den Stand, auf
   * den sich alle Instanzen aktualisieren sollen. Wer nur beitreten will, soll
   * nicht nebenbei alle anderen zum Update draengen koennen.
   *
   * Leer heisst: keine Selbstanmeldung. Dann bleibt es beim Admin-Weg.
   */
  joinSecret?: string
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
  /** Nur fuer die Selbstanmeldung. */
  joinSecret?: string
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

/**
 * Wie gross ein verwahrtes Pokemon sein darf.
 *
 * Grosszuegig gegenueber allem, was die Engine erzeugt, und eng genug, dass
 * niemand den Verbund als Ablage benutzt. Er verwahrt Pokemon, nicht Dateien.
 */
export const CREATURE_MAX = 8_000

/**
 * Wie lange eine Bestellung liegenbleiben darf, bevor sie verfaellt.
 *
 * Bezahlt ist bezahlt, und Gold, das unbegrenzt in einem Vorgang liegt, den
 * niemand mehr anfasst, ist verloren. Eine Instanz, die zwei Stunden nicht
 * geliefert hat, ist entweder aus oder kaputt — in beiden Faellen soll der
 * Kaeufer sein Gold wiedersehen.
 */
export const ORDER_TIMEOUT_MS = 2 * 60 * 60_000
/** Wie viele auf einmal ausgeliefert werden. */
export const CHAT_PAGE = 50

/**
 * Wie viele Angebote eine Instanz aushaengen darf.
 *
 * Der lokale Marktplatz zeigt fuenfzig; mehr als das kann eine Instanz auch
 * im Verbund nicht sinnvoll beitragen. Die Grenze steht hier und nicht nur
 * beim Absender: was eine fremde Instanz schickt, ist eine Behauptung.
 */
const MARKET_PER_INSTANCE = 60
const MARKET_PAGE = 60
const NOTE_MAX = 120

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

    /*
     * Selbstanmeldung.
     *
     * Dieselbe Wirkung wie oben, ein anderer Schluessel — und ausdruecklich
     * einer, den man weitergeben kann. Wer eine Instanz aufsetzt, traegt das
     * Beitrittsgeheimnis in seine Konfiguration ein; beim ersten Lauf holt
     * sich die Instanz ihre Kennung selbst. Niemand muss mehr ein Geheimnis
     * durch einen Chat schicken.
     *
     * Sie beginnt auf `read`. Das ist die Bedingung, unter der das ueberhaupt
     * vertretbar ist: sehen und sich zeigen darf jeder, der das Beitritts-
     * geheimnis hat; handeln erst, wenn der Betreiber es freischaltet.
     */
    if (req.method === 'POST' && req.path === '/instances/join') {
      if (!config.joinSecret) return bad(404, 'not_found')
      if (req.joinSecret !== config.joinSecret) return bad(401, 'unauthorized')
      const { id, name } = body as { id?: string; name?: string }
      if (!id || !/^[a-z0-9-]{3,32}$/.test(id)) return bad(400, 'validation_failed', { field: 'id' })
      /*
       * Eine vergebene Kennung wird nicht ueberschrieben.
       *
       * Sonst koennte jeder mit dem Beitrittsgeheimnis eine fremde Instanz
       * uebernehmen, indem er ihre Kennung neu anmeldet — und deren Trainer
       * gleich mit. Der Anfragende bekommt einen klaren Fehler und muss sich
       * einen anderen Namen suchen oder den Betreiber fragen.
       */
      if (await store.getInstance(id)) return bad(409, 'invalid_state', { reason: 'id_taken' })

      const secret = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((b) => b.toString(16).padStart(2, '0')).join('')
      await store.putInstance({
        id, name: (name ?? id).slice(0, 40), secret, createdAt: now(),
        trust: 'read', blockedAt: null,
      })
      return { status: 200, body: { id, secret, trust: 'read' } }
    }

    /* Freischalten — nur der Betreiber, und nur mit dem Admin-Geheimnis. */
    if (req.method === 'POST' && req.path === '/instances/trust') {
      if (req.adminSecret !== config.adminSecret) return bad(401, 'unauthorized')
      const { id, trust } = body as { id?: string; trust?: string }
      if (!id) return bad(400, 'validation_failed', { field: 'id' })
      if (trust !== 'read' && trust !== 'trade') return bad(400, 'validation_failed', { field: 'trust' })
      const inst = await store.getInstance(id)
      if (!inst) return bad(404, 'not_found', { id })
      await store.putInstance({ ...inst, trust })
      return { status: 200, body: { id, trust } }
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

    /*
     * Was eine Instanz auf der Lesestufe nicht darf.
     *
     * Bis hierher war `trust` ein Feld, das gesetzt und nie gelesen wurde —
     * die Doku versprach eine Sicherung, die es nicht gab. Solange man eine
     * Instanz nur von Hand anlegen konnte, war der Befehl selbst die
     * Schranke. Mit der Selbstanmeldung faellt die weg, also muss die
     * Sicherung echt werden.
     *
     * Die Grenze verlaeuft dort, wo Werte den Besitzer wechseln. Sehen,
     * gesehen werden und reden ist harmlos: eine neue Instanz soll sich beim
     * ersten Start vollstaendig anfuehlen. Anbieten und handeln bewegt
     * dagegen Pokemon und Gold zwischen Datenbanken, denen der Betreiber
     * vertrauen muss — und ob er das tut, entscheidet er selbst.
     */
    const HANDEL = new Set([
      '/market/buy', '/market/orders', '/market/deliver', '/market/collect', '/market/abort',
    ])
    const bietet = req.method === 'PUT' && req.path === '/market'
    if (instance.trust !== 'trade' && (bietet || HANDEL.has(req.path))) {
      return bad(403, 'forbidden', { reason: 'trust_read_only', trust: instance.trust })
    }

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
    /* ------------------------------------------------------------- Markt */
    /*
     * Der Aushang: fremde Angebote sehen, noch nicht kaufen.
     *
     * Was hier liegt, ist eine Abschrift — die Kreatur bleibt auf ihrer
     * Heimatinstanz. Deshalb ist dieser Schritt harmlos: es wandert nichts
     * herueber, was jemand faelschen koennte, und ein erfundenes Angebot
     * kostet hoechstens einen enttaeuschten Blick. Der Kauf kommt getrennt,
     * mit Treuhand, und erst dann wird es ernst.
     *
     * Eine Instanz schickt ihren ganzen Aushang auf einmal; verkaufte und
     * zurueckgezogene Angebote verschwinden dadurch von selbst.
     */
    if (req.method === 'PUT' && req.path === '/market') {
      const { listings } = body as { listings?: unknown }
      if (!Array.isArray(listings)) return bad(400, 'validation_failed', { field: 'listings' })

      const text = (v: unknown, max: number) =>
        (typeof v === 'string' ? v : '').slice(0, max)
      const num = (v: unknown, max: number) =>
        Math.max(0, Math.min(max, Math.floor(typeof v === 'number' && Number.isFinite(v) ? v : 0)))

      const rows: MarketRow[] = []
      for (const roh of listings.slice(0, MARKET_PER_INSTANCE)) {
        const l = roh as Record<string, unknown>
        const id = text(l.id, 64)
        const trainerId = text(l.trainerId, 64)
        // Ohne Kennung laesst sich ein Angebot spaeter niemandem zuordnen.
        if (!id || !trainerId) continue
        rows.push({
          id,
          instanceId: instance.id,
          trainerId,
          sellerName: text(l.sellerName, 32) || '—',
          price: num(l.price, 10_000_000),
          note: text(l.note, NOTE_MAX),
          speciesName: text(l.speciesName, 48) || '?',
          level: num(l.level, 500),
          shiny: l.shiny === true,
          ivPercent: num(l.ivPercent, 100),
          sprite: text(l.sprite, 200),
          createdAt: num(l.createdAt, Number.MAX_SAFE_INTEGER) || now(),
        })
      }
      await store.replaceMarket(instance.id, rows)
      return { status: 200, body: { accepted: rows.length } }
    }

    if (req.method === 'GET' && req.path === '/market') {
      const rows = await store.openMarket(MARKET_PAGE)
      return { status: 200, body: { rows } }
    }

    /* ---------------------------------------------------------- Treuhand */
    /*
     * Kaufen ueber Instanzgrenzen.
     *
     * Das Gold liegt in der einen Datenbank, das Pokemon in der anderen, und
     * keine sieht die andere. Ein Kauf in einem Zug ist damit unmoeglich —
     * also wird er in drei zerlegt, und der Verbund haelt dazwischen fest,
     * wie weit er ist. Er verwahrt das Pokemon genau so lange, wie es weder
     * hier noch dort ist; das ist die Treuhand.
     *
     * Der Verbund entscheidet nichts. Er sagt nur, in welchem Zustand ein
     * Vorgang ist, und laesst jeden Uebergang genau einmal zu. Wer schummeln
     * will, muesste die eigene Instanz belogen haben — und die gehoert ihm
     * ohnehin. Was der Verbund verhindert, ist etwas anderes: dass eine Seite
     * zahlt und die andere nicht liefert.
     */
    if (req.method === 'POST' && req.path === '/market/buy') {
      const { listingId, buyerTrainerId } = body as { listingId?: unknown; buyerTrainerId?: unknown }
      if (typeof listingId !== 'string' || !listingId) return bad(400, 'validation_failed', { field: 'listingId' })
      if (typeof buyerTrainerId !== 'string' || !buyerTrainerId) return bad(400, 'validation_failed', { field: 'buyerTrainerId' })

      const angebot = (await store.openMarket(MARKET_PAGE)).find((m) => m.id === listingId)
      if (!angebot) return bad(404, 'not_found', { listingId })
      // Die eigene Ware zu kaufen ergaebe nur Gebuehren.
      if (angebot.instanceId === instance.id) return bad(400, 'validation_failed', { reason: 'own_instance' })

      const vorgang = await store.createOrder({
        id: `${listingId}-${now()}`,
        listingId,
        sellerInstanceId: angebot.instanceId,
        sellerTrainerId: angebot.trainerId,
        buyerInstanceId: instance.id,
        buyerTrainerId,
        price: angebot.price,
        status: 'reserved',
        creature: null,
        reason: null,
        createdAt: now(),
        updatedAt: now(),
      })
      // Kein Fehler des Kaeufers, sondern ein Wettlauf, den er verloren hat.
      if (!vorgang) return bad(409, 'already_reserved', { listingId })
      return { status: 200, body: { order: vorgang } }
    }

    /* Alles, was diese Instanz angeht — beide Rollen in einer Antwort. */
    if (req.method === 'GET' && req.path === '/market/orders') {
      /*
       * Beim Nachfragen aufraeumen.
       *
       * Der Verbund hat keine Uhr, die von selbst laeuft — er ist ein Worker
       * und wacht nur auf, wenn jemand klopft. Also verfaellt hier, was zu
       * lange liegt: jede Instanz fragt regelmaessig nach, und damit laeuft
       * der Kehrbesen oft genug. Der Kaeufer bekommt sein Gold zurueck, wenn
       * er das naechste Mal hinsieht.
       */
      for (const alt of await store.staleOrders('reserved', now() - ORDER_TIMEOUT_MS)) {
        await store.advanceOrder(alt.id, 'reserved', 'aborted', { reason: 'zeit_abgelaufen' }, now())
      }
      return { status: 200, body: { orders: await store.ordersFor(instance.id) } }
    }

    if (req.method === 'POST' && req.path === '/market/deliver') {
      const { orderId, creature } = body as { orderId?: unknown; creature?: unknown }
      if (typeof orderId !== 'string') return bad(400, 'validation_failed', { field: 'orderId' })
      if (typeof creature !== 'string' || !creature) return bad(400, 'validation_failed', { field: 'creature' })
      if (creature.length > CREATURE_MAX) return bad(400, 'validation_failed', { field: 'creature', max: CREATURE_MAX })

      const o = await store.getOrder(orderId)
      if (!o) return bad(404, 'not_found', { orderId })
      // Nur die Heimatinstanz kann liefern — sonst koennte jede Instanz
      // behaupten, ein fremdes Pokemon herausgegeben zu haben.
      if (o.sellerInstanceId !== instance.id) return bad(403, 'forbidden', { orderId })

      const ok = await store.advanceOrder(orderId, 'reserved', 'delivered', { creature }, now())
      return ok
        ? { status: 200, body: { ok: true } }
        : bad(409, 'wrong_state', { orderId, status: (await store.getOrder(orderId))?.status })
    }

    if (req.method === 'POST' && req.path === '/market/collect') {
      const { orderId } = body as { orderId?: unknown }
      if (typeof orderId !== 'string') return bad(400, 'validation_failed', { field: 'orderId' })

      const o = await store.getOrder(orderId)
      if (!o) return bad(404, 'not_found', { orderId })
      if (o.buyerInstanceId !== instance.id) return bad(403, 'forbidden', { orderId })
      /*
       * Erst herausgeben, dann abhaken.
       *
       * Umgekehrt waere der schlimmere Ausgang: bricht die Leitung nach dem
       * Abhaken, waere das Pokemon fort und niemand haette es. So kann es im
       * schlechtesten Fall zweimal geholt werden — und das faellt beim
       * Kaeufer auf, der den Vorgang bereits als erledigt fuehrt.
       */
      if (o.status === 'delivered') {
        const ok = await store.advanceOrder(orderId, 'delivered', 'collected', {}, now())
        if (!ok) return bad(409, 'wrong_state', { orderId })
        return { status: 200, body: { creature: o.creature } }
      }
      return bad(409, 'wrong_state', { orderId, status: o.status })
    }

    if (req.method === 'POST' && req.path === '/market/abort') {
      const { orderId, reason } = body as { orderId?: unknown; reason?: unknown }
      if (typeof orderId !== 'string') return bad(400, 'validation_failed', { field: 'orderId' })

      const o = await store.getOrder(orderId)
      if (!o) return bad(404, 'not_found', { orderId })
      // Abbrechen darf die Verkaeuferseite — sie ist die einzige, die merken
      // kann, dass sie nicht liefern kann.
      if (o.sellerInstanceId !== instance.id) return bad(403, 'forbidden', { orderId })
      const grund = typeof reason === 'string' ? reason.slice(0, 120) : 'unbekannt'
      const ok = await store.advanceOrder(orderId, 'reserved', 'aborted', { reason: grund }, now())
      return ok ? { status: 200, body: { ok: true } } : bad(409, 'wrong_state', { orderId })
    }

    if (req.method === 'GET' && req.path === '/leaderboard') {
      const rows = await store.topProfiles(50)
      return { status: 200, body: { rows } }
    }

    return bad(404, 'not_found')
  }
}

/**
 * Der Speicher des Verbund-Diensts, als Schnittstelle.
 *
 * Der Dienst soll auf einem Cloudflare Worker mit D1 laufen — aber er soll
 * sich auch ohne Cloudflare testen lassen, und zwar vollständig. Deshalb kennt
 * die Logik keine Datenbank, sondern nur diese wenigen Methoden; D1 und SQLite
 * sind zwei Umsetzungen davon.
 *
 * Das ist dieselbe Trennung, die die Engine vom Spiel hat, und sie zahlt sich
 * aus demselben Grund aus: was ohne I/O auskommt, lässt sich in Millisekunden
 * durchrechnen statt in einer Testumgebung mit Netz.
 */

export interface InstanceRow {
  id: string
  name: string
  /** Geheimnis für die Signatur. Verlässt den Dienst nur einmal, bei der Anmeldung. */
  secret: string
  createdAt: number
  /** Was die Instanz darf. Neue dürfen zuerst nur lesen; siehe VERBUND.md. */
  trust: 'read' | 'trade'
  blockedAt: number | null
}

export interface TrainerRow {
  /** Globale Id — ein Hash der Telegram-Id, damit die rohe Zahl nicht wandert. */
  id: string
  instanceId: string
  displayName: string
  /**
   * Der Trainer-Code, mit dem man ihn findet (`ABCD-1234`).
   *
   * Er ist ohnehin dafür gemacht, weitergegeben zu werden — anders als die
   * Telegram-Id, die deshalb gar nicht erst herkommt. Ohne ihn gäbe es keinen
   * Weg, jemanden auf einer fremden Instanz zu suchen, ohne dass eine Instanz
   * die Liste aller Spieler herunterladen kann.
   */
  code: string
  createdAt: number
  updatedAt: number
}

/** Eine Freundschaft über Instanzgrenzen. Immer sortiert gespeichert. */
export interface FriendRow {
  lowId: string
  highId: string
  createdAt: number
}

/** Eine offene Anfrage. */
export interface FriendRequestRow {
  fromId: string
  toId: string
  createdAt: number
}

export interface ProfileRow {
  trainerId: string
  badges: number
  dexCaught: number
  battlesWon: number
  rating: number
  level: number
  updatedAt: number
}

/**
 * Der Stand, den alle Instanzen fahren sollten.
 *
 * Eine einzige Zeile für den ganzen Verbund. Gesetzt wird sie von Hand, mit
 * dem Admin-Geheimnis — nicht automatisch aus einem Git-Haken heraus: was alle
 * Installationen aktualisiert, soll eine Entscheidung sein und kein Nebeneffekt
 * eines Pushes.
 */
export interface ReleaseRow {
  /** Git-Kurz-Hash, so wie ihn `git rev-parse --short HEAD` ausgibt. */
  sha: string
  /** Eine Zeile für die Benachrichtigung: was drin ist. */
  notes: string
  publishedAt: number
}

/**
 * Eine Nachricht im globalen Chat.
 *
 * Bewusst flach und ohne Räume: bei einer Handvoll Instanzen ist ein Raum
 * genau richtig, und mehrere wären leere Zimmer. Der Name wird **mitgespeichert**
 * statt beim Lesen nachgeschlagen — wer seinen Namen ändert, ändert damit nicht
 * rückwirkend, was er gesagt hat.
 */
export interface ChatRow {
  /** Fortlaufend. Der Client fragt „alles seit N" und braucht keine Uhr. */
  id: number
  trainerId: string
  instanceId: string
  name: string
  body: string
  createdAt: number
}

/**
 * Ein Marktangebot, wie es im Verbund steht.
 *
 * Nur Schaufenster: was hier liegt, ist eine **Abschrift** des Angebots auf
 * seiner Heimatinstanz, keine Kreatur. Gekauft wird in diesem Schritt noch
 * nicht — und deshalb wandert auch nichts herueber, was man faelschen koennte.
 * Die Kreatur selbst bleibt dort, wo sie entstanden ist; hier steht, wie sie
 * aussieht und was sie kosten soll.
 *
 * Der Name des Verkaeufers wird mitgeschrieben, nicht nachgeschlagen — aus
 * demselben Grund wie im Chat: wer sich umbenennt, aendert damit nicht
 * rueckwirkend, unter welchem Namen er etwas angeboten hat.
 */
export interface MarketRow {
  /** Die Id des Angebots auf seiner Heimatinstanz. */
  id: string
  instanceId: string
  trainerId: string
  sellerName: string
  price: number
  note: string
  speciesName: string
  level: number
  shiny: boolean
  /** Veranlagung in Prozent — die Zahl, nach der man ein Angebot beurteilt. */
  ivPercent: number
  sprite: string
  createdAt: number
}

/**
 * Eine Bestellung ueber Instanzgrenzen.
 *
 * Das Gegenstueck zum Aushang: dort steht, *was* jemand anbietet, hier steht,
 * *dass* jemand es gekauft hat. Bewusst zwei getrennte Dinge — eine Instanz
 * ersetzt ihren Aushang bei jedem Abgleich vollstaendig, und eine Bestellung
 * darf davon nicht mitgerissen werden. Ein Kaufvertrag ueberlebt es, wenn das
 * Schaufenster umgeraeumt wird.
 *
 * Der Weg hat drei Schritte, weil er ueber zwei Datenbanken laeuft, die
 * einander nicht sehen:
 *
 *   `reserved`  Der Kaeufer hat bezahlt. Sein Gold liegt bei ihm zu Hause
 *               fest; hier steht nur, dass es fest liegt.
 *   `delivered` Die Heimatinstanz hat das Pokemon herausgegeben. Es liegt
 *               jetzt hier — das ist die Treuhand, und sie dauert genau so
 *               lange, bis der Kaeufer es abholt.
 *   `collected` Abgeholt. Fertig.
 *   `aborted`   Etwas ging nicht. Der Kaeufer bekommt sein Gold zurueck.
 *
 * Ein Schritt zurueck gibt es nicht. Jeder Uebergang ist eine Bedingung auf
 * den vorigen Zustand, damit ein zweimal geschickter Aufruf nichts doppelt
 * tut — bei zwei Instanzen, die unabhaengig voneinander nachfragen, ist das
 * kein Sonderfall, sondern der Normalfall.
 */
export type OrderStatus = 'reserved' | 'delivered' | 'collected' | 'aborted'

export interface OrderRow {
  id: string
  listingId: string
  sellerInstanceId: string
  sellerTrainerId: string
  buyerInstanceId: string
  buyerTrainerId: string
  price: number
  status: OrderStatus
  /**
   * Das Pokemon, ab `delivered`.
   *
   * Als Text und nicht als Felder: der Verbund kennt keine Kreaturen und soll
   * keine kennen. Er verwahrt, was die eine Instanz geschickt hat, und gibt
   * genau das an die andere weiter — was darin steht, geht ihn nichts an.
   */
  creature: string | null
  /** Warum es scheiterte. Nur bei `aborted`. */
  reason: string | null
  createdAt: number
  updatedAt: number
}

export interface Store {
  /** Wer diesen Trainer-Code trägt. Null, wenn niemand. */
  trainerByCode(code: string): Promise<TrainerRow | null>

  /** Freundschaft anlegen; doppelt anlegen ist kein Fehler. */
  addFriend(row: FriendRow): Promise<void>
  removeFriend(a: string, b: string): Promise<void>
  friendsOf(trainerId: string): Promise<string[]>

  addFriendRequest(row: FriendRequestRow): Promise<void>
  removeFriendRequest(fromId: string, toId: string): Promise<void>
  requestsFor(trainerId: string): Promise<{ incoming: string[]; outgoing: string[] }>

  /** Mehrere Profile auf einmal — für die Freundesliste. */
  profilesOf(ids: readonly string[]): Promise<Array<ProfileRow & { displayName: string; instanceId: string; code: string }>>

  /** Anhängen; gibt die vergebene Nummer zurück. */
  addChat(row: Omit<ChatRow, 'id'>): Promise<number>
  /** Die neuesten Nachrichten, aufsteigend. `since` = 0 heißt: von vorn. */
  chatSince(since: number, limit: number): Promise<ChatRow[]>
  /** Wie viele eine Instanz zuletzt geschickt hat — gegen Fluten. */
  chatCountSince(instanceId: string, after: number): Promise<number>

  getRelease(): Promise<ReleaseRow | null>
  putRelease(row: ReleaseRow): Promise<void>

  getInstance(id: string): Promise<InstanceRow | null>
  putInstance(row: InstanceRow): Promise<void>

  getTrainer(id: string): Promise<TrainerRow | null>
  putTrainer(row: TrainerRow): Promise<void>
  countTrainers(instanceId: string): Promise<number>

  /**
   * Die Angebote einer Instanz vollstaendig ersetzen.
   *
   * Ersetzen statt anhaengen: eine Instanz schickt ihren ganzen Aushang, und
   * was verkauft oder zurueckgezogen wurde, verschwindet damit von selbst. Ein
   * Loeschbefehl je Angebot waere ein zweiter Weg, auf dem etwas verlorengehen
   * kann — und Angebote, die es nicht mehr gibt, sind das aergerlichste, was
   * ein Schaufenster zeigen kann.
   */
  replaceMarket(instanceId: string, rows: readonly MarketRow[]): Promise<void>
  /** Die neuesten Angebote aller Instanzen. */
  openMarket(limit: number): Promise<MarketRow[]>

  /**
   * Eine Bestellung anlegen — aber nur, wenn zu diesem Angebot keine offene
   * existiert. Gibt `null` zurueck, wenn schon jemand schneller war.
   *
   * Die Pruefung gehoert in den Speicher und nicht in den Dienst: zwei
   * Kaeufer, die im selben Augenblick zugreifen, duerfen nicht beide ein Ja
   * bekommen, und nur der Speicher kann das ausschliessen.
   */
  createOrder(row: OrderRow): Promise<OrderRow | null>
  /** Alles, was diese Instanz angeht — als Verkaeuferin oder als Kaeuferin. */
  ordersFor(instanceId: string): Promise<OrderRow[]>
  getOrder(id: string): Promise<OrderRow | null>
  /**
   * Zustand weiterschalten, aber nur aus einem erwarteten heraus.
   *
   * `false` heisst: der Vorgang war nicht mehr in dem Zustand, in dem der
   * Aufrufer ihn glaubte. Das ist keine Stoerung, sondern die Antwort auf
   * eine zweite Zustellung derselben Nachricht.
   */
  advanceOrder(
    id: string, von: OrderStatus, nach: OrderStatus,
    felder: { creature?: string; reason?: string }, now: number,
  ): Promise<boolean>
  /** Bestellungen, die zu lange in einem Zustand haengen. */
  staleOrders(status: OrderStatus, older: number): Promise<OrderRow[]>

  putProfile(row: ProfileRow): Promise<void>
  /** Rangliste über alle Instanzen, absteigend. */
  topProfiles(limit: number): Promise<Array<ProfileRow & { displayName: string; instanceId: string }>>
  rankOf(trainerId: string): Promise<number | null>
}

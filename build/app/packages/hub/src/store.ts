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

  putProfile(row: ProfileRow): Promise<void>
  /** Rangliste über alle Instanzen, absteigend. */
  topProfiles(limit: number): Promise<Array<ProfileRow & { displayName: string; instanceId: string }>>
  rankOf(trainerId: string): Promise<number | null>
}

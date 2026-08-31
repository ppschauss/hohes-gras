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
  createdAt: number
  updatedAt: number
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

export interface Store {
  getRelease(): Promise<ReleaseRow | null>
  putRelease(row: ReleaseRow): Promise<void>

  getInstance(id: string): Promise<InstanceRow | null>
  putInstance(row: InstanceRow): Promise<void>

  getTrainer(id: string): Promise<TrainerRow | null>
  putTrainer(row: TrainerRow): Promise<void>
  countTrainers(instanceId: string): Promise<number>

  putProfile(row: ProfileRow): Promise<void>
  /** Rangliste über alle Instanzen, absteigend. */
  topProfiles(limit: number): Promise<Array<ProfileRow & { displayName: string; instanceId: string }>>
  rankOf(trainerId: string): Promise<number | null>
}

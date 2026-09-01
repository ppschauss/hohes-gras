import type { Db } from '../db/index.js'

/**
 * Woher eine Zuwendung stammt.
 *
 * Wird an jeder Stelle verlangt, an der etwas entsteht — Kreatur, Gegenstand,
 * Gold. Bewusst als Pflichtangabe und nicht als wahlfreier Zusatz: eine
 * Herkunft, die man weglassen kann, fehlt genau bei dem Weg, den spaeter
 * niemand mehr nachvollziehen will.
 */
export interface Herkunft {
  /** Wodurch es entstand: 'safari.catch', 'raid.reward', 'shop.buy', ... */
  source: string
  /** Der Git-Stand des Servers, unter dem es entstand. */
  release: string
}

export type AcquisitionKind = 'creature' | 'item' | 'gold'

export interface Acquisition {
  id: number
  trainerId: string
  at: number
  releaseSha: string
  source: string
  kind: AcquisitionKind
  ref: string
  amount: number
  detail: string | null
}

/** Einen Beleg schreiben. Wird aus den drei Engstellen gerufen, nicht von Hand. */
export function record(
  db: Db,
  trainerId: string,
  herkunft: Herkunft,
  kind: AcquisitionKind,
  ref: string,
  amount: number,
  detail?: Record<string, unknown>,
  now = Date.now(),
): void {
  db.prepare(
    `INSERT INTO acquisitions (trainer_id, at, release_sha, source, kind, ref, amount, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trainerId, now, herkunft.release, herkunft.source, kind, ref, amount,
    detail ? JSON.stringify(detail) : null,
  )
}

export interface Filter {
  since?: number
  until?: number
  source?: string
  releaseSha?: string
  trainerId?: string
  kind?: AcquisitionKind
}

/**
 * Belege suchen.
 *
 * Alle Bedingungen sind wahlfrei und werden mit UND verknuepft. Ohne jede
 * Bedingung kommt alles — das ist Absicht: ein Werkzeug, das ohne Filter
 * nichts findet, laesst einen im Dunkeln taumeln, wenn man noch nicht weiss,
 * wonach man sucht.
 */
export function find(db: Db, f: Filter, limit = 5000): Acquisition[] {
  const wo: string[] = []
  const werte: unknown[] = []
  if (f.since !== undefined) { wo.push('at >= ?'); werte.push(f.since) }
  if (f.until !== undefined) { wo.push('at <= ?'); werte.push(f.until) }
  if (f.source) { wo.push('source = ?'); werte.push(f.source) }
  if (f.releaseSha) { wo.push('release_sha = ?'); werte.push(f.releaseSha) }
  if (f.trainerId) { wo.push('trainer_id = ?'); werte.push(f.trainerId) }
  if (f.kind) { wo.push('kind = ?'); werte.push(f.kind) }

  const rows = db.prepare(
    `SELECT id, trainer_id, at, release_sha, source, kind, ref, amount, detail
       FROM acquisitions
      ${wo.length ? `WHERE ${wo.join(' AND ')}` : ''}
      ORDER BY at ASC, id ASC
      LIMIT ?`,
  ).all(...werte, limit) as Array<Record<string, unknown>>

  return rows.map((r) => ({
    id: r.id as number,
    trainerId: r.trainer_id as string,
    at: r.at as number,
    releaseSha: r.release_sha as string,
    source: r.source as string,
    kind: r.kind as AcquisitionKind,
    ref: r.ref as string,
    amount: r.amount as number,
    detail: (r.detail as string | null) ?? null,
  }))
}

/** Welche Quellen es ueberhaupt gibt — damit man nicht raten muss. */
export function sources(db: Db): Array<{ source: string; kind: string; n: number; first: number; last: number }> {
  return db.prepare(
    `SELECT source, kind, COUNT(*) AS n, MIN(at) AS first, MAX(at) AS last
       FROM acquisitions GROUP BY source, kind ORDER BY n DESC`,
  ).all() as Array<{ source: string; kind: string; n: number; first: number; last: number }>
}

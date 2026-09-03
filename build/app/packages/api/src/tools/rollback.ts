/**
 * Zuwendungen sichten und zuruecknehmen.
 *
 * Der Anlass war ein Fehler von drei Stunden: Legendaere standen versehentlich
 * in den normalen Begegnungstabellen, und hinterher liess sich zwar nachlesen,
 * *dass* sieben gefangen wurden, aber nicht, *welche* Zeilen in `creatures`
 * das waren. Das Ereignisprotokoll erzaehlt; es belegt nicht.
 *
 * Dieses Werkzeug arbeitet auf `acquisitions` — der Tabelle, in der jede
 * Zuwendung mit Kennung, Quelle und Git-Stand steht. Damit ist "alles, was
 * unter Stand X durch Quelle Y kam" eine Abfrage statt einer Ermittlung.
 *
 * Zwei Grundsaetze:
 *
 *   Vorschau ist die Voreinstellung. Ohne `--wirklich` wird nichts angefasst.
 *   Es gibt keinen Grund, das Loeschen zum Normalfall zu machen.
 *
 *   Was nicht mehr da ist, wird gemeldet und nicht erzwungen. Ein Pokemon kann
 *   sich entwickelt haben, verwertet oder weitergetauscht worden sein; ein
 *   Gegenstand kann verbraucht sein. Der Bericht sagt dann, was nicht ging —
 *   eine stille Teilruecknahme waere schlimmer als gar keine.
 */
import { join } from 'node:path'
import { openDb, type Db } from '../db/index.js'
import * as acquisitions from '../repos/acquisitions.js'
import type { Acquisition } from '../repos/acquisitions.js'

interface Optionen {
  since?: number
  until?: number
  source?: string
  release?: string
  trainer?: string
  wirklich: boolean
  quellen: boolean
}

function parse(argv: string[]): Optionen {
  const o: Optionen = { wirklich: false, quellen: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const wert = () => argv[++i] ?? ''
    if (a === '--seit') o.since = zeit(wert())
    else if (a === '--bis') o.until = zeit(wert())
    else if (a === '--quelle') o.source = wert()
    else if (a === '--stand') o.release = wert()
    else if (a === '--trainer') o.trainer = wert()
    else if (a === '--wirklich') o.wirklich = true
    else if (a === '--quellen') o.quellen = true
    else throw new Error(`Unbekannte Angabe: ${a}`)
  }
  return o
}

/** ISO-Datum oder Millisekunden — je nachdem, ob man aus einem Protokoll
 *  kopiert oder aus dem Kopf tippt. */
function zeit(s: string): number {
  if (/^\d+$/.test(s)) return Number(s)
  const t = Date.parse(s)
  if (Number.isNaN(t)) throw new Error(`Kein Zeitpunkt: ${s}`)
  return t
}

const datum = (ms: number) =>
  new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })

function main(): void {
  const o = parse(process.argv.slice(2))
  const db = openDb(join(process.env.DATA_DIR ?? '/data', 'game.db'))

  if (o.quellen) {
    console.log('Quelle                       Art       Anzahl  von                  bis')
    for (const s of acquisitions.sources(db)) {
      console.log(
        `${s.source.padEnd(28)} ${s.kind.padEnd(9)} ${String(s.n).padStart(6)}  ` +
        `${datum(s.first).padEnd(20)} ${datum(s.last)}`,
      )
    }
    return
  }

  if (o.since === undefined && !o.source && !o.release && !o.trainer) {
    console.error('Ohne Einschraenkung waere alles betroffen. Mindestens eine Angabe:')
    console.error('  --seit <ISO|ms>   --bis <ISO|ms>   --quelle <name>')
    console.error('  --stand <sha>     --trainer <id>')
    console.error('  --quellen         zeigt, welche Quellen es gibt')
    console.error('  --wirklich        fuehrt aus; ohne das nur Vorschau')
    process.exitCode = 2
    return
  }

  const treffer = acquisitions.find(db, {
    since: o.since, until: o.until, source: o.source,
    releaseSha: o.release, trainerId: o.trainer,
  })
  if (treffer.length === 0) { console.log('Nichts gefunden.'); return }

  const namen = new Map<string, string>(
    (db.prepare('SELECT id, display_name FROM trainers').all() as Array<{ id: string; display_name: string }>)
      .map((t) => [t.id, t.display_name]),
  )

  console.log(`${treffer.length} Zuwendungen${o.wirklich ? '' : ' (Vorschau — nichts wird geaendert)'}:\n`)
  for (const a of treffer) {
    const wer = namen.get(a.trainerId) ?? a.trainerId
    const was = a.kind === 'gold'
      ? `${a.amount} Gold`
      : a.kind === 'item'
        ? `${a.amount}x ${a.ref}`
        : String((JSON.parse(a.detail ?? '{}') as { speciesId?: string }).speciesId ?? a.ref)
    console.log(`  ${datum(a.at)}  ${wer.padEnd(18)} ${a.source.padEnd(26)} ${was}`)
  }

  if (!o.wirklich) {
    console.log('\nZum Ausfuehren dieselbe Zeile mit --wirklich. Vorher sichern.')
    return
  }

  const bericht = zuruecknehmen(db, treffer)
  console.log(`\nZurueckgenommen: ${bericht.erledigt} von ${treffer.length}`)
  for (const z of bericht.probleme) console.log(`  NICHT: ${z}`)
}

interface Bericht { erledigt: number; probleme: string[] }

/**
 * Die eigentliche Ruecknahme.
 *
 * In einer Transaktion: entweder alles oder nichts. Ein halb zurueckgenommener
 * Stand waere schlimmer als der Fehler, den er beheben soll.
 */
export function zuruecknehmen(db: Db, treffer: Acquisition[]): Bericht {
  const bericht: Bericht = { erledigt: 0, probleme: [] }

  db.transaction(() => {
    for (const a of treffer) {
      /*
       * Schon zurueckgenommen? Dann nichts.
       *
       * Die Suche blendet solche Zeilen aus, aber der Aufrufer kann eine
       * aeltere Liste in der Hand haben — und bei Gold und Gegenstaenden
       * rechnet die Ruecknahme gegen den *aktuellen* Bestand, zoege also ein
       * zweites Mal ab. Die Pruefung gehoert deshalb hierher, nicht nur in
       * die Abfrage.
       */
      const stand = db.prepare('SELECT undone_at AS u FROM acquisitions WHERE id = ?')
        .get(a.id) as { u: number | null } | undefined
      if (!stand || stand.u !== null) continue

      if (a.kind === 'creature') {
        const zeile = db.prepare('SELECT owner_id FROM creatures WHERE id = ?')
          .get(a.ref) as { owner_id: string } | undefined
        if (!zeile) {
          bericht.probleme.push(`Kreatur ${a.ref} gibt es nicht mehr (entwickelt, verwertet oder geloescht)`)
          continue
        }
        // Weitergetauscht: das Loeschen traefe jemanden, der nichts getan hat.
        if (zeile.owner_id !== a.trainerId) {
          bericht.probleme.push(`Kreatur ${a.ref} gehoert inzwischen jemand anderem — nicht angefasst`)
          continue
        }
        db.prepare('DELETE FROM creatures WHERE id = ?').run(a.ref)
        bericht.erledigt++
      } else if (a.kind === 'item') {
        const da = (db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
          .get(a.trainerId, a.ref) as { quantity: number } | undefined)?.quantity ?? 0
        const weg = Math.min(da, a.amount)
        if (weg > 0) {
          db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE trainer_id = ? AND item_id = ?')
            .run(weg, a.trainerId, a.ref)
          bericht.erledigt++
        }
        if (weg < a.amount) {
          bericht.probleme.push(`${a.ref}: nur ${weg} von ${a.amount} da, der Rest ist verbraucht`)
        }
      } else {
        const gold = (db.prepare('SELECT gold FROM trainers WHERE id = ?')
          .get(a.trainerId) as { gold: number } | undefined)?.gold ?? 0
        const weg = Math.min(gold, a.amount)
        if (weg > 0) {
          db.prepare('UPDATE trainers SET gold = gold - ? WHERE id = ?').run(weg, a.trainerId)
          bericht.erledigt++
        }
        if (weg < a.amount) {
          bericht.probleme.push(`Gold: nur ${weg} von ${a.amount} da, der Rest ist ausgegeben`)
        }
      }
      /*
       * Der Beleg bleibt stehen, bekommt aber einen Vermerk.
       *
       * Loeschen hiesse, die Spur des Eingriffs zu verwischen. Hier stand, eine
       * zweite Ruecknahme falle von selbst auf — das galt nur fuer Kreaturen,
       * deren Zeile danach weg ist. Bei Gold und Gegenstaenden wird gegen den
       * *aktuellen* Bestand gerechnet, und ein zweiter Lauf zog dieselbe Summe
       * noch einmal ab, diesmal aus rechtmaessig Verdientem.
       */
      acquisitions.markUndone(db, a.id)
    }
  })()

  return bericht
}

// Nur ausfuehren, wenn direkt gestartet — der Test importiert `zuruecknehmen`.
if (process.argv[1]?.endsWith('rollback.js')) {
  try { main() } catch (e) { console.error(String(e)); process.exitCode = 1 }
}

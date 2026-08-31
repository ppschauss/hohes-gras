/**
 * Instanz gegen Worker, über echtes HTTP und echtes D1.
 *
 * Aufruf:
 *   npm run hub:dev -w @game/hub     # Worker lokal, liest worker/.dev.vars
 *   npm run hub:e2e -w @game/hub     # dieses Skript dagegen
 *
 * Gegen einen echten Verbund: `HUB_BASE` und `HUB_ADMIN` setzen. Jeder Lauf
 * meldet eine eigene Instanz an und legt eigene Trainer an, also lässt er sich
 * beliebig oft wiederholen — ein Prüfskript, das vorher aufgeräumt werden
 * will, wird nicht ausgeführt.
 *
 * Warum es das überhaupt gibt: die Vitest-Tests ersetzen `fetch` durch die
 * Dienstlogik. Das prüft die Regeln, aber nicht die Übersetzung — Kopfzeilen,
 * roher Rumpf, D1-Spaltennamen. Genau da gehen verteilte Systeme kaputt, und
 * genau so wurde es gefunden: der Client hängte auch an ein GET einen Rumpf,
 * was `fetch` rundheraus abweist. Mit ersetztem `fetch` fiel das nie auf, im
 * Betrieb wäre jeder Abruf der Rangliste gescheitert.
 */
import { sign } from '../dist/index.js'

const BASE = (process.env.HUB_BASE ?? 'http://127.0.0.1:8787').replace(/\/$/, '')
const ADMIN = process.env.HUB_ADMIN ?? 'lokaler-test-admin'
/** Eigene Kennung je Lauf, damit nichts von gestern im Weg steht. */
const RUN = Date.now().toString(36)
const INSTANCE = `probe-${RUN}`

let secret = ''
let failures = 0

const ok = (label, cond, extra = '') => {
  if (!cond) failures++
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${extra ? ' — ' + extra : ''}`)
}

const call = async (method, path, body = {}, admin = false) => {
  const raw = JSON.stringify(body)
  const headers = { 'content-type': 'application/json' }
  if (admin) headers['x-hub-admin'] = ADMIN
  else {
    const ts = Date.now()
    headers['x-hub-instance'] = INSTANCE
    headers['x-hub-timestamp'] = String(ts)
    headers['x-hub-signature'] = await sign(secret, method, path, ts, raw)
  }
  // Kein Rumpf an einem GET: `fetch` weist das ab. Signiert wird er trotzdem,
  // und die Gegenseite liest einen leeren Rumpf als "{}".
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: method === 'GET' ? undefined : raw,
  })
  const text = await res.text()
  try {
    return { status: res.status, body: JSON.parse(text) }
  } catch {
    return { status: res.status, body: { error: 'kein JSON', text: text.slice(0, 200) } }
  }
}

console.log(`Verbund: ${BASE}  ·  Instanz: ${INSTANCE}\n`)

console.log('Instanz anmelden')
const reg = await call('POST', '/instances', { id: INSTANCE, name: 'Prüflauf' }, true)
ok('angemeldet', reg.status === 200, `Status ${reg.status}`)
if (reg.status !== 200) {
  console.error('\nOhne Instanz geht der Rest nicht:', JSON.stringify(reg.body))
  process.exit(1)
}
secret = reg.body.secret
ok('Geheimnis erhalten', typeof secret === 'string' && secret.length === 64)
ok('kein zweites Mal', (await call('POST', '/instances', { id: INSTANCE }, true)).status === 409)
ok('ohne Admin-Geheimnis abgewiesen',
  (await call('POST', '/instances', { id: `${INSTANCE}-b` }, false)).status === 401)

console.log('\nSignatur über echtes HTTP')
const bad = await fetch(`${BASE}/trainers`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json', 'x-hub-instance': INSTANCE,
    'x-hub-timestamp': String(Date.now()), 'x-hub-signature': 'ff'.repeat(32),
  },
  body: JSON.stringify({ telegramId: '1' }),
})
ok('gefälschte Signatur abgewiesen', bad.status === 401, `Status ${bad.status}`)

// Signatur über den einen Rumpf, geschickt mit einem anderen.
const ts = Date.now()
const swapped = await fetch(`${BASE}/trainers`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json', 'x-hub-instance': INSTANCE,
    'x-hub-timestamp': String(ts),
    'x-hub-signature': await sign(secret, 'POST', '/trainers', ts, JSON.stringify({ telegramId: '1' })),
  },
  body: JSON.stringify({ telegramId: '999' }),
})
ok('vertauschter Rumpf abgewiesen', swapped.status === 401, `Status ${swapped.status}`)

const stale = Date.now() - 10 * 60_000
const old = await fetch(`${BASE}/leaderboard`, {
  headers: {
    'x-hub-instance': INSTANCE, 'x-hub-timestamp': String(stale),
    'x-hub-signature': await sign(secret, 'GET', '/leaderboard', stale, '{}'),
  },
})
ok('zehn Minuten alte Anfrage abgewiesen', old.status === 401, `Status ${old.status}`)

console.log('\nTrainer und Profile')
const stark = await call('POST', '/trainers', { telegramId: `${RUN}-1`, displayName: `Stark-${RUN}` })
const schwach = await call('POST', '/trainers', { telegramId: `${RUN}-2`, displayName: `Schwach-${RUN}` })
ok('zwei Trainer angelegt', stark.status === 200 && schwach.status === 200)
ok('dieselbe Id beim zweiten Mal',
  (await call('POST', '/trainers', { telegramId: `${RUN}-1` })).body.id === stark.body.id, stark.body.id)
ok('rohe Telegram-Id nicht sichtbar', !stark.body.id.includes(RUN))

const p1 = await call('PUT', '/profiles', { trainerId: stark.body.id, badges: 8, dexCaught: 240, battlesWon: 900, level: 100 })
const p2 = await call('PUT', '/profiles', { trainerId: schwach.body.id, badges: 3, dexCaught: 90, battlesWon: 120, level: 60 })
ok('beide Profile angenommen', p1.status === 200 && p2.status === 200,
  `${p1.status}/${p2.status} ${JSON.stringify(p1.body)}`)

console.log('\nRangliste aus D1')
const board = await call('GET', '/leaderboard')
ok('geliefert', board.status === 200, `Status ${board.status}`)
const mine = (board.body.rows ?? []).filter((r) => r.displayName.endsWith(RUN))
for (const r of mine) {
  console.log(`     ${r.displayName} (${r.instanceId}) — 🏅${r.badges} 📖${r.dexCaught} ⚔️${r.battlesWon} Lv.${r.level}`)
}
ok('beide dabei', mine.length === 2)
ok('richtig sortiert', mine[0]?.displayName.startsWith('Stark'))

console.log('\nGedeckelte Werte')
// Erst jetzt: sonst überholt der gedeckelte Wert (26 Orden) den echten (8),
// und die Sortierprüfung oben schlüge zu Recht fehl.
ok('Unsinn angenommen',
  (await call('PUT', '/profiles',
    { trainerId: schwach.body.id, badges: 9999, dexCaught: -5, level: 100000 })).status === 200)
const after = (await call('GET', '/leaderboard')).body.rows
  .find((r) => r.displayName === `Schwach-${RUN}`)
ok('9999 Orden auf 26', after?.badges === 26, String(after?.badges))
ok('negativer Dex auf 0', after?.dexCaught === 0, String(after?.dexCaught))
ok('Level 100000 auf 500', after?.level === 500, String(after?.level))

console.log(failures === 0 ? '\n✓ Alles durch.' : `\n✗ ${failures} fehlgeschlagen.`)
process.exit(failures === 0 ? 0 : 1)

import { createHub, d1Store, type D1Like } from '../src/index.js'

/**
 * Der Worker.
 *
 * Übersetzt HTTP in eine `HubRequest` und zurück — mehr nicht. Alles, was
 * entschieden wird, entscheidet `createHub`, und das ist ohne Cloudflare
 * getestet. Deshalb ist diese Datei so kurz, und deshalb soll sie es bleiben.
 */

export interface Env {
  DB: D1Like
  /** Salz für die globalen Trainer-Ids. Ändert es sich, wechseln alle Ids. */
  ID_SALT: string
  /** Wer neue Instanzen anmelden darf. */
  ADMIN_SECRET: string
  /** Wer sich selbst anmelden darf. Leer heisst: niemand, nur der Admin-Weg. */
  JOIN_SECRET?: string
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const hub = createHub({
      store: d1Store(env.DB),
      idSalt: env.ID_SALT,
      adminSecret: env.ADMIN_SECRET,
      joinSecret: env.JOIN_SECRET,
    })

    // Der Rumpf wird mitsigniert, also muss er unverändert durch — geparst
    // wird er erst, nachdem die Signatur über den rohen Text gestimmt hat.
    const raw = await req.text()
    let body: unknown = {}
    if (raw) {
      try { body = JSON.parse(raw) } catch { return json(400, { error: 'validation_failed' }) }
    }

    const instanceId = req.headers.get('x-hub-instance')
    const timestamp = Number(req.headers.get('x-hub-timestamp') ?? 0)
    const signature = req.headers.get('x-hub-signature')

    const res = await hub({
      method: req.method,
      path: url.pathname,
      body,
      // GET traegt keinen Rumpf — signiert wird trotzdem "{}", damit beide
      // Seiten dieselbe Zeichenkette meinen.
      rawBody: raw || '{}',
      auth: instanceId && signature ? { instanceId, timestamp, signature } : undefined,
      adminSecret: req.headers.get('x-hub-admin') ?? undefined,
      joinSecret: req.headers.get('x-hub-join') ?? undefined,
    })
    return json(res.status, res.body)
  },
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

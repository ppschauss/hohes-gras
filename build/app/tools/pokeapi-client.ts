import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * Minimal PokéAPI client with an on-disk cache.
 *
 * The cache is not an optimization, it is politeness and reproducibility: a
 * full Kanto import touches well over a thousand endpoints, and re-running the
 * importer after a mapping change must not hammer a free public API again.
 */
export class PokeApi {
  // Ausgeschriebene Felder statt Parameter-Properties: `node
  // --experimental-strip-types` entfernt nur Typen und kann keinen Code
  // erzeugen, den Parameter-Properties bräuchten.
  private inFlight = 0
  private queue: (() => void)[] = []
  private readonly cacheDir: string
  private readonly concurrency: number
  private readonly baseUrl: string

  constructor(cacheDir: string, concurrency = 6, baseUrl = 'https://pokeapi.co/api/v2') {
    this.cacheDir = cacheDir
    this.concurrency = concurrency
    this.baseUrl = baseUrl
  }

  async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}/${path.replace(/^\/+/, '')}`
    const key = createHash('sha1').update(url).digest('hex')
    const cacheFile = join(this.cacheDir, `${key}.json`)

    try {
      return JSON.parse(await readFile(cacheFile, 'utf8')) as T
    } catch { /* nicht im Cache */ }

    const body = await this.withSlot(() => fetchJson(url))
    await mkdir(this.cacheDir, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(body))
    return body as T
  }

  /** Bounded parallelism. Without it a 1000-request import either trips the
   *  API's rate limiting or exhausts local sockets. */
  private async withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.inFlight++
    try {
      return await fn()
    } finally {
      this.inFlight--
      this.queue.shift()?.()
    }
  }
}

async function fetchJson(url: string, attempt = 1): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'otakupulse-poke-import/1.0' } })
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
    if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`)
    return await res.json()
  } catch (err) {
    if (attempt >= 4) throw new Error(`${url}: ${(err as Error).message}`)
    // Exponentieller Rückzug, damit ein kurzer Aussetzer den Import nicht abbricht.
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    return fetchJson(url, attempt + 1)
  }
}

/** Pick the German name, falling back to English and then the raw slug. */
export function germanName(names: Array<{ name: string; language: { name: string } }>, fallback: string): string {
  return (
    names.find((n) => n.language.name === 'de')?.name ??
    names.find((n) => n.language.name === 'en')?.name ??
    fallback
  )
}

export function germanText(
  entries: Array<{ flavor_text?: string; effect?: string; short_effect?: string; language: { name: string } }>,
  fallback = '',
): string {
  const pick = entries.find((e) => e.language.name === 'de') ?? entries.find((e) => e.language.name === 'en')
  const raw = pick?.short_effect ?? pick?.effect ?? pick?.flavor_text ?? fallback
  return raw.replace(/[\n\f­]/g, ' ').replace(/\s+/g, ' ').trim()
}

export const idFromUrl = (url: string): number => Number(url.replace(/\/$/, '').split('/').pop())

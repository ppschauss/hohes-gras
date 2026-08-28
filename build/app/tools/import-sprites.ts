import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
const ITEM_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items'

/**
 * Mirror sprites locally.
 *
 * Hotlinking someone else's raw GitHub content from a running game would be
 * both rude and fragile: the app would break the moment that repository moves
 * or rate-limits us, and every player would pay the latency. Filenames are
 * stable, so the API serves them with a one-year immutable cache.
 */
export async function mirrorSprites(
  species: Array<{ id: string; dexNumber: number }>,
  mediaDir: string,
  log: (m: string) => void,
  concurrency = 8,
): Promise<{ downloaded: number; skipped: number; failed: string[] }> {
  const dir = join(mediaDir, 'sprites')
  await mkdir(dir, { recursive: true })

  const jobs: Array<{ url: string; file: string; label: string }> = []
  for (const s of species) {
    jobs.push({ url: `${SPRITE_BASE}/${s.dexNumber}.png`, file: join(dir, `${s.id}.png`), label: s.id })
    jobs.push({ url: `${SPRITE_BASE}/shiny/${s.dexNumber}.png`, file: join(dir, `${s.id}-shiny.png`), label: `${s.id} (shiny)` })
  }

  let downloaded = 0
  let skipped = 0
  const failed: string[] = []
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]!
      try {
        await access(job.file)
        skipped++
        continue
      } catch { /* fehlt noch */ }
      try {
        const res = await fetch(job.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await writeFile(job.file, Buffer.from(await res.arrayBuffer()))
        downloaded++
      } catch (err) {
        failed.push(`${job.label}: ${(err as Error).message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  log(`Sprites: ${downloaded} geladen, ${skipped} bereits vorhanden, ${failed.length} fehlgeschlagen`)
  return { downloaded, skipped, failed }
}


/**
 * Mirror item icons.
 *
 * Unlike species, not every item id exists upstream: the pack invents garden
 * backgrounds and a few crafting materials. A miss is therefore expected and
 * not an error — the UI falls back to a category glyph for those.
 */
export async function mirrorItemIcons(
  itemIds: string[],
  mediaDir: string,
  log: (m: string) => void,
  concurrency = 8,
): Promise<{ downloaded: number; skipped: number; absent: string[] }> {
  const dir = join(mediaDir, 'items')
  await mkdir(dir, { recursive: true })

  let downloaded = 0
  let skipped = 0
  const absent: string[] = []
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < itemIds.length) {
      const id = itemIds[cursor++]!
      const file = join(dir, `${id}.png`)
      try {
        await access(file)
        skipped++
        continue
      } catch { /* fehlt noch */ }
      try {
        const res = await fetch(`${ITEM_BASE}/${id}.png`)
        if (res.status === 404) { absent.push(id); continue }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await writeFile(file, Buffer.from(await res.arrayBuffer()))
        downloaded++
      } catch {
        absent.push(id)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  log(`Item-Icons: ${downloaded} geladen, ${skipped} vorhanden, ${absent.length} ohne Vorlage (${absent.slice(0, 6).join(', ')}${absent.length > 6 ? ' …' : ''})`)
  return { downloaded, skipped, absent }
}

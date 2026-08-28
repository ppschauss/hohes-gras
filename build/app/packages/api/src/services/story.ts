import { GameError, type Trainer } from '@game/shared'
import type { ChapterDef } from '@game/content'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as progressionRepo from '../repos/progression.js'
import * as world from '../repos/world.js'
import * as inventory from '../repos/inventory.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { metricsOf } from './progression.js'

export interface ChapterView {
  id: string
  order: number
  title: string
  text: string
  reached: boolean
  claimed: boolean
  isCurrent: boolean
  requirements: Array<{ kind: string; label: string; have: number; need: number; met: boolean }>
  reward: { gold: number; itemName: string | null; quantity: number }
}

/**
 * Evaluate a chapter's conditions.
 *
 * Chapters read the same progress the rest of the game already records, so a
 * player can never be "stuck" in one: whatever they do next either advances a
 * chapter or does not, and nothing has to be re-synchronised.
 */
function evaluate(
  ctx: AppContext,
  trainer: Trainer,
  chapter: ChapterDef,
  metrics: Record<string, number>,
  visitedAreas: Set<string>,
  defeated: Set<string>,
): ChapterView['requirements'] {
  return chapter.requires.map((req) => {
    switch (req.kind) {
      case 'badges':
      case 'dexCaught':
      case 'highestLevel': {
        const have = metrics[req.kind] ?? 0
        const need = Number(req.value)
        return { kind: req.kind, label: String(need), have, need, met: have >= need }
      }
      case 'areaVisited': {
        const area = ctx.registry.tryArea(String(req.value))
        const met = visitedAreas.has(String(req.value))
        return {
          kind: req.kind,
          label: area ? ctx.registry.localized(area.name, trainer.locale) : String(req.value),
          have: met ? 1 : 0, need: 1, met,
        }
      }
      case 'defeated': {
        const npc = ctx.registry.allTrainers.find((x) => x.id === String(req.value))
        const met = defeated.has(String(req.value))
        return {
          kind: req.kind,
          label: npc ? ctx.registry.localized(npc.name, trainer.locale) : String(req.value),
          have: met ? 1 : 0, need: 1, met,
        }
      }
    }
  })
}

export function storyView(ctx: AppContext, trainer: Trainer) {
  const chapters = ctx.registry.chapters
  if (chapters.length === 0) return { chapters: [], currentChapter: null, completed: 0, total: 0 }

  const metrics = metricsOf(ctx, trainer.id)
  const visited = new Set(world.progressOf(ctx.db, trainer.id).keys())
  const defeated = new Set(battles.defeatsOf(ctx.db, trainer.id).keys())
  const claimed = progressionRepo.storyOf(ctx.db, trainer.id)

  // Kapitel bauen aufeinander auf: eines gilt erst als erreicht, wenn auch
  // alle davor erreicht sind. Sonst koennte der Zaehler "5 von 8" anzeigen,
  // waehrend Kapitel 1 noch offen ist — und die Reise waere keine Reise mehr,
  // sondern eine Checkliste.
  let previousReached = true

  const views: ChapterView[] = chapters.map((chapter) => {
    const requirements = evaluate(ctx, trainer, chapter, metrics, visited, defeated)
    const ownConditionsMet = requirements.every((r) => r.met)
    const reached = previousReached && ownConditionsMet
    previousReached = reached
    const item = chapter.reward.itemId ? ctx.registry.tryItem(chapter.reward.itemId) : undefined
    return {
      id: chapter.id,
      order: chapter.order,
      title: ctx.registry.localized(chapter.title, trainer.locale),
      text: ctx.registry.localized(reached ? chapter.outro : chapter.intro, trainer.locale),
      reached,
      claimed: claimed.has(chapter.id),
      isCurrent: false,
      requirements,
      reward: {
        gold: chapter.reward.gold,
        itemName: item ? ctx.registry.localized(item.name, trainer.locale) : null,
        quantity: chapter.reward.quantity ?? 0,
      },
    }
  })

  // The current chapter is the first not yet reached, or the last one if the
  // journey is complete — the guide always has something to say.
  const currentIndex = views.findIndex((c) => !c.reached)
  const current = currentIndex === -1 ? views.length - 1 : currentIndex
  if (views[current]) views[current]!.isCurrent = true

  return {
    chapters: views,
    currentChapter: views[current] ?? null,
    completed: views.filter((c) => c.reached).length,
    total: views.length,
  }
}

export function claimChapter(ctx: AppContext, trainer: Trainer, chapterId: string) {
  const chapter = ctx.registry.chapters.find((c) => c.id === chapterId)
  if (!chapter) throw new GameError('not_found', { chapterId }, 404)

  return tx(ctx.db, () => {
    const view = storyView(ctx, trainer).chapters.find((c) => c.id === chapterId)
    if (!view?.reached) throw new GameError('invalid_state', { reason: 'not_reached' }, 409)
    if (!progressionRepo.reachChapter(ctx.db, trainer.id, chapterId)) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }

    inventory.earnGold(ctx.db, trainer.id, chapter.reward.gold)
    if (chapter.reward.itemId && chapter.reward.quantity) {
      inventory.grant(ctx.db, trainer.id, chapter.reward.itemId, chapter.reward.quantity)
    }
    logEvent(ctx.db, trainer.id, 'story.claimed', { chapterId, reward: chapter.reward })
    return { chapterId, reward: chapter.reward }
  })
}

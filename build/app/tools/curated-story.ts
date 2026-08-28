/**
 * Story chapters.
 *
 * The guide in the original video kept a chapter counter that told the player
 * what the journey was *about* at any moment. Without it a world map is a list
 * of places; with it, it is a route.
 *
 * Chapters unlock from conditions the game already tracks, so no separate quest
 * state has to be maintained — a chapter is a view over progress, not a thing
 * the player can get stuck in.
 */

export interface ChapterCondition {
  kind: 'badges' | 'dexCaught' | 'areaVisited' | 'highestLevel' | 'defeated'
  value: number | string
}

export interface ChapterDef {
  id: string
  order: number
  title: { de: string }
  /** What the guide says when the chapter opens. */
  intro: { de: string }
  /** What he says once its goal is met. */
  outro: { de: string }
  /** Everything must be true for the chapter to count as reached. */
  requires: ChapterCondition[]
  reward: { gold: number; itemId?: string; quantity?: number }
}

export const CHAPTERS: ChapterDef[] = [
  {
    id: 'ch-1-first-steps', order: 1,
    title: { de: 'Die ersten Schritte' },
    intro: { de: 'Jede Reise beginnt mit einem Partner und einem Weg. Fang ein paar Pokémon auf Route 1 — nicht um stark zu sein, sondern um zu sehen, wer dort lebt.' },
    outro: { de: 'Gut. Du hast angefangen zuzuhören, statt nur zu laufen.' },
    requires: [{ kind: 'dexCaught', value: 5 }],
    reward: { gold: 300, itemId: 'poke-ball', quantity: 10 },
  },
  {
    id: 'ch-2-forest', order: 2,
    title: { de: 'Was im Wald wohnt' },
    intro: { de: 'Der Vertania-Wald ist eng und laut. Wer ihn durchquert, ohne ein Käferpokémon zu fangen, hat nicht hingesehen.' },
    outro: { de: 'Zehn Arten. Du fängst an, ein Sammler zu werden.' },
    requires: [{ kind: 'dexCaught', value: 10 }, { kind: 'areaVisited', value: 'viridian-forest' }],
    reward: { gold: 500, itemId: 'great-ball', quantity: 5 },
  },
  {
    id: 'ch-3-first-badge', order: 3,
    title: { de: 'Der erste Orden' },
    intro: { de: 'Rocko wartet in der Arena. Er wird dich nicht schonen — und genau deshalb lernst du dort mehr als auf zehn Routen.' },
    outro: { de: 'Ein Orden. Er wiegt nichts und ändert alles.' },
    requires: [{ kind: 'badges', value: 1 }],
    reward: { gold: 800, itemId: 'super-potion', quantity: 3 },
  },
  {
    id: 'ch-4-team', order: 4,
    title: { de: 'Ein Team, kein Rudel' },
    intro: { de: 'Fünf Pokémon sind kein Team, solange keins über Level 20 ist. Zieh sie auf. Der Garten ist kein Abstellplatz.' },
    outro: { de: 'Jetzt tragt ihr euch gegenseitig. Das ist der Unterschied.' },
    requires: [{ kind: 'highestLevel', value: 25 }, { kind: 'badges', value: 1 }],
    reward: { gold: 1000, itemId: 'exp-candy-s', quantity: 3 },
  },
  {
    id: 'ch-5-halfway', order: 5,
    title: { de: 'Die halbe Liga' },
    intro: { de: 'Vier Orden bedeuten vier verschiedene Arten zu verlieren. Du hast jede davon überstanden.' },
    outro: { de: 'Die zweite Hälfte wird nicht leichter. Sie wird nur interessanter.' },
    requires: [{ kind: 'badges', value: 4 }],
    reward: { gold: 2500, itemId: 'ultra-ball', quantity: 10 },
  },
  {
    id: 'ch-6-collector', order: 6,
    title: { de: 'Der Sammler' },
    intro: { de: 'Fünfzig Arten im Pokédex. Nicht gefangen, um zu gewinnen — gefangen, weil du wissen wolltest, was es gibt.' },
    outro: { de: 'Der Pokédex ist kein Abhakzettel. Er ist ein Reisetagebuch.' },
    requires: [{ kind: 'dexCaught', value: 50 }],
    reward: { gold: 3000, itemId: 'golden-razz', quantity: 3 },
  },
  {
    id: 'ch-7-all-badges', order: 7,
    title: { de: 'Acht Orden' },
    intro: { de: 'Giovanni ist der letzte. Er kämpft nicht, um zu gewinnen — er kämpft, um dir zu zeigen, dass du noch nicht so weit bist.' },
    outro: { de: 'Acht Orden. Das Indigo-Plateau steht dir offen.' },
    requires: [{ kind: 'badges', value: 8 }],
    reward: { gold: 8000, itemId: 'full-restore', quantity: 5 },
  },
  {
    id: 'ch-8-champion', order: 8,
    title: { de: 'Die Meisterprüfung' },
    intro: { de: 'Vier Meister und ein Champion. Kein Trick hilft hier, nur ein Team, das du wirklich kennst.' },
    outro: { de: 'Kanto-Meister. Es gibt größere Titel, aber keinen ersten mehr.' },
    requires: [{ kind: 'badges', value: 9 }],
    reward: { gold: 20000, itemId: 'rare-candy', quantity: 10 },
  },
]

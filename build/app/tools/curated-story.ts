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
  regionId?: string
  guide?: { de: string }
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
    guide: { de: 'Prof. Eich' },
    title: { de: 'Die ersten Schritte' },
    intro: { de: 'Jede Reise beginnt mit einem Partner und einem Weg. Fang ein paar Pokémon auf Route 1 — nicht um stark zu sein, sondern um zu sehen, wer dort lebt.' },
    outro: { de: 'Gut. Du hast angefangen zuzuhören, statt nur zu laufen.' },
    requires: [{ kind: 'dexCaught', value: 5 }],
    reward: { gold: 300, itemId: 'poke-ball', quantity: 10 },
  },
  {
    id: 'ch-2-forest', order: 2,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Was im Wald wohnt' },
    intro: { de: 'Der Vertania-Wald ist eng und laut. Wer ihn durchquert, ohne ein Käferpokémon zu fangen, hat nicht hingesehen.' },
    outro: { de: 'Zehn Arten. Du fängst an, ein Sammler zu werden.' },
    requires: [{ kind: 'dexCaught', value: 10 }, { kind: 'areaVisited', value: 'viridian-forest' }],
    reward: { gold: 500, itemId: 'great-ball', quantity: 5 },
  },
  {
    id: 'ch-3-first-badge', order: 3,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Der erste Orden' },
    intro: { de: 'Rocko wartet in der Arena. Er wird dich nicht schonen — und genau deshalb lernst du dort mehr als auf zehn Routen.' },
    outro: { de: 'Ein Orden. Er wiegt nichts und ändert alles.' },
    requires: [{ kind: 'badges', value: 1 }],
    reward: { gold: 800, itemId: 'super-potion', quantity: 3 },
  },
  {
    id: 'ch-4-team', order: 4,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Ein Team, kein Rudel' },
    intro: { de: 'Fünf Pokémon sind kein Team, solange keins über Level 20 ist. Zieh sie auf. Der Garten ist kein Abstellplatz.' },
    outro: { de: 'Jetzt tragt ihr euch gegenseitig. Das ist der Unterschied.' },
    requires: [{ kind: 'highestLevel', value: 25 }, { kind: 'badges', value: 1 }],
    reward: { gold: 1000, itemId: 'exp-candy-s', quantity: 3 },
  },
  {
    id: 'ch-5-halfway', order: 5,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Die halbe Liga' },
    intro: { de: 'Vier Orden bedeuten vier verschiedene Arten zu verlieren. Du hast jede davon überstanden.' },
    outro: { de: 'Die zweite Hälfte wird nicht leichter. Sie wird nur interessanter.' },
    requires: [{ kind: 'badges', value: 4 }],
    reward: { gold: 2500, itemId: 'ultra-ball', quantity: 10 },
  },
  {
    id: 'ch-6-collector', order: 6,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Der Sammler' },
    intro: { de: 'Fünfzig Arten im Pokédex. Nicht gefangen, um zu gewinnen — gefangen, weil du wissen wolltest, was es gibt.' },
    outro: { de: 'Der Pokédex ist kein Abhakzettel. Er ist ein Reisetagebuch.' },
    requires: [{ kind: 'dexCaught', value: 50 }],
    reward: { gold: 3000, itemId: 'golden-razz', quantity: 3 },
  },
  {
    id: 'ch-7-all-badges', order: 7,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Acht Orden' },
    intro: { de: 'Giovanni ist der letzte. Er kämpft nicht, um zu gewinnen — er kämpft, um dir zu zeigen, dass du noch nicht so weit bist.' },
    outro: { de: 'Acht Orden. Das Indigo-Plateau steht dir offen.' },
    requires: [{ kind: 'badges', value: 8 }],
    reward: { gold: 8000, itemId: 'full-restore', quantity: 5 },
  },
  {
    id: 'ch-8-champion', order: 8,
    guide: { de: 'Prof. Eich' },
    title: { de: 'Die Meisterprüfung' },
    intro: { de: 'Vier Meister und ein Champion. Kein Trick hilft hier, nur ein Team, das du wirklich kennst.' },
    outro: { de: 'Kanto-Meister. Es gibt größere Titel, aber keinen ersten mehr.' },
    requires: [{ kind: 'badges', value: 9 }],
    reward: { gold: 20000, itemId: 'rare-candy', quantity: 10 },
  },
]

/* ------------------------------------------------- Kapitel je Region ------ */

/**
 * Eine Reise je Region statt einer über alle.
 *
 * Vorher war die Reise eine einzige Kette: Kapitel 2 verlangte den
 * Vertania-Wald, Kapitel 9 die Route 29. Das setzte eine Reihenfolge voraus,
 * die es seit der freien Startregion nicht mehr gibt — wer in Hoenn anfängt,
 * kam über das zweite Kapitel nie hinaus.
 *
 * Jede Region hat jetzt ihre eigene Kette aus sieben Kapiteln, und alle
 * Bedingungen zählen nur, was *in dieser Region* erreicht wurde. Damit
 * funktioniert die Reise in jeder Reihenfolge, in der man die Welt bereist.
 */
export interface RegionChapterInput {
  regionId: string
  regionName: string
  guide: string
  /** Wievielte Region im Entwurf — bestimmt die Höhe der Belohnungen. */
  tier: number
  /** Das zweite Gebiet der Region: der erste Ort abseits der Startroute. */
  secondAreaId: string
  secondAreaName: string
  /** Wie viele Orden es hier zu holen gibt, Meisterprüfung eingerechnet. */
  badgeCount: number
}

export function regionChapters(input: RegionChapterInput): ChapterDef[] {
  const { regionId, regionName, guide, tier, secondAreaId, secondAreaName, badgeCount } = input
  /*
   * Jede Region zahlt dasselbe.
   *
   * Erst hing die Belohnung an der Entwurfsreihenfolge — Hoenn dreimal so viel
   * wie Kanto. Das stimmt nur, wenn man Kanto zuerst spielt; seit die
   * Startregion frei ist, waere es eine Praemie fuers Anfangen im Osten.
   */
  const gold = (base: number) => base
  const ch = (n: number, rest: Omit<ChapterDef, 'id' | 'order' | 'regionId' | 'guide'>): ChapterDef => ({
    id: `ch-${regionId}-${n}`,
    order: tier * 100 + n,
    regionId,
    guide: { de: guide },
    ...rest,
  })

  return [
    ch(1, {
      title: { de: 'Ankommen' },
      intro: { de: `Willkommen in ${regionName}. Fang ein paar Pokémon hier — nicht um stark zu sein, sondern um zu sehen, wer hier lebt.` },
      outro: { de: 'Gut. Du hast angefangen zuzuhören, statt nur zu laufen.' },
      requires: [{ kind: 'regionDexCaught', value: 5 }],
      reward: { gold: gold(300), itemId: 'poke-ball', quantity: 10 },
    }),
    ch(2, {
      title: { de: `Was in ${secondAreaName} wohnt` },
      intro: { de: `Der erste Ort abseits der Straße. Geh hin, sieh dich um, und komm mit mehr Namen zurück, als du hattest.` },
      outro: { de: 'Fünfzehn Arten. Du kennst diese Gegend jetzt besser als die meisten.' },
      requires: [
        { kind: 'regionDexCaught', value: 15 },
        { kind: 'areaVisited', value: secondAreaId },
      ],
      reward: { gold: gold(500), itemId: 'great-ball', quantity: 8 },
    }),
    ch(3, {
      title: { de: 'Der erste Orden' },
      intro: { de: 'Arenaleiter messen nicht, wie stark dein Team ist, sondern wie gut du es kennst. Der Unterschied fällt erst auf, wenn er zählt.' },
      outro: { de: 'Ein Orden. Der erste ist der, an den man sich erinnert.' },
      requires: [{ kind: 'regionBadges', value: 1 }],
      reward: { gold: gold(800), itemId: 'super-potion', quantity: 5 },
    }),
    ch(4, {
      title: { de: 'Ein Team, kein Rudel' },
      intro: { de: 'Fünf Pokémon nebeneinander sind noch kein Team. Zieh sie groß, bis sie zusammenpassen.' },
      outro: { de: 'Jetzt sieht man, dass ihr zusammengehört.' },
      requires: [
        { kind: 'regionBadges', value: 3 },
        /* Fest und niedrig: die Ordenszahl gibt das Tempo vor. Eine mit der
           Region steigende Levelforderung waere fuer eine Startregion im
           Osten unerfuellbar. */
        { kind: 'highestLevel', value: 25 },
      ],
      reward: { gold: gold(1200), itemId: 'exp-candy-s', quantity: 5 },
    }),
    ch(5, {
      title: { de: 'Die halbe Liga' },
      intro: { de: 'Die Hälfte ist geschafft. Ab hier hören die Arenaleiter auf, nachsichtig zu sein.' },
      outro: { de: 'Fünf Orden. Der Rest der Region weiß jetzt, wer du bist.' },
      requires: [{ kind: 'regionBadges', value: 5 }],
      reward: { gold: gold(2000), itemId: 'ultra-ball', quantity: 10 },
    }),
    ch(6, {
      title: { de: 'Alle Orden' },
      intro: { de: `Jede Arena in ${regionName}, keine ausgelassen. Danach steht nur noch eine Tür offen.` },
      outro: { de: 'Alle Orden dieser Region. Die Top Vier erwarten dich.' },
      requires: [{ kind: 'regionBadges', value: Math.max(1, badgeCount - 1) }],
      reward: { gold: gold(4000), itemId: 'rare-candy', quantity: 3 },
    }),
    ch(7, {
      title: { de: 'Die Meisterprüfung' },
      intro: { de: 'Vier Gegner ohne Pause, dann der Champion. Hier hilft kein Glück mehr.' },
      outro: { de: `${regionName} ist bezwungen. Die nächste Region steht dir offen.` },
      requires: [{ kind: 'regionBadges', value: badgeCount }],
      reward: { gold: gold(8000), itemId: 'exp-candy-l', quantity: 5 },
    }),
  ]
}

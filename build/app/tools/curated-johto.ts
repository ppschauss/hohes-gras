/**
 * Johto: the second region.
 *
 * Continues from Kanto rather than restarting: the first area requires the
 * Kanto league crown, and the level curve picks up where the Indigo Plateau
 * left off. A second region that starts at level 5 again would undo everything
 * the player built.
 */
import type { AreaOut } from './curated-kanto.ts'

export const JOHTO_REGION = {
  id: 'johto', order: 2,
  name: { de: 'Johto' },
  tagline: { de: 'Alte Türme, neue Namen.' },
  starterSpeciesIds: ['chikorita', 'cyndaquil', 'totodile'],
}

export const JOHTO_BADGES = [
  { id: 'zephyr-badge',  name: { de: 'Flügelorden' },  description: { de: 'Von Falk in Neuborkia.' },     icon: '/media/badges/zephyr.png',  obedienceLevel: 100 },
  { id: 'hive-badge',    name: { de: 'Käferorden' },   description: { de: 'Von Bugsy in Azalea City.' },   icon: '/media/badges/hive.png',    obedienceLevel: 100 },
  { id: 'plain-badge',   name: { de: 'Basisorden' },   description: { de: 'Von Bianca in Dukatia City.' }, icon: '/media/badges/plain.png',   obedienceLevel: 100 },
  { id: 'fog-badge',     name: { de: 'Nebelorden' },   description: { de: 'Von Marlon in Teak City.' },    icon: '/media/badges/fog.png',     obedienceLevel: 100 },
  { id: 'storm-badge',   name: { de: 'Sturmorden' },   description: { de: 'Von Hartwig in Anemonia City.' }, icon: '/media/badges/storm.png', obedienceLevel: 100 },
  { id: 'glacier-badge', name: { de: 'Gletscherorden' }, description: { de: 'Von Norbert in Mahagonia City.' }, icon: '/media/badges/glacier.png', obedienceLevel: 100 },
  { id: 'rising-badge',  name: { de: 'Drachenorden' }, description: { de: 'Von Sandra in Ebenholz City.' }, icon: '/media/badges/rising.png', obedienceLevel: 100 },
  { id: 'johto-crown',   name: { de: 'Krone von Johto' }, description: { de: 'Für den Sieg über Johtos Meister.' }, icon: '/media/badges/johto-crown.png', obedienceLevel: 100 },
]

interface TrainerSeed {
  id: string; name: string; title: string
  kind: 'trainer' | 'gym' | 'elite' | 'champion'
  team: Array<{ speciesId: string; level: number }>
  badgeId?: string; rewardGold: number
  intro: string; win: string; lose: string
}

const SEEDS: TrainerSeed[] = [
  { id: 'gym-falkner', name: 'Falk', title: 'Leiter der Neuborkia-Arena', kind: 'gym', badgeId: 'zephyr-badge', rewardGold: 7000,
    team: [{ speciesId: 'pidgey', level: 64 }, { speciesId: 'pidgeotto', level: 66 }, { speciesId: 'pidgeot', level: 68 }],
    intro: 'Mein Vater sagte, Flugpokémon seien überschätzt. Er hat nie gegen meine gekämpft.',
    win: 'Der Wind steht heute gegen dich.', lose: 'Du hast Höhe gewonnen. Nimm den Flügelorden.' },
  { id: 'gym-bugsy', name: 'Bugsy', title: 'Leiter der Azalea-Arena', kind: 'gym', badgeId: 'hive-badge', rewardGold: 7600,
    team: [{ speciesId: 'butterfree', level: 66 }, { speciesId: 'beedrill', level: 67 }, { speciesId: 'scyther', level: 70 }],
    intro: 'Käfer sind keine Anfängerpokémon. Das ist nur ein Gerücht, das Anfänger verbreiten.',
    win: 'Siehst du? Kein Gerücht.', lose: 'Beeindruckend. Der Käferorden gehört dir.' },
  { id: 'gym-whitney', name: 'Bianca', title: 'Leiterin der Dukatia-Arena', kind: 'gym', badgeId: 'plain-badge', rewardGold: 8200,
    team: [{ speciesId: 'clefairy', level: 68 }, { speciesId: 'wigglytuff', level: 69 }, { speciesId: 'tauros', level: 72 }],
    intro: 'Alle unterschätzen Normal-Pokémon. Alle.',
    win: 'Ich hab dir doch gesagt, dass Tauros hart ist.', lose: 'Okay. Okay! Hier, der Basisorden.' },
  { id: 'gym-morty', name: 'Marlon', title: 'Leiter der Teak-Arena', kind: 'gym', badgeId: 'fog-badge', rewardGold: 8800,
    team: [{ speciesId: 'gastly', level: 70 }, { speciesId: 'haunter', level: 72 }, { speciesId: 'gengar', level: 75 }],
    intro: 'In diesem Turm sieht man Dinge. Manche davon sind wirklich da.',
    win: 'Du hast in die falsche Richtung geschaut.', lose: 'Du siehst klarer als die meisten. Nimm den Nebelorden.' },
  { id: 'gym-chuck', name: 'Hartwig', title: 'Leiter der Anemonia-Arena', kind: 'gym', badgeId: 'storm-badge', rewardGold: 9400,
    team: [{ speciesId: 'primeape', level: 74 }, { speciesId: 'poliwrath', level: 74 }, { speciesId: 'machamp', level: 77 }],
    intro: 'Ich trainiere unter dem Wasserfall. Du trainierst in einem Garten. Mal sehen.',
    win: 'Zu weich!', lose: 'Ha! Ein Garten kann also doch etwas hervorbringen.' },
  { id: 'gym-pryce', name: 'Norbert', title: 'Leiter der Mahagonia-Arena', kind: 'gym', badgeId: 'glacier-badge', rewardGold: 10200,
    team: [{ speciesId: 'seel', level: 76 }, { speciesId: 'dewgong', level: 78 }, { speciesId: 'cloyster', level: 80 }],
    intro: 'Ich bin seit fünfzig Jahren Trainer. Eis vergisst nichts.',
    win: 'Zu ungeduldig, wie alle Jungen.', lose: 'Fünfzig Jahre, und ich lerne noch dazu.' },
  { id: 'gym-clair', name: 'Sandra', title: 'Leiterin der Ebenholz-Arena', kind: 'gym', badgeId: 'rising-badge', rewardGold: 11000,
    team: [{ speciesId: 'dratini', level: 80 }, { speciesId: 'dragonair', level: 82 }, { speciesId: 'gyarados', level: 82 }, { speciesId: 'dragonite', level: 85 }],
    intro: 'Drachen gehorchen niemandem, der sie sich nicht verdient hat.',
    win: 'Du hast es dir nicht verdient.', lose: '… Also gut. Der Drachenorden. Verdient.' },
  // --- Top Vier ------------------------------------------------------------
  // Kanto hatte sie von Anfang an, Johto nicht. Vier Prüfungen zwischen dem
  // letzten Orden und dem Meister — sonst wäre der zweite Weg kürzer als der
  // erste, obwohl er der schwerere sein soll.
  { id: 'elite-will', name: 'Will', title: 'Top Vier · Psycho', kind: 'elite', rewardGold: 14000,
    team: [{ speciesId: 'xatu', level: 88 }, { speciesId: 'jynx', level: 88 }, { speciesId: 'slowbro', level: 90 }, { speciesId: 'exeggutor', level: 92 }],
    intro: 'Ich habe mein Leben lang trainiert, um perfekt zu sein. Zeig mir, dass Perfektion nicht reicht.',
    win: 'Der Geist ist stärker als der Körper.', lose: 'Perfektion war offenbar nicht genug.' },
  { id: 'elite-koga', name: 'Koga', title: 'Top Vier · Gift', kind: 'elite', rewardGold: 15000,
    team: [{ speciesId: 'ariados', level: 89 }, { speciesId: 'venomoth', level: 89 }, { speciesId: 'forretress', level: 91 }, { speciesId: 'crobat', level: 93 }],
    intro: 'Gift wirkt langsam. Es wirkt trotzdem.',
    win: 'Die Zeit hat für mich gearbeitet.', lose: 'Schneller als das Gift. Bemerkenswert.' },
  { id: 'elite-bruno-j', name: 'Bruno', title: 'Top Vier · Kampf', kind: 'elite', rewardGold: 16000,
    team: [{ speciesId: 'hitmontop', level: 90 }, { speciesId: 'hitmonlee', level: 90 }, { speciesId: 'hitmonchan', level: 92 }, { speciesId: 'machamp', level: 94 }],
    intro: 'Wir sehen uns wieder. Diesmal ist mein Team gewachsen.',
    win: 'Rohe Kraft entscheidet doch.', lose: 'Zweimal. Das war kein Zufall.' },
  { id: 'elite-karen', name: 'Melanie', title: 'Top Vier · Unlicht', kind: 'elite', rewardGold: 18000,
    team: [{ speciesId: 'umbreon', level: 91 }, { speciesId: 'murkrow', level: 91 }, { speciesId: 'gengar', level: 93 }, { speciesId: 'houndoom', level: 95 }],
    intro: 'Starke Pokémon. Schwache Pokémon. Das ist die selbstsüchtige Sicht der Menschen.',
    win: 'Kämpf mit deinen Liebsten, nicht mit den Stärksten.', lose: 'Du kämpfst mit denen, die du magst. Das gefällt mir.' },

  // --- Event-Gegner --------------------------------------------------------
  // Tauchen nicht auf der Karte auf, sondern beim Erkunden. Deshalb ohne
  // Gebietszuordnung — die Safari ruft sie direkt auf.
  { id: 'event-rocket-johto', name: 'Rocket-Kommandant', title: 'Überfall in Johto', kind: 'trainer', rewardGold: 6000,
    team: [{ speciesId: 'houndoom', level: 78 }, { speciesId: 'weezing', level: 78 }, { speciesId: 'crobat', level: 80 }],
    intro: 'Das Gebiet gehört jetzt uns. Verschwinde — oder kämpf.',
    win: 'Wie erwartet. Nimm es nicht persönlich.', lose: 'Rückzug! Das ist noch nicht vorbei.' },

  { id: 'champion-lance', name: 'Siegfried', title: 'Champion von Johto', kind: 'champion', badgeId: 'johto-crown', rewardGold: 30000,
    team: [{ speciesId: 'gyarados', level: 86 }, { speciesId: 'charizard', level: 86 }, { speciesId: 'aerodactyl', level: 88 },
           { speciesId: 'dragonite', level: 90 }, { speciesId: 'dragonair', level: 88 }, { speciesId: 'lapras', level: 88 }],
    intro: 'Du bist weit gekommen. Weiter als die meisten. Zeig mir, ob es reicht.',
    win: 'Noch nicht. Aber bald.', lose: 'Zwei Regionen. Du gehörst wirklich hierher.' },

  { id: 'trainer-johto-sage', name: 'Weiser Li', title: 'Turmweiser', kind: 'trainer', rewardGold: 3000,
    team: [{ speciesId: 'bellsprout', level: 62 }, { speciesId: 'weepinbell', level: 64 }],
    intro: 'Geduld ist auch eine Waffe.', win: 'Zu hastig.', lose: 'Du hast gelernt zu warten.' },
  { id: 'trainer-johto-kimono', name: 'Kimono-Mädchen Sayo', title: 'Tänzerin', kind: 'trainer', rewardGold: 4200,
    team: [{ speciesId: 'flareon', level: 70 }, { speciesId: 'vaporeon', level: 70 }, { speciesId: 'jolteon', level: 70 }],
    intro: 'Ein Kampf ist auch ein Tanz. Führ mich.', win: 'Du bist aus dem Takt.', lose: 'Wunderschön gekämpft.' },
  { id: 'trainer-johto-rocket', name: 'Rocket-Offizier', title: 'Team Rocket', kind: 'trainer', rewardGold: 5000,
    team: [{ speciesId: 'houndour', level: 72 }, { speciesId: 'muk', level: 74 }, { speciesId: 'weezing', level: 74 }],
    intro: 'Der Boss ist weg. Wir sind es nicht.', win: 'Rocket vergisst nichts.', lose: 'Diesmal … diesmal nicht.' },
]

export const JOHTO_TRAINERS = SEEDS.map((t) => ({
  id: t.id,
  name: { de: t.name },
  title: { de: t.title },
  kind: t.kind,
  sprite: `/media/trainers/${t.id}.svg`,
  team: t.team,
  badgeId: t.badgeId ?? null,
  rewardGold: t.rewardGold,
  repeatRewardRatio: t.kind === 'trainer' ? 0.25 : 0.15,
  dialogue: { intro: { de: t.intro }, win: { de: t.win }, lose: { de: t.lose } },
}))

const s = (
  speciesId: string, weight: number, minLevel: number, maxLevel: number,
  extra: { t?: string[]; w?: string[] } = {},
) => ({
  speciesId, weight, minLevel, maxLevel,
  ...(extra.t ? { timeOfDay: extra.t } : {}),
  ...(extra.w ? { weather: extra.w } : {}),
})

export const JOHTO_AREAS: AreaOut[] = [
  {
    id: 'route-29', regionId: 'johto', order: 1,
    name: { de: 'Route 29' },
    description: { de: 'Der Weg nach Johto. Vertrautes Gras, unbekannte Bewohner.' },
    icon: '/media/areas/route-29.png', background: '/media/areas/route-29-bg.png',
    /*
     * Kein Vorgänger, keine Bedingung.
     *
     * Früher hing Johtos Einstieg an Kantos Krone — die Regionen waren eine
     * Kette. Seit die Startregion frei wählbar ist und die Skalierung eine
     * ganze Region auf das Niveau ihres Besuchers hebt, wäre das eine Tür, die
     * es nicht mehr geben darf. Jede Region beginnt für sich.
     */
    unlock: {
      previousAreaId: null, minCaughtInPrevious: 0,
      minCreaturesAtLevel: null,
      requiredBadgeIds: [],
    },
    spawns: [
      s('sentret', 30, 58, 64), s('hoothoot', 26, 58, 64, { t: ['dusk', 'night'] }),
      s('pidgey', 20, 58, 64), s('rattata', 16, 58, 64),
      s('ledyba', 8, 58, 64, { t: ['dawn', 'day'] }),
    ],
    trainerIds: [], gymId: 'gym-falkner',
  },
  {
    id: 'ilex-forest', regionId: 'johto', order: 2,
    name: { de: 'Ilex-Wald' },
    description: { de: 'Ein Schrein zwischen den Bäumen. Nachts hört man Flöten.' },
    icon: '/media/areas/ilex-forest.png', background: '/media/areas/ilex-forest-bg.png',
    unlock: { previousAreaId: 'route-29', minCaughtInPrevious: 4, minCreaturesAtLevel: null, requiredBadgeIds: ['zephyr-badge'] },
    spawns: [
      s('caterpie', 22, 60, 66), s('weedle', 22, 60, 66),
      s('paras', 18, 60, 66), s('spinarak', 16, 60, 66, { t: ['night'] }),
      s('pineco', 12, 62, 68), s('scyther', 6, 64, 70, { t: ['dawn', 'day'] }),
      s('celebi', 1, 70, 70, { t: ['dawn'], w: ['fog'] }),
    ],
    trainerIds: ['trainer-johto-sage'], gymId: 'gym-bugsy',
  },
  {
    id: 'national-park', regionId: 'johto', order: 3,
    name: { de: 'Nationalpark' },
    description: { de: 'Gepflegte Wiesen, in denen einmal im Monat der Käferwettbewerb tobt.' },
    icon: '/media/areas/national-park.png', background: '/media/areas/national-park-bg.png',
    unlock: { previousAreaId: 'ilex-forest', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 4, level: 66 }, requiredBadgeIds: ['hive-badge'] },
    spawns: [
      s('sunkern', 24, 64, 70, { t: ['dawn', 'day'] }), s('hoppip', 22, 64, 70),
      s('venonat', 18, 64, 70), s('psyduck', 14, 64, 70, { w: ['rain'] }),
      s('nidoran-f', 12, 64, 70), s('scyther', 6, 66, 72), s('pinsir', 4, 66, 72),
      s('raikou', 1, 70, 72, { w: ['storm'] }),
    ],
    trainerIds: ['trainer-johto-kimono'], gymId: 'gym-whitney',
  },
  {
    id: 'burned-tower', regionId: 'johto', order: 4,
    name: { de: 'Abgebrannter Turm' },
    description: { de: 'Verkohlte Balken und ein Keller, in dem etwas atmet.' },
    icon: '/media/areas/burned-tower.png', background: '/media/areas/burned-tower-bg.png',
    unlock: { previousAreaId: 'national-park', minCaughtInPrevious: 5, minCreaturesAtLevel: null, requiredBadgeIds: ['plain-badge'] },
    spawns: [
      s('rattata', 24, 66, 72), s('koffing', 22, 66, 72),
      s('gastly', 20, 66, 72, { t: ['dusk', 'night'] }), s('magmar', 14, 68, 74, { w: ['heat'] }),
      s('murkrow', 12, 68, 74, { t: ['night'] }), s('haunter', 8, 70, 76, { t: ['night'] }),
      s('entei', 1, 74, 76, { w: ['heat'] }),
    ],
    trainerIds: [], gymId: 'gym-morty',
  },
  {
    id: 'whirl-islands', regionId: 'johto', order: 5,
    name: { de: 'Strudelinseln' },
    description: { de: 'Vier Inseln, ein Höhlensystem, und darin ein Lied.' },
    icon: '/media/areas/whirl-islands.png', background: '/media/areas/whirl-islands-bg.png',
    unlock: { previousAreaId: 'burned-tower', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 5, level: 72 }, requiredBadgeIds: ['fog-badge'] },
    spawns: [
      s('krabby', 24, 70, 76), s('tentacool', 22, 70, 76),
      s('horsea', 18, 70, 76), s('seadra', 14, 72, 78),
      s('golbat', 12, 72, 78, { t: ['night'] }), s('lapras', 8, 74, 80),
      s('lugia', 1, 80, 80, { w: ['storm'] }),
    ],
    trainerIds: [], gymId: 'gym-chuck',
  },
  {
    id: 'mt-mortar', regionId: 'johto', order: 6,
    name: { de: 'Steinturmberg' },
    description: { de: 'Ein Berg voller Fäuste. Wer hier trainiert, redet wenig.' },
    icon: '/media/areas/mt-mortar.png', background: '/media/areas/mt-mortar-bg.png',
    unlock: { previousAreaId: 'whirl-islands', minCaughtInPrevious: 5, minCreaturesAtLevel: null, requiredBadgeIds: ['storm-badge'] },
    spawns: [
      s('machop', 24, 74, 80), s('geodude', 22, 74, 80),
      s('machoke', 18, 76, 82), s('graveler', 16, 76, 82),
      s('golbat', 12, 74, 80), s('tyrogue', 8, 76, 82, { t: ['dawn'] }),
      s('suicune', 1, 80, 82, { w: ['rain'] }),
    ],
    trainerIds: ['trainer-johto-rocket'], gymId: 'gym-pryce',
  },
  {
    id: 'dragons-den', regionId: 'johto', order: 7,
    name: { de: 'Drachenhöhle' },
    description: { de: 'Warmes Wasser tief unter Ebenholz. Hier prüfen die Ältesten.' },
    icon: '/media/areas/dragons-den.png', background: '/media/areas/dragons-den-bg.png',
    unlock: { previousAreaId: 'mt-mortar', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 6, level: 78 }, requiredBadgeIds: ['glacier-badge'] },
    spawns: [
      s('dratini', 30, 78, 84), s('magikarp', 24, 78, 84),
      s('dragonair', 18, 82, 88), s('gyarados', 14, 82, 88, { w: ['storm'] }),
      s('horsea', 12, 78, 84), s('dragonite', 2, 86, 90, { t: ['night'] }),
    ],
    trainerIds: [], gymId: 'gym-clair',
  },
  {
    id: 'mt-silver', regionId: 'johto', order: 8,
    name: { de: 'Silberberg' },
    description: { de: 'Der höchste Punkt beider Regionen. Ganz oben wartet jemand, der nichts sagt.' },
    icon: '/media/areas/mt-silver.png', background: '/media/areas/mt-silver-bg.png',
    unlock: {
      previousAreaId: 'dragons-den', minCaughtInPrevious: 5,
      minCreaturesAtLevel: { count: 6, level: 84 },
      requiredBadgeIds: ['zephyr-badge', 'hive-badge', 'plain-badge', 'fog-badge', 'storm-badge', 'glacier-badge', 'rising-badge'],
    },
    spawns: [
      s('golbat', 20, 84, 90), s('graveler', 18, 84, 90),
      s('onix', 16, 84, 90), s('parasect', 14, 84, 90),
      s('donphan', 12, 86, 92), s('larvitar', 10, 86, 92),
      s('misdreavus', 6, 86, 92, { t: ['night'] }),
      s('snorlax', 4, 88, 94, { t: ['night'] }),
    ],
    trainerIds: ['elite-will', 'elite-koga', 'elite-bruno-j', 'elite-karen', 'trainer-johto-kimono'],
    gymId: 'champion-lance',
  },

  // --- Nach der Liga --------------------------------------------------------
  {
    id: 'tin-tower', regionId: 'johto', order: 9,
    name: { de: 'Zinnturm' },
    description: { de: 'Neun Stockwerke, und auf jedem wird es stiller. Ganz oben soll etwas warten.' },
    icon: '/media/areas/tin-tower.png', background: '/media/areas/tin-tower-bg.png',
    unlock: {
      previousAreaId: 'mt-silver', minCaughtInPrevious: 3,
      minCreaturesAtLevel: { count: 5, level: 86 }, requiredBadgeIds: ['johto-crown'],
    },
    spawns: [
      s('haunter', 20, 86, 92), s('noctowl', 18, 86, 92),
      s('girafarig', 16, 88, 94), s('misdreavus', 14, 88, 94),
      s('murkrow', 12, 88, 94, { t: ['night'] }),
      s('umbreon', 8, 90, 96, { t: ['night'] }),
      s('espeon', 8, 90, 96, { t: ['day'] }),
      s('gengar', 4, 92, 98),
      s('ho-oh', 1, 96, 98, { w: ['rain'] }),
    ],
    trainerIds: [],
  },
  {
    id: 'silver-chamber', regionId: 'johto', order: 10,
    name: { de: 'Silberkammer' },
    description: { de: 'Tief unter dem Silberberg. Die Luft steht, und der Boden zittert im Takt.' },
    icon: '/media/areas/silver-chamber.png', background: '/media/areas/silver-chamber-bg.png',
    unlock: {
      previousAreaId: 'tin-tower', minCaughtInPrevious: 4,
      minCreaturesAtLevel: { count: 6, level: 90 }, requiredBadgeIds: ['johto-crown'],
    },
    spawns: [
      s('larvitar', 20, 90, 96), s('pupitar', 18, 92, 98),
      s('donphan', 16, 92, 98), s('ursaring', 14, 92, 98),
      s('skarmory', 12, 94, 100), s('magmar', 10, 94, 100),
      s('tyranitar', 6, 96, 100), s('dragonite', 4, 96, 100, { t: ['night'] }),
    ],
    trainerIds: [],
  },
]


export const JOHTO_CHAPTERS = [
  {
    id: 'ch-9-new-region', order: 9,
    guide: { de: 'Prof. Lind' },
    title: { de: 'Über die Grenze' },
    intro: { de: 'Kanto war deine Ausbildung. Johto ist deine Prüfung. Die Pokémon hier kennen dich nicht — und deinen Ruf schon gar nicht.' },
    outro: { de: 'Du hast in einer fremden Region Fuß gefasst. Das können wenige.' },
    requires: [{ kind: 'areaVisited', value: 'route-29' }, { kind: 'dexCaught', value: 80 }],
    reward: { gold: 5000, itemId: 'ultra-ball', quantity: 15 },
  },
  {
    id: 'ch-10-johto-league', order: 10,
    guide: { de: 'Prof. Lind' },
    title: { de: 'Sieben neue Orden' },
    intro: { de: 'Sieben Arenen, sieben Arten sich zu irren. Johtos Leiter kämpfen anders als Kantos.' },
    outro: { de: 'Fünfzehn Orden. Du bist keine Trainerin mehr, du bist eine Reisende.' },
    requires: [{ kind: 'badges', value: 16 }],
    reward: { gold: 25000, itemId: 'rare-candy', quantity: 15 },
  },
]

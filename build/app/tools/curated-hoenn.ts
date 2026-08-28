/**
 * Hoenn: die dritte Region.
 *
 * Entworfen als eigene Stufe, nicht als Fortsetzung. Seit die Startregion frei
 * wählbar ist, senkt die Skalierung eine ganze Region einmalig auf das Niveau
 * dessen, der sie betritt — die *entworfenen* Level sagen deshalb nur noch, für
 * wen die Region gedacht ist, wenn er auf Augenhöhe ankommt.
 *
 * Und das ist hier jemand, der Kanto und Johto hinter sich hat: Einstieg 96,
 * Ende 150, Meister auf 156. Wer Hoenn dagegen als Erstes wählt, findet sie um
 * 94 Level gesenkt vor — Route 101 auf 2–8, den Meister auf 62 — und damit
 * genau innerhalb seiner ersten Reisegrenze von 100.
 *
 * Zu den Namen: die deutschen Orts- und Personennamen sind übernommen, wo sie
 * mir sicher waren. Wo nicht, steht ein beschreibender deutscher Name statt
 * einer falschen Behauptung.
 */
import type { AreaOut } from './curated-kanto.ts'

export const HOENN_REGION = {
  id: 'hoenn', order: 3,
  name: { de: 'Hoenn' },
  tagline: { de: 'Zwischen Vulkan und Tiefsee.' },
  starterSpeciesIds: ['treecko', 'torchic', 'mudkip'],
}

export const HOENN_BADGES = [
  { id: 'stone-badge',   name: { de: 'Steinorden' },   description: { de: 'Von Felizia in Metronia City.' },   icon: '/media/badges/stone.png',   obedienceLevel: 150 },
  { id: 'knuckle-badge', name: { de: 'Faustorden' },   description: { de: 'Von Kamillo auf Faustauhaven.' },   icon: '/media/badges/knuckle.png', obedienceLevel: 150 },
  { id: 'dynamo-badge',  name: { de: 'Dynamoorden' },  description: { de: 'Von Walter in Malvenfroh City.' },  icon: '/media/badges/dynamo.png',  obedienceLevel: 150 },
  { id: 'heat-badge',    name: { de: 'Hitzeorden' },   description: { de: 'Von Flavia in Bad Lavastadt.' },    icon: '/media/badges/heat.png',    obedienceLevel: 150 },
  { id: 'balance-badge', name: { de: 'Balanceorden' }, description: { de: 'Von Norman in Blütenburg City.' },  icon: '/media/badges/balance.png', obedienceLevel: 150 },
  { id: 'feather-badge', name: { de: 'Federorden' },   description: { de: 'Von Wibke in Baumhausen City.' },   icon: '/media/badges/feather.png', obedienceLevel: 150 },
  { id: 'mind-badge',    name: { de: 'Gedankenorden' }, description: { de: 'Von Ben und Svenja in Moosbach City.' }, icon: '/media/badges/mind.png', obedienceLevel: 150 },
  { id: 'rain-badge',    name: { de: 'Regenorden' },   description: { de: 'Von Wassili in Wolkenschloss City.' }, icon: '/media/badges/rain.png',  obedienceLevel: 150 },
  { id: 'hoenn-crown',   name: { de: 'Krone von Hoenn' }, description: { de: 'Für den Sieg über Hoenns Meister.' }, icon: '/media/badges/hoenn-crown.png', obedienceLevel: 150 },
]

interface TrainerSeed {
  id: string; name: string; title: string
  kind: 'trainer' | 'gym' | 'elite' | 'champion'
  team: Array<{ speciesId: string; level: number }>
  badgeId?: string; rewardGold: number
  intro: string; win: string; lose: string
}

const SEEDS: TrainerSeed[] = [
  // --- Arenen ---------------------------------------------------------------
  // Der Abstand zur Obergrenze ihres Gebiets ist die Aussage: ein Arenaleiter
  // steht zwei bis vier Level darüber, ein Routentrainer darunter. Die
  // Skalierung verschiebt alle zusammen und lässt diese Abstände stehen.
  { id: 'gym-roxanne', name: 'Felizia', title: 'Leiterin der Metronia-Arena', kind: 'gym', badgeId: 'stone-badge', rewardGold: 16000,
    team: [{ speciesId: 'geodude', level: 104 }, { speciesId: 'nosepass', level: 106 }, { speciesId: 'aron', level: 108 }],
    intro: 'Ich unterrichte Geologie. Heute ist Praxis.',
    win: 'Gestein hält. Das ist seine ganze Aufgabe.', lose: 'Gut gelesen. Der Steinorden gehört dir.' },
  { id: 'gym-brawly', name: 'Kamillo', title: 'Leiter der Faustauhaven-Arena', kind: 'gym', badgeId: 'knuckle-badge', rewardGold: 17000,
    team: [{ speciesId: 'machop', level: 108 }, { speciesId: 'makuhita', level: 110 }, { speciesId: 'hariyama', level: 112 }],
    intro: 'Große Welle, kleines Brett. Mal sehen, wie du stehst.',
    win: 'Runtergefallen.', lose: 'Du bleibst oben. Respekt — und der Faustorden.' },
  { id: 'gym-wattson', name: 'Walter', title: 'Leiter der Malvenfroh-Arena', kind: 'gym', badgeId: 'dynamo-badge', rewardGold: 18000,
    team: [{ speciesId: 'electrike', level: 112 }, { speciesId: 'magneton', level: 114 }, { speciesId: 'manectric', level: 116 }],
    intro: 'Wa-ha-ha! Ich habe diese Stadt verkabelt. Auch diesen Boden.',
    win: 'Wa-ha-ha! Noch mal von vorn!', lose: 'Wa-ha! Genug Saft für den Dynamoorden.' },
  { id: 'gym-flannery', name: 'Flavia', title: 'Leiterin der Lavastadt-Arena', kind: 'gym', badgeId: 'heat-badge', rewardGold: 19000,
    team: [{ speciesId: 'numel', level: 116 }, { speciesId: 'slugma', level: 118 }, { speciesId: 'torkoal', level: 120 }],
    intro: 'Ich bin neu hier. Das heißt nicht, dass ich nachsichtig bin.',
    win: 'Meine Großmutter wäre stolz.', lose: 'Neu und geschlagen. Der Hitzeorden ist deiner.' },
  { id: 'gym-norman', name: 'Norman', title: 'Leiter der Blütenburg-Arena', kind: 'gym', badgeId: 'balance-badge', rewardGold: 20000,
    team: [{ speciesId: 'spinda', level: 120 }, { speciesId: 'vigoroth', level: 122 }, { speciesId: 'slaking', level: 124 }],
    intro: 'Ich kämpfe gegen jeden gleich. Auch gegen dich.',
    win: 'Noch nicht so weit.', lose: 'Du hast mich geschlagen. Ehrlich geschlagen.' },
  { id: 'gym-winona', name: 'Wibke', title: 'Leiterin der Baumhausen-Arena', kind: 'gym', badgeId: 'feather-badge', rewardGold: 21000,
    team: [{ speciesId: 'swablu', level: 124 }, { speciesId: 'tropius', level: 126 }, { speciesId: 'swellow', level: 126 }, { speciesId: 'altaria', level: 128 }],
    intro: 'Ich bin mit dem Himmel verwachsen. Du kämpfst gegen ihn.',
    win: 'Der Himmel bleibt oben.', lose: 'Du fliegst. Nimm den Federorden.' },
  { id: 'gym-tate-liza', name: 'Ben & Svenja', title: 'Leiter der Moosbach-Arena', kind: 'gym', badgeId: 'mind-badge', rewardGold: 22000,
    team: [{ speciesId: 'lunatone', level: 128 }, { speciesId: 'solrock', level: 128 }, { speciesId: 'xatu', level: 130 }, { speciesId: 'claydol', level: 132 }],
    intro: 'Wir wissen schon, was du vorhast. — Wir wissen es beide.',
    win: 'Wir haben es kommen sehen.', lose: 'Das … haben wir nicht kommen sehen.' },
  { id: 'gym-wallace', name: 'Wassili', title: 'Leiter der Wolkenschloss-Arena', kind: 'gym', badgeId: 'rain-badge', rewardGold: 24000,
    team: [{ speciesId: 'luvdisc', level: 130 }, { speciesId: 'whiscash', level: 132 }, { speciesId: 'sealeo', level: 134 }, { speciesId: 'milotic', level: 136 }],
    intro: 'Ein Kampf soll schön sein. Beeindrucke mich.',
    win: 'Kraftvoll. Aber nicht schön.', lose: 'Das war Kunst. Der Regenorden ist deiner.' },

  // --- Top Vier -------------------------------------------------------------
  { id: 'elite-sidney', name: 'Anton', title: 'Top Vier · Unlicht', kind: 'elite', rewardGold: 30000,
    team: [{ speciesId: 'mightyena', level: 140 }, { speciesId: 'shiftry', level: 140 }, { speciesId: 'cacturne', level: 142 }, { speciesId: 'absol', level: 144 }],
    intro: 'Kein großes Gerede. Fangen wir an.',
    win: 'War ein guter Kampf. Für mich.', lose: 'Ha! Genau das wollte ich sehen.' },
  { id: 'elite-phoebe', name: 'Antonia', title: 'Top Vier · Geist', kind: 'elite', rewardGold: 32000,
    team: [{ speciesId: 'dusclops', level: 142 }, { speciesId: 'banette', level: 142 }, { speciesId: 'sableye', level: 144 }, { speciesId: 'gengar', level: 146 }],
    intro: 'Ich habe auf dem Berg der Ahnen gelernt zu reden. Mit denen, die dort bleiben.',
    win: 'Sie flüstern, dass du wiederkommst.', lose: 'Sie mögen dich. Das sagt viel.' },
  { id: 'elite-glacia', name: 'Frieda', title: 'Top Vier · Eis', kind: 'elite', rewardGold: 34000,
    team: [{ speciesId: 'glalie', level: 144 }, { speciesId: 'sealeo', level: 144 }, { speciesId: 'walrein', level: 146 }, { speciesId: 'lapras', level: 148 }],
    intro: 'Ich kam wegen der Hitze hierher. Man lernt Kälte erst im Warmen schätzen.',
    win: 'Noch zu warm.', lose: 'Deine Hitze hat mein Eis geschmolzen.' },
  { id: 'elite-drake', name: 'Wenzel', title: 'Top Vier · Drache', kind: 'elite', rewardGold: 36000,
    team: [{ speciesId: 'shelgon', level: 146 }, { speciesId: 'altaria', level: 146 }, { speciesId: 'flygon', level: 148 }, { speciesId: 'salamence', level: 150 }],
    intro: 'Weißt du, was einen Trainer und sein Pokémon verbindet? Zeig es mir.',
    win: 'Du weißt es noch nicht.', lose: 'Du weißt es. Geh weiter.' },

  { id: 'champion-steven', name: 'Troy', title: 'Champion von Hoenn', kind: 'champion', badgeId: 'hoenn-crown', rewardGold: 60000,
    team: [{ speciesId: 'skarmory', level: 150 }, { speciesId: 'claydol', level: 150 }, { speciesId: 'aggron', level: 152 },
           { speciesId: 'cradily', level: 152 }, { speciesId: 'armaldo', level: 154 }, { speciesId: 'metagross', level: 156 }],
    intro: 'Ich sammle seltene Steine. Und seltene Trainer. Zeig mir, welcher du bist.',
    win: 'Noch nicht selten genug.', lose: 'Drei Regionen. Du bist der seltenste Fund, den ich je gemacht habe.' },

  // --- Ereignis-Gegner ------------------------------------------------------
  // Ohne Gebietszuordnung: die Safari ruft sie beim Erkunden direkt auf.
  { id: 'event-magma-hoenn', name: 'Magma-Rüpel', title: 'Überfall in Hoenn', kind: 'trainer', rewardGold: 14000,
    team: [{ speciesId: 'numel', level: 126 }, { speciesId: 'mightyena', level: 126 }, { speciesId: 'camerupt', level: 128 }],
    intro: 'Dieses Land will wachsen. Du stehst im Weg.',
    win: 'Mehr Land. Weniger Meer.', lose: 'Der Boss hört davon!' },
  { id: 'event-aqua-hoenn', name: 'Aqua-Rüpel', title: 'Überfall in Hoenn', kind: 'trainer', rewardGold: 14000,
    team: [{ speciesId: 'carvanha', level: 126 }, { speciesId: 'golbat', level: 126 }, { speciesId: 'sharpedo', level: 128 }],
    intro: 'Das Meer nimmt sich zurück, was ihm gehört. Auch dich.',
    win: 'Steigende Pegel, sinkende Chancen.', lose: 'Rückzug! Ins Wasser!' },

  // --- Routentrainer --------------------------------------------------------
  { id: 'trainer-hoenn-ranger', name: 'Rangerin Mira', title: 'Waldhüterin', kind: 'trainer', rewardGold: 8000,
    team: [{ speciesId: 'breloom', level: 108 }, { speciesId: 'linoone', level: 110 }],
    intro: 'Der Wald merkt sich, wer sich benimmt.', win: 'Nicht heute.', lose: 'Der Wald merkt sich auch dich.' },
  { id: 'trainer-hoenn-diver', name: 'Taucher Kai', title: 'Tiefseetaucher', kind: 'trainer', rewardGold: 10000,
    team: [{ speciesId: 'wailmer', level: 128 }, { speciesId: 'clamperl', level: 128 }, { speciesId: 'crawdaunt', level: 130 }],
    intro: 'Unten ist es still. Hier oben rede ich zu viel.', win: 'Zu wenig Luft.', lose: 'Du hältst länger durch als ich.' },
  { id: 'trainer-hoenn-mystic', name: 'Ahnenwächter Ruben', title: 'Berg der Ahnen', kind: 'trainer', rewardGold: 11000,
    team: [{ speciesId: 'shuppet', level: 130 }, { speciesId: 'duskull', level: 130 }, { speciesId: 'banette', level: 132 }],
    intro: 'Leise. Sie schlafen nicht, sie hören zu.', win: 'Sie haben mitgekämpft.', lose: 'Sie haben zugesehen. Und dich gemocht.' },
]

export const HOENN_TRAINERS = SEEDS.map((t) => ({
  id: t.id,
  name: { de: t.name },
  title: { de: t.title },
  kind: t.kind,
  sprite: `/media/trainers/${t.id}.png`,
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

export const HOENN_AREAS: AreaOut[] = [
  {
    id: 'route-101', regionId: 'hoenn', order: 1,
    name: { de: 'Route 101' },
    description: { de: 'Kniehohes Gras zwischen Wurzelheim und dem Rest der Welt.' },
    icon: '/media/areas/route-101.png', background: '/media/areas/route-101-bg.png',
    // Ohne Vorbedingung: Hoenn ist eine eigene Startregion, keine Belohnung.
    unlock: { previousAreaId: null, minCaughtInPrevious: 0, minCreaturesAtLevel: null, requiredBadgeIds: [] },
    spawns: [
      s('poochyena', 28, 96, 102), s('zigzagoon', 26, 96, 102),
      s('wurmple', 20, 96, 102), s('taillow', 14, 96, 102, { t: ['dawn', 'day'] }),
      s('lotad', 12, 96, 102, { w: ['rain'] }),
    ],
    trainerIds: [],
  },
  {
    id: 'petalburg-woods', regionId: 'hoenn', order: 2,
    name: { de: 'Wald von Blütenburg' },
    description: { de: 'Feuchtes Dickicht. Irgendwo darin sammelt jemand Pilze.' },
    icon: '/media/areas/petalburg-woods.png', background: '/media/areas/petalburg-woods-bg.png',
    unlock: { previousAreaId: 'route-101', minCaughtInPrevious: 4, minCreaturesAtLevel: null, requiredBadgeIds: [] },
    spawns: [
      s('shroomish', 26, 100, 106), s('silcoon', 20, 100, 106, { t: ['day'] }),
      s('cascoon', 20, 100, 106, { t: ['night'] }), s('seedot', 16, 100, 106),
      s('slakoth', 12, 100, 106), s('nincada', 6, 102, 108, { t: ['dawn'] }),
    ],
    trainerIds: ['trainer-hoenn-ranger'], gymId: 'gym-roxanne',
  },
  {
    id: 'granite-cave', regionId: 'hoenn', order: 3,
    name: { de: 'Granitgrotte' },
    description: { de: 'Drei Ebenen tief, und ganz unten leuchtet das Moos.' },
    icon: '/media/areas/granite-cave.png', background: '/media/areas/granite-cave-bg.png',
    unlock: { previousAreaId: 'petalburg-woods', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 4, level: 104 }, requiredBadgeIds: ['stone-badge'] },
    spawns: [
      s('makuhita', 24, 104, 110), s('geodude', 22, 104, 110),
      s('aron', 18, 104, 110), s('sableye', 14, 106, 112, { t: ['night'] }),
      s('mawile', 12, 106, 112), s('nosepass', 10, 106, 112),
    ],
    trainerIds: [], gymId: 'gym-brawly',
  },
  {
    id: 'cycling-road', regionId: 'hoenn', order: 4,
    name: { de: 'Radweg' },
    description: { de: 'Eine Betonschleife über der Ebene. Unten weidet, was nicht rauf will.' },
    icon: '/media/areas/cycling-road.png', background: '/media/areas/cycling-road-bg.png',
    unlock: { previousAreaId: 'granite-cave', minCaughtInPrevious: 5, minCreaturesAtLevel: null, requiredBadgeIds: ['knuckle-badge'] },
    spawns: [
      s('electrike', 26, 108, 114), s('plusle', 18, 108, 114, { t: ['day'] }),
      s('minun', 18, 108, 114, { t: ['day'] }), s('magnemite', 16, 108, 114),
      s('voltorb', 12, 110, 116), s('gulpin', 10, 110, 116),
    ],
    trainerIds: [], gymId: 'gym-wattson',
  },
  {
    id: 'mt-chimney', regionId: 'hoenn', order: 5,
    name: { de: 'Kraterberg' },
    description: { de: 'Der Krater raucht seit Jahren. Die Seilbahn fährt trotzdem.' },
    icon: '/media/areas/mt-chimney.png', background: '/media/areas/mt-chimney-bg.png',
    unlock: { previousAreaId: 'cycling-road', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 5, level: 112 }, requiredBadgeIds: ['dynamo-badge'] },
    spawns: [
      s('numel', 26, 112, 118), s('slugma', 22, 112, 118, { w: ['heat'] }),
      s('machop', 18, 112, 118), s('graveler', 14, 114, 120),
      s('torkoal', 12, 114, 120, { w: ['heat'] }), s('camerupt', 8, 116, 122),
    ],
    trainerIds: [], gymId: 'gym-flannery',
  },
  {
    id: 'route-119', regionId: 'hoenn', order: 6,
    name: { de: 'Dschungelroute' },
    description: { de: 'Hier regnet es fast immer. Das hohe Gras steht über Kopfhöhe.' },
    icon: '/media/areas/route-119.png', background: '/media/areas/route-119-bg.png',
    unlock: { previousAreaId: 'mt-chimney', minCaughtInPrevious: 5, minCreaturesAtLevel: null, requiredBadgeIds: ['heat-badge'] },
    spawns: [
      s('linoone', 22, 116, 122), s('tropius', 18, 116, 122),
      s('kecleon', 16, 116, 122), s('surskit', 14, 116, 122, { w: ['rain'] }),
      s('ludicolo', 12, 118, 124, { w: ['rain'] }), s('breloom', 10, 118, 124),
      s('feebas', 4, 118, 124, { w: ['rain'] }),
    ],
    trainerIds: ['trainer-hoenn-ranger'], gymId: 'gym-norman',
  },
  {
    id: 'weather-institute', regionId: 'hoenn', order: 7,
    name: { de: 'Wetterinstitut' },
    description: { de: 'Vier Stockwerke Messtechnik. Draußen ändert sich das Wetter trotzdem, wie es will.' },
    icon: '/media/areas/weather-institute.png', background: '/media/areas/weather-institute-bg.png',
    unlock: { previousAreaId: 'route-119', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 5, level: 120 }, requiredBadgeIds: ['balance-badge'] },
    spawns: [
      s('swablu', 24, 120, 126), s('swellow', 20, 120, 126),
      s('pelipper', 18, 120, 126, { w: ['rain'] }), s('castform', 14, 120, 126),
      s('altaria', 12, 122, 128), s('vibrava', 12, 122, 128, { w: ['sandstorm'] }),
    ],
    trainerIds: [], gymId: 'gym-winona',
  },
  {
    id: 'mt-pyre', regionId: 'hoenn', order: 8,
    name: { de: 'Berg der Ahnen' },
    description: { de: 'Ein Friedhof für Pokémon, gestapelt in sechs Stockwerken. Oben ist es windstill.' },
    icon: '/media/areas/mt-pyre.png', background: '/media/areas/mt-pyre-bg.png',
    unlock: { previousAreaId: 'weather-institute', minCaughtInPrevious: 5, minCreaturesAtLevel: null, requiredBadgeIds: ['feather-badge'] },
    spawns: [
      s('shuppet', 24, 124, 130, { t: ['dusk', 'night'] }), s('duskull', 22, 124, 130, { t: ['night'] }),
      s('vulpix', 16, 124, 130), s('chimecho', 14, 126, 132),
      s('banette', 12, 126, 132, { t: ['night'] }), s('dusclops', 12, 128, 134),
    ],
    trainerIds: ['trainer-hoenn-mystic'], gymId: 'gym-tate-liza',
  },
  {
    id: 'seafloor-cavern', regionId: 'hoenn', order: 9,
    name: { de: 'Höhle des Meeresgrunds' },
    description: { de: 'Nur tauchend erreichbar. Der Gang endet vor einer Tür, die älter ist als die Stadt darüber.' },
    icon: '/media/areas/seafloor-cavern.png', background: '/media/areas/seafloor-cavern-bg.png',
    unlock: { previousAreaId: 'mt-pyre', minCaughtInPrevious: 5, minCreaturesAtLevel: { count: 6, level: 128 }, requiredBadgeIds: ['mind-badge'] },
    spawns: [
      s('carvanha', 22, 128, 134), s('wailmer', 20, 128, 134),
      s('clamperl', 18, 128, 134), s('corphish', 16, 128, 134),
      s('sharpedo', 12, 130, 136), s('relicanth', 8, 132, 138),
      s('wailord', 4, 134, 140, { w: ['storm'] }),
    ],
    trainerIds: ['trainer-hoenn-diver'], gymId: 'gym-wallace',
  },
  {
    id: 'victory-road-hoenn', regionId: 'hoenn', order: 10,
    name: { de: 'Siegesstraße von Hoenn' },
    description: { de: 'Der letzte Tunnel vor der Liga. Wer hier umkehrt, kehrt ganz um.' },
    icon: '/media/areas/victory-road-hoenn.png', background: '/media/areas/victory-road-hoenn-bg.png',
    unlock: {
      previousAreaId: 'seafloor-cavern', minCaughtInPrevious: 5,
      minCreaturesAtLevel: { count: 6, level: 134 },
      requiredBadgeIds: ['stone-badge', 'knuckle-badge', 'dynamo-badge', 'heat-badge', 'balance-badge', 'feather-badge', 'mind-badge', 'rain-badge'],
    },
    spawns: [
      s('lairon', 20, 132, 140), s('loudred', 18, 132, 140),
      s('medicham', 16, 132, 140), s('sableye', 14, 134, 142, { t: ['night'] }),
      s('mawile', 14, 134, 142), s('golbat', 10, 134, 142),
      s('aggron', 6, 136, 144), s('shelgon', 2, 138, 146),
    ],
    trainerIds: ['elite-sidney', 'elite-phoebe', 'elite-glacia', 'elite-drake', 'trainer-hoenn-diver'],
    gymId: 'champion-steven',
  },

  // --- Nach der Liga --------------------------------------------------------
  {
    id: 'sky-pillar', regionId: 'hoenn', order: 11,
    name: { de: 'Himmelsturm' },
    description: { de: 'Sieben Stockwerke aus brüchigem Boden. Ganz oben endet der Turm im Nichts.' },
    icon: '/media/areas/sky-pillar.png', background: '/media/areas/sky-pillar-bg.png',
    unlock: {
      previousAreaId: 'victory-road-hoenn', minCaughtInPrevious: 3,
      minCreaturesAtLevel: { count: 5, level: 138 }, requiredBadgeIds: ['hoenn-crown'],
    },
    spawns: [
      s('claydol', 20, 138, 146), s('altaria', 18, 138, 146),
      s('flygon', 16, 140, 148), s('salamence', 12, 142, 150),
      s('metang', 12, 140, 148), s('banette', 10, 140, 148, { t: ['night'] }),
      s('dusclops', 8, 142, 150), s('rayquaza', 1, 150, 150, { w: ['storm'] }),
    ],
    trainerIds: [],
  },
  {
    id: 'cave-of-origin', regionId: 'hoenn', order: 12,
    name: { de: 'Ursprungshöhle' },
    description: { de: 'Unter Wolkenschloss. Der Boden ist warm und das Wasser bewegt sich ohne Wind.' },
    icon: '/media/areas/cave-of-origin.png', background: '/media/areas/cave-of-origin-bg.png',
    unlock: {
      previousAreaId: 'sky-pillar', minCaughtInPrevious: 4,
      minCreaturesAtLevel: { count: 6, level: 142 }, requiredBadgeIds: ['hoenn-crown'],
    },
    spawns: [
      s('golbat', 18, 142, 150), s('sharpedo', 16, 142, 150),
      s('walrein', 14, 144, 150), s('whiscash', 14, 144, 150),
      s('crawdaunt', 12, 144, 150), s('milotic', 10, 146, 150),
      s('metagross', 8, 148, 150), s('aggron', 8, 146, 150),
      s('kyogre', 1, 150, 150, { w: ['storm'] }), s('groudon', 1, 150, 150, { w: ['heat'] }),
    ],
    trainerIds: [],
  },
  {
    id: 'mirage-island', regionId: 'hoenn', order: 13,
    name: { de: 'Luftspiegelinsel' },
    description: { de: 'Manche Tage ist sie da, die meisten nicht. Wer sie findet, findet Seltenes.' },
    icon: '/media/areas/mirage-island.png', background: '/media/areas/mirage-island-bg.png',
    unlock: {
      previousAreaId: 'cave-of-origin', minCaughtInPrevious: 4,
      minCreaturesAtLevel: { count: 6, level: 146 }, requiredBadgeIds: ['hoenn-crown'],
    },
    spawns: [
      s('kecleon', 18, 146, 150), s('absol', 16, 146, 150),
      s('tropius', 14, 146, 150), s('lunatone', 12, 146, 150, { t: ['night'] }),
      s('solrock', 12, 146, 150, { t: ['day'] }), s('relicanth', 10, 148, 150),
      s('bagon', 8, 148, 150), s('beldum', 8, 148, 150),
      s('latias', 1, 150, 150, { t: ['dawn'] }), s('latios', 1, 150, 150, { t: ['dusk'] }),
    ],
    trainerIds: [],
  },
]

export const HOENN_CHAPTERS = [
  {
    id: 'ch-11-hoenn-arrival', order: 11,
    guide: { de: 'Prof. Birk' },
    title: { de: 'Salz in der Luft' },
    intro: { de: 'Hoenn ist halb Wasser. Wer hier ankommt, merkt zuerst, dass sein Team für festen Boden gebaut ist.' },
    outro: { de: 'Du hast dich an eine Region gewöhnt, die sich nicht an dich gewöhnt.' },
    requires: [{ kind: 'areaVisited', value: 'route-101' }, { kind: 'dexCaught', value: 120 }],
    reward: { gold: 12000, itemId: 'ultra-ball', quantity: 20 },
  },
  {
    id: 'ch-12-hoenn-league', order: 12,
    guide: { de: 'Prof. Birk' },
    title: { de: 'Acht neue Orden' },
    intro: { de: 'Hoenns Arenen kämpfen mit dem Wetter im Rücken. Rechne damit, dass die Hälfte deiner Attacken heute anders wirkt.' },
    outro: { de: 'Drei Kronen. Es gibt Trainer, die kennen nicht einmal drei Regionen.' },
    requires: [{ kind: 'badges', value: 25 }],
    reward: { gold: 50000, itemId: 'rare-candy', quantity: 25 },
  },
]

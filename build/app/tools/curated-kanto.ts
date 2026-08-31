/**
 * The Kanto world: regions, areas, gyms and badges.
 *
 * Hand-authored on purpose. PokéAPI has location data, but it describes the
 * original games' geography, not a progression curve that works for an idle
 * game played in five-minute bursts. Spawn tables, unlock conditions and gym
 * levels are balance, and balance is authored.
 *
 * The video's original had seven areas. This has twelve, eight gyms and a
 * four-stage league — "weitläufiger" was the point.
 */

export interface AreaOut {
  id: string
  regionId: string
  order: number
  name: { de: string }
  description: { de: string }
  icon: string
  background: string
  unlock: {
    previousAreaId: string | null
    minCaughtInPrevious: number
    minCreaturesAtLevel: { count: number; level: number } | null
    requiredBadgeIds: string[]
  }
  spawns: Array<{
    speciesId: string
    weight: number
    minLevel: number
    maxLevel: number
    timeOfDay?: string[]
    weather?: string[]
  }>
  trainerIds: string[]
  gymId: string | null
}

export const REGIONS = [
  {
    id: 'kanto', order: 1, name: { de: 'Kanto' }, tagline: { de: 'Wo jede Reise beginnt.' },
    starterSpeciesIds: ['bulbasaur', 'charmander', 'squirtle'],
  },
]

export const BADGES = [
  { id: 'boulder-badge',  name: { de: 'Felsorden' },   description: { de: 'Von Rocko in Marmoria City.' },      icon: '/media/badges/boulder.png',  obedienceLevel: 20 },
  { id: 'cascade-badge',  name: { de: 'Wasserorden' }, description: { de: 'Von Rocko… nein, von Misty in Azuria City.' }, icon: '/media/badges/cascade.png', obedienceLevel: 30 },
  { id: 'thunder-badge',  name: { de: 'Donnerorden' }, description: { de: 'Von Major Bob in Orania City.' },     icon: '/media/badges/thunder.png',  obedienceLevel: 40 },
  { id: 'rainbow-badge',  name: { de: 'Farborden' },   description: { de: 'Von Erika in Prismania City.' },      icon: '/media/badges/rainbow.png',  obedienceLevel: 50 },
  { id: 'soul-badge',     name: { de: 'Seelenorden' }, description: { de: 'Von Koga in Fuchsania City.' },       icon: '/media/badges/soul.png',     obedienceLevel: 60 },
  { id: 'marsh-badge',    name: { de: 'Sumpforden' },  description: { de: 'Von Sabrina in Saffronia City.' },    icon: '/media/badges/marsh.png',    obedienceLevel: 70 },
  { id: 'volcano-badge',  name: { de: 'Vulkanorden' }, description: { de: 'Von Pyro auf Zinnoberinsel.' },       icon: '/media/badges/volcano.png',  obedienceLevel: 80 },
  { id: 'earth-badge',    name: { de: 'Erdorden' },    description: { de: 'Von Giovanni in Viridian City.' },    icon: '/media/badges/earth.png',    obedienceLevel: 100 },
  { id: 'league-crown',   name: { de: 'Krone der Liga' }, description: { de: 'Für den Sieg über die Top Vier und den Champion.' }, icon: '/media/badges/crown.png', obedienceLevel: 100 },
]

type TeamMember = { speciesId: string; level: number }
interface TrainerSeed {
  id: string
  name: string
  title: string
  kind: 'trainer' | 'gym' | 'elite' | 'champion' | 'rival'
  team: TeamMember[]
  badgeId?: string
  rewardGold: number
  intro: string
  win: string
  lose: string
}

const TRAINER_SEEDS: TrainerSeed[] = [
  // --- Arenaleiter ---------------------------------------------------------
  { id: 'gym-brock', name: 'Rocko', title: 'Leiter der Marmoria-Arena', kind: 'gym', badgeId: 'boulder-badge', rewardGold: 900,
    team: [{ speciesId: 'geodude', level: 12 }, { speciesId: 'onix', level: 14 }],
    intro: 'Meine Pokémon sind so hart wie Stein. Zeig mir, ob du sie bewegen kannst.',
    win: 'Fels bricht nicht so leicht. Komm wieder, wenn dein Team gewachsen ist.',
    lose: 'Du hast meine Verteidigung durchbrochen. Der Felsorden gehört dir.' },
  { id: 'gym-misty', name: 'Misty', title: 'Leiterin der Azuria-Arena', kind: 'gym', badgeId: 'cascade-badge', rewardGold: 1400,
    team: [{ speciesId: 'staryu', level: 20 }, { speciesId: 'starmie', level: 23 }],
    intro: 'Wasser fließt um jedes Hindernis. Mal sehen, ob du mithältst.',
    win: 'Zu langsam. Übe weiter.',
    lose: 'Du kämpfst gut. Nimm den Wasserorden.' },
  { id: 'gym-surge', name: 'Major Bob', title: 'Leiter der Orania-Arena', kind: 'gym', badgeId: 'thunder-badge', rewardGold: 2000,
    team: [{ speciesId: 'voltorb', level: 26 }, { speciesId: 'pikachu', level: 26 }, { speciesId: 'raichu', level: 29 }],
    intro: 'Rekrut! Elektrizität kennt keine Gnade.',
    win: 'Zurück ins Training, Rekrut.',
    lose: 'Beeindruckend. Der Donnerorden ist verdient.' },
  { id: 'gym-erika', name: 'Erika', title: 'Leiterin der Prismania-Arena', kind: 'gym', badgeId: 'rainbow-badge', rewardGold: 2600,
    team: [{ speciesId: 'victreebel', level: 32 }, { speciesId: 'tangela', level: 32 }, { speciesId: 'vileplume', level: 35 }],
    intro: 'Verzeih, ich war eingenickt. Pflanzen wachsen langsam — aber unaufhaltsam.',
    win: 'Geduld ist auch eine Stärke. Versuch es erneut.',
    lose: 'Wie schön du kämpfst. Der Farborden ist deiner.' },
  { id: 'gym-koga', name: 'Koga', title: 'Leiter der Fuchsania-Arena', kind: 'gym', badgeId: 'soul-badge', rewardGold: 3400,
    team: [{ speciesId: 'koffing', level: 38 }, { speciesId: 'muk', level: 39 }, { speciesId: 'weezing', level: 43 }],
    intro: 'Gift wirkt langsam. Du wirst es erst merken, wenn es zu spät ist.',
    win: 'Zu ungeduldig. Gift belohnt die Wartenden.',
    lose: 'Du hast den Nebel durchschaut. Nimm den Seelenorden.' },
  { id: 'gym-sabrina', name: 'Sabrina', title: 'Leiterin der Saffronia-Arena', kind: 'gym', badgeId: 'marsh-badge', rewardGold: 4200,
    team: [{ speciesId: 'kadabra', level: 46 }, { speciesId: 'mr-mime', level: 46 }, { speciesId: 'alakazam', level: 50 }],
    intro: 'Ich habe diesen Kampf bereits gesehen. Trotzdem: bitte.',
    win: 'Es kam, wie ich es sah.',
    lose: 'Du hast meine Vorhersage widerlegt. Das ist selten.' },
  { id: 'gym-blaine', name: 'Pyro', title: 'Leiter der Zinnober-Arena', kind: 'gym', badgeId: 'volcano-badge', rewardGold: 5000,
    team: [{ speciesId: 'growlithe', level: 52 }, { speciesId: 'rapidash', level: 53 }, { speciesId: 'arcanine', level: 56 }],
    intro: 'Hitze trennt das Echte vom Unechten. Halt sie aus!',
    win: 'Verbrannt. Kühl dich ab und komm wieder.',
    lose: 'Du hast das Feuer überstanden. Vulkanorden für dich.' },
  { id: 'gym-giovanni', name: 'Giovanni', title: 'Leiter der Viridian-Arena', kind: 'gym', badgeId: 'earth-badge', rewardGold: 6500,
    team: [{ speciesId: 'rhyhorn', level: 58 }, { speciesId: 'dugtrio', level: 58 }, { speciesId: 'nidoqueen', level: 60 }, { speciesId: 'rhydon', level: 63 }],
    intro: 'Der Boden gehört mir. Alles, was darauf steht, ebenfalls.',
    win: 'Erwartungsgemäß.',
    lose: 'Der Erdorden. Du hast ihn dir genommen, nicht verdient. Auch gut.' },

  // --- Top Vier und Champion ----------------------------------------------
  { id: 'elite-lorelei', name: 'Lorelei', title: 'Top Vier · Eis', kind: 'elite', rewardGold: 8000,
    team: [{ speciesId: 'dewgong', level: 64 }, { speciesId: 'cloyster', level: 66 }, { speciesId: 'lapras', level: 68 }],
    intro: 'Kein Angriff entkommt der Kälte.', win: 'Eingefroren.', lose: 'Du bist heißer, als du aussiehst.' },
  { id: 'elite-bruno', name: 'Bruno', title: 'Top Vier · Kampf', kind: 'elite', rewardGold: 8500,
    team: [{ speciesId: 'hitmonlee', level: 66 }, { speciesId: 'hitmonchan', level: 66 }, { speciesId: 'machamp', level: 70 }],
    intro: 'Wir trainieren gemeinsam. Wir gewinnen gemeinsam.', win: 'Zu schwach.', lose: 'Kraft ist nicht alles. Du hast es bewiesen.' },
  { id: 'elite-agatha', name: 'Agathe', title: 'Top Vier · Geist', kind: 'elite', rewardGold: 9000,
    team: [{ speciesId: 'gengar', level: 68 }, { speciesId: 'golbat', level: 68 }, { speciesId: 'arbok', level: 72 }],
    intro: 'Ich kannte deinen Großvater. Er war auch zu selbstsicher.', win: 'Wie erwartet.', lose: 'Na so etwas. Nicht schlecht, Kind.' },
  { id: 'elite-lance', name: 'Siegfried', title: 'Top Vier · Drache', kind: 'elite', rewardGold: 10000,
    team: [{ speciesId: 'gyarados', level: 72 }, { speciesId: 'aerodactyl', level: 72 }, { speciesId: 'dragonite', level: 76 }],
    intro: 'Drachen sind selten. Trainer, die sie besiegen, noch seltener.', win: 'Es fehlt nicht viel.', lose: 'Du gehörst wirklich hierher.' },
  // --- Event-Gegner --------------------------------------------------------
  // Steht auf keiner Karte: die Safari ruft ihn beim Erkunden auf.
  { id: 'event-rocket-kanto', name: 'Rocket-Rüpel', title: 'Überfall in Kanto', kind: 'trainer', rewardGold: 2500,
    team: [{ speciesId: 'raticate', level: 42 }, { speciesId: 'arbok', level: 44 }, { speciesId: 'weezing', level: 46 }],
    intro: 'Das ist unser Revier. Zahl oder kämpf.',
    win: 'Hab ich doch gesagt.', lose: 'Verdammt! Wir sehen uns wieder!' },

  { id: 'champion-blue', name: 'Blau', title: 'Champion von Kanto', kind: 'champion', badgeId: 'league-crown', rewardGold: 20000,
    team: [{ speciesId: 'pidgeot', level: 78 }, { speciesId: 'alakazam', level: 78 }, { speciesId: 'rhydon', level: 80 },
           { speciesId: 'exeggutor', level: 80 }, { speciesId: 'arcanine', level: 82 }, { speciesId: 'blastoise', level: 84 }],
    intro: 'Ich bin schon lange hier. Zeig mir, warum das enden sollte.',
    win: 'Noch nicht.', lose: 'Also gut. Der Titel gehört dir.' },

  // --- Routentrainer -------------------------------------------------------
  { id: 'trainer-youngster-joey', name: 'Kevin', title: 'Knirps', kind: 'trainer', rewardGold: 120,
    team: [{ speciesId: 'rattata', level: 6 }],
    intro: 'Mein Rattfratz ist im Spitzenprozentbereich!', win: 'Hab ich doch gesagt.', lose: 'Trotzdem der beste.' },
  { id: 'trainer-bug-catcher', name: 'Kai', title: 'Käfersammler', kind: 'trainer', rewardGold: 180,
    team: [{ speciesId: 'caterpie', level: 8 }, { speciesId: 'weedle', level: 8 }],
    intro: 'Schau, was ich im Wald gefunden habe!', win: 'Käfer sind unterschätzt.', lose: 'Nächstes Mal fange ich bessere.' },
  { id: 'trainer-lass', name: 'Nina', title: 'Göre', kind: 'trainer', rewardGold: 260,
    team: [{ speciesId: 'nidoran-f', level: 14 }, { speciesId: 'clefairy', level: 14 }],
    intro: 'Meine Pokémon sind süß UND stark.', win: 'Siehst du?', lose: 'Süß reicht wohl nicht.' },
  { id: 'trainer-hiker', name: 'Bernd', title: 'Wanderer', kind: 'trainer', rewardGold: 420,
    team: [{ speciesId: 'geodude', level: 20 }, { speciesId: 'machop', level: 21 }],
    intro: 'Ich laufe diese Berge seit dreißig Jahren.', win: 'Kondition, junger Freund.', lose: 'Puh. Setz dich, ich hol Wasser.' },
  { id: 'trainer-swimmer', name: 'Jana', title: 'Schwimmerin', kind: 'trainer', rewardGold: 620,
    team: [{ speciesId: 'tentacool', level: 28 }, { speciesId: 'seel', level: 29 }],
    intro: 'Im Wasser bin ich zu Hause.', win: 'Bleib lieber am Ufer.', lose: 'Gut geschwommen!' },
  { id: 'trainer-rocket-grunt', name: 'Rocket-Rüpel', title: 'Team Rocket', kind: 'trainer', rewardGold: 800,
    team: [{ speciesId: 'zubat', level: 32 }, { speciesId: 'koffing', level: 33 }, { speciesId: 'rattata', level: 32 }],
    intro: 'Falscher Ort, falsche Zeit, Kleiner.', win: 'Verschwinde.', lose: 'Der Boss hört davon!' },
  { id: 'trainer-scientist', name: 'Dr. Weiß', title: 'Forscher', kind: 'trainer', rewardGold: 1100,
    team: [{ speciesId: 'magnemite', level: 38 }, { speciesId: 'electrode', level: 40 }],
    intro: 'Rein wissenschaftliches Interesse, versteht sich.', win: 'Hypothese bestätigt.', lose: 'Faszinierend. Und ärgerlich.' },
  { id: 'trainer-ace', name: 'Melanie', title: 'Ass-Trainerin', kind: 'trainer', rewardGold: 1800,
    team: [{ speciesId: 'kingler', level: 48 }, { speciesId: 'venomoth', level: 48 }, { speciesId: 'persian', level: 50 }],
    intro: 'Ich kämpfe seit zehn Jahren. Zeit, dass du dazulernst.', win: 'Solide, aber nicht genug.', lose: 'Respekt. Ehrlich.' },
  { id: 'trainer-veteran', name: 'Konrad', title: 'Veteran', kind: 'trainer', rewardGold: 2600,
    team: [{ speciesId: 'nidoking', level: 56 }, { speciesId: 'golem', level: 56 }, { speciesId: 'arcanine', level: 58 }],
    intro: 'Ich war hier, bevor es die Liga gab.', win: 'Erfahrung schlägt Talent.', lose: 'Dann ist es Zeit, dass ich gehe.' },
]

export const TRAINERS = TRAINER_SEEDS.map((t) => ({
  id: t.id,
  name: { de: t.name },
  title: { de: t.title },
  kind: t.kind,
  sprite: `/media/trainers/${t.id}.svg`,
  team: t.team,
  badgeId: t.badgeId ?? null,
  rewardGold: t.rewardGold,
  repeatRewardRatio: t.kind === 'gym' || t.kind === 'elite' || t.kind === 'champion' ? 0.15 : 0.25,
  dialogue: { intro: { de: t.intro }, win: { de: t.win }, lose: { de: t.lose } },
}))

/** Shorthand for a spawn row. `t` limits it to times of day, `w` to weather. */
const s = (
  speciesId: string, weight: number, minLevel: number, maxLevel: number,
  extra: { t?: string[]; w?: string[] } = {},
) => ({
  speciesId, weight, minLevel, maxLevel,
  ...(extra.t ? { timeOfDay: extra.t } : {}),
  ...(extra.w ? { weather: extra.w } : {}),
})

export const AREAS: AreaOut[] = [
  {
    id: 'route-1', regionId: 'kanto', order: 1,
    name: { de: 'Route 1' },
    description: { de: 'Ein ruhiger Weg zwischen hohen Gräsern. Hier fängt jede Reise an.' },
    icon: '/media/areas/route-1.png', background: '/media/areas/route-1-bg.png',
    unlock: { previousAreaId: null, minCaughtInPrevious: 0, minCreaturesAtLevel: null, requiredBadgeIds: [] },
    spawns: [
      s('pidgey', 34, 2, 5), s('rattata', 34, 2, 5),
      s('caterpie', 14, 2, 4, { t: ['dawn', 'day'] }), s('weedle', 14, 2, 4, { t: ['dusk', 'night'] }),
      s('pikachu', 4, 3, 6, { t: ['dusk', 'night'] }),
    ],
    trainerIds: ['trainer-youngster-joey'], gymId: null,
  },
  {
    id: 'viridian-forest', regionId: 'kanto', order: 2,
    name: { de: 'Vertania-Wald' },
    description: { de: 'Ein Labyrinth aus Bäumen. Käferpokémon überall, und irgendwo darin funkelt es gelb.' },
    icon: '/media/areas/viridian-forest.png', background: '/media/areas/viridian-forest-bg.png',
    unlock: { previousAreaId: 'route-1', minCaughtInPrevious: 4, minCreaturesAtLevel: null, requiredBadgeIds: [] },
    spawns: [
      s('caterpie', 24, 4, 8), s('weedle', 24, 4, 8),
      s('metapod', 14, 6, 9), s('kakuna', 14, 6, 9),
      s('pidgey', 12, 5, 9), s('pikachu', 8, 5, 9),
      s('oddish', 4, 6, 9, { w: ['rain', 'storm'] }),
    ],
    trainerIds: ['trainer-bug-catcher'], gymId: 'gym-brock',
  },
  {
    id: 'mt-moon', regionId: 'kanto', order: 3,
    name: { de: 'Mondberg' },
    description: { de: 'Tiefe Stollen ohne Tageslicht. Nachts kommen die Piepis heraus.' },
    icon: '/media/areas/mt-moon.png', background: '/media/areas/mt-moon-bg.png',
    unlock: { previousAreaId: 'viridian-forest', minCaughtInPrevious: 6, minCreaturesAtLevel: { count: 2, level: 12 }, requiredBadgeIds: ['boulder-badge'] },
    spawns: [
      s('zubat', 30, 8, 13), s('geodude', 26, 8, 13),
      s('paras', 16, 9, 13), s('sandshrew', 14, 9, 13),
      s('clefairy', 10, 10, 14, { t: ['night'] }),
      s('jigglypuff', 4, 10, 14, { t: ['dusk', 'night'] }),
    ],
    trainerIds: ['trainer-lass'], gymId: null,
  },
  {
    id: 'cerulean-cape', regionId: 'kanto', order: 4,
    name: { de: 'Azuria-Kap' },
    description: { de: 'Klippen über dem Meer. Der Wind trägt Flügelpokémon heran.' },
    icon: '/media/areas/cerulean-cape.png', background: '/media/areas/cerulean-cape-bg.png',
    unlock: { previousAreaId: 'mt-moon', minCaughtInPrevious: 6, minCreaturesAtLevel: { count: 3, level: 16 }, requiredBadgeIds: [] },
    spawns: [
      s('spearow', 26, 12, 18), s('meowth', 20, 12, 18),
      s('psyduck', 18, 13, 19, { w: ['rain', 'storm', 'fog'] }),
      s('poliwag', 16, 13, 19), s('abra', 12, 14, 18),
      s('mankey', 8, 14, 19),
    ],
    trainerIds: ['trainer-hiker'], gymId: 'gym-misty',
  },
  {
    id: 'vermilion-docks', regionId: 'kanto', order: 5,
    name: { de: 'Orania-Hafen' },
    description: { de: 'Container, Kräne und Salzluft. Unter den Stegen wimmelt es.' },
    icon: '/media/areas/vermilion-docks.png', background: '/media/areas/vermilion-docks-bg.png',
    unlock: { previousAreaId: 'cerulean-cape', minCaughtInPrevious: 8, minCreaturesAtLevel: { count: 3, level: 22 }, requiredBadgeIds: ['cascade-badge'] },
    spawns: [
      s('tentacool', 28, 18, 24), s('krabby', 24, 18, 24),
      s('magikarp', 20, 16, 22), s('shellder', 12, 19, 25),
      s('horsea', 10, 19, 25), s('goldeen', 6, 19, 25),
    ],
    trainerIds: ['trainer-swimmer'], gymId: 'gym-surge',
  },
  {
    id: 'rock-tunnel', regionId: 'kanto', order: 6,
    name: { de: 'Felstunnel' },
    description: { de: 'Stockdunkel. Man hört die Steine mehr, als man sie sieht.' },
    icon: '/media/areas/rock-tunnel.png', background: '/media/areas/rock-tunnel-bg.png',
    unlock: { previousAreaId: 'vermilion-docks', minCaughtInPrevious: 8, minCreaturesAtLevel: { count: 4, level: 26 }, requiredBadgeIds: ['thunder-badge'] },
    spawns: [
      s('geodude', 26, 22, 28), s('zubat', 22, 22, 28),
      s('machop', 18, 23, 29), s('onix', 14, 23, 29),
      s('graveler', 10, 25, 30), s('kangaskhan', 6, 26, 30),
      s('rhyhorn', 4, 26, 31, { w: ['sandstorm'] }),
    ],
    trainerIds: ['trainer-hiker'], gymId: null,
  },
  {
    id: 'celadon-gardens', regionId: 'kanto', order: 7,
    name: { de: 'Prismania-Gärten' },
    description: { de: 'Gepflegte Beete mitten in der Großstadt. Duftend und überraschend gefährlich.' },
    icon: '/media/areas/celadon-gardens.png', background: '/media/areas/celadon-gardens-bg.png',
    unlock: { previousAreaId: 'rock-tunnel', minCaughtInPrevious: 10, minCreaturesAtLevel: { count: 4, level: 30 }, requiredBadgeIds: [] },
    spawns: [
      s('oddish', 24, 26, 32, { t: ['dusk', 'night'] }), s('bellsprout', 24, 26, 32, { t: ['dawn', 'day'] }),
      s('gloom', 16, 30, 35), s('weepinbell', 16, 30, 35),
      s('venonat', 12, 28, 33), s('exeggcute', 8, 30, 35),
    ],
    trainerIds: ['trainer-rocket-grunt'], gymId: 'gym-erika',
  },
  {
    id: 'safari-zone', regionId: 'kanto', order: 8,
    name: { de: 'Safari-Zone' },
    description: { de: 'Weitläufiges Schutzgebiet. Hier laufen Arten herum, die man sonst nirgends sieht.' },
    icon: '/media/areas/safari-zone.png', background: '/media/areas/safari-zone-bg.png',
    unlock: { previousAreaId: 'celadon-gardens', minCaughtInPrevious: 10, minCreaturesAtLevel: { count: 4, level: 34 }, requiredBadgeIds: ['rainbow-badge'] },
    spawns: [
      s('nidoran-f', 18, 30, 36), s('nidoran-m', 18, 30, 36),
      s('doduo', 14, 30, 36), s('venomoth', 12, 32, 38),
      s('parasect', 10, 32, 38), s('rhyhorn', 10, 33, 39),
      s('chansey', 6, 32, 38), s('tauros', 6, 33, 39),
      s('scyther', 3, 34, 40, { t: ['dawn', 'day'] }), s('pinsir', 3, 34, 40, { t: ['dusk', 'night'] }),
    ],
    trainerIds: [], gymId: null,
  },
  {
    id: 'fuchsia-marsh', regionId: 'kanto', order: 9,
    name: { de: 'Fuchsania-Sumpf' },
    description: { de: 'Schwerer, süßlicher Geruch. Hier fühlt sich Gift wohl.' },
    icon: '/media/areas/fuchsia-marsh.png', background: '/media/areas/fuchsia-marsh-bg.png',
    unlock: { previousAreaId: 'safari-zone', minCaughtInPrevious: 12, minCreaturesAtLevel: { count: 5, level: 38 }, requiredBadgeIds: [] },
    spawns: [
      s('grimer', 24, 34, 40), s('koffing', 24, 34, 40),
      s('ekans', 16, 34, 40), s('arbok', 12, 38, 44),
      s('muk', 10, 40, 46), s('weezing', 10, 40, 46),
      s('gastly', 4, 36, 42, { t: ['night'] }),
    ],
    trainerIds: ['trainer-scientist'], gymId: 'gym-koga',
  },
  {
    id: 'saffron-towers', regionId: 'kanto', order: 10,
    name: { de: 'Saffronia-Türme' },
    description: { de: 'Glas und Beton. In den oberen Etagen wird geforscht, was man besser lassen sollte.' },
    icon: '/media/areas/saffron-towers.png', background: '/media/areas/saffron-towers-bg.png',
    unlock: { previousAreaId: 'fuchsia-marsh', minCaughtInPrevious: 12, minCreaturesAtLevel: { count: 5, level: 44 }, requiredBadgeIds: ['soul-badge'] },
    spawns: [
      s('abra', 20, 40, 46), s('kadabra', 16, 44, 50),
      s('magnemite', 16, 40, 46), s('magneton', 12, 44, 50),
      s('drowzee', 14, 40, 46), s('hypno', 10, 45, 51),
      s('porygon', 6, 44, 50), s('mr-mime', 6, 44, 50),
    ],
    trainerIds: ['trainer-ace'], gymId: 'gym-sabrina',
  },
  {
    id: 'cinnabar-volcano', regionId: 'kanto', order: 11,
    name: { de: 'Zinnober-Vulkan' },
    description: { de: 'Die Luft flimmert. Wer hier kämpft, kämpft gegen zwei Gegner.' },
    icon: '/media/areas/cinnabar-volcano.png', background: '/media/areas/cinnabar-volcano-bg.png',
    unlock: { previousAreaId: 'saffron-towers', minCaughtInPrevious: 12, minCreaturesAtLevel: { count: 5, level: 50 }, requiredBadgeIds: ['marsh-badge'] },
    spawns: [
      s('growlithe', 22, 46, 52), s('vulpix', 20, 46, 52),
      s('ponyta', 18, 46, 52), s('magmar', 14, 48, 54, { w: ['heat'] }),
      s('rapidash', 10, 52, 58), s('arcanine', 6, 52, 58),
      s('charmander', 6, 46, 52), s('moltres', 1, 55, 60, { w: ['heat'] }),
    ],
    trainerIds: ['trainer-veteran'], gymId: 'gym-blaine',
  },
  {
    id: 'viridian-gym', regionId: 'kanto', order: 12,
    name: { de: 'Vertania-Arena' },
    description: { de: 'Die Arena, die jahrelang geschlossen war. Jetzt steht die Tür offen, und dahinter wartet Giovanni.' },
    icon: '/media/areas/viridian-gym.png', background: '/media/areas/viridian-gym-bg.png',
    unlock: {
      previousAreaId: 'cinnabar-volcano', minCaughtInPrevious: 10,
      minCreaturesAtLevel: { count: 5, level: 55 },
      requiredBadgeIds: ['boulder-badge', 'cascade-badge', 'thunder-badge', 'rainbow-badge', 'soul-badge', 'marsh-badge', 'volcano-badge'],
    },
    spawns: [
      s('rhyhorn', 26, 50, 56), s('sandslash', 22, 50, 56),
      s('dugtrio', 18, 52, 58), s('nidorina', 14, 52, 58),
      s('nidorino', 14, 52, 58), s('golem', 6, 54, 60, { w: ['sandstorm'] }),
    ],
    trainerIds: ['trainer-rocket-grunt', 'trainer-veteran'], gymId: 'gym-giovanni',
  },
  {
    id: 'indigo-plateau', regionId: 'kanto', order: 13,
    name: { de: 'Indigo-Plateau' },
    description: { de: 'Das Ende der Reise. Vier Meister und ein Champion warten hier oben.' },
    icon: '/media/areas/indigo-plateau.png', background: '/media/areas/indigo-plateau-bg.png',
    unlock: {
      previousAreaId: 'viridian-gym', minCaughtInPrevious: 8,
      minCreaturesAtLevel: { count: 6, level: 58 },
      requiredBadgeIds: ['boulder-badge', 'cascade-badge', 'thunder-badge', 'rainbow-badge', 'soul-badge', 'marsh-badge', 'volcano-badge', 'earth-badge'],
    },
    spawns: [
      s('dratini', 20, 54, 60), s('dragonair', 14, 58, 64),
      s('chansey', 16, 55, 61), s('lapras', 14, 56, 62),
      s('electabuzz', 12, 56, 62), s('jynx', 12, 56, 62),
      s('aerodactyl', 8, 58, 64), s('snorlax', 4, 58, 64, { t: ['night'] }),
      s('articuno', 1, 62, 64, { w: ['snow'] }),
    ],
    trainerIds: ['elite-lorelei', 'elite-bruno', 'elite-agatha', 'elite-lance'],
    gymId: 'champion-blue',
  },

  // --- Nach der Liga --------------------------------------------------------
  // Bewusst hinten angehaengt statt in die Kette eingeschoben: eine
  // Umnummerierung haette jede Freischaltbedingung dahinter verschoben, und
  // wer schon mittendrin steckt, haette ploetzlich vor einer neuen Tuer
  // gestanden. Hier waechst die Region nach oben, nicht in der Mitte.
  {
    id: 'power-plant', regionId: 'kanto', order: 14,
    name: { de: 'Verlassenes Kraftwerk' },
    description: { de: 'Seit Jahren ohne Strom, und trotzdem summt es. Etwas hält die Leitungen warm.' },
    icon: '/media/areas/power-plant.png', background: '/media/areas/power-plant-bg.png',
    unlock: {
      previousAreaId: 'indigo-plateau', minCaughtInPrevious: 3,
      minCreaturesAtLevel: { count: 4, level: 60 }, requiredBadgeIds: ['league-crown'],
    },
    spawns: [
      s('voltorb', 22, 60, 66), s('magnemite', 20, 60, 66),
      s('electrode', 16, 62, 68), s('magneton', 14, 62, 68),
      s('raichu', 12, 64, 70), s('electabuzz', 10, 64, 70),
      s('jolteon', 4, 66, 72, { w: ['storm'] }),
      s('porygon', 2, 66, 72, { t: ['night'] }),
      s('zapdos', 1, 70, 72, { w: ['storm'] }),
    ],
    trainerIds: [],
  },
  {
    id: 'cerulean-cave', regionId: 'kanto', order: 15,
    name: { de: 'Unbekannte Höhle' },
    description: { de: 'Der Eingang war lange versiegelt. Niemand sagt, warum — nur, dass es einen Grund gab.' },
    icon: '/media/areas/cerulean-cave.png', background: '/media/areas/cerulean-cave-bg.png',
    unlock: {
      previousAreaId: 'power-plant', minCaughtInPrevious: 4,
      minCreaturesAtLevel: { count: 5, level: 66 }, requiredBadgeIds: ['league-crown'],
    },
    spawns: [
      s('golbat', 20, 66, 72), s('machoke', 18, 66, 72),
      s('kadabra', 16, 68, 74), s('rhydon', 14, 68, 74),
      s('parasect', 12, 68, 74), s('magneton', 10, 70, 76),
      s('ditto', 6, 70, 76), s('chansey', 4, 72, 78, { t: ['night'] }),
      s('mewtwo', 1, 78, 78, { t: ['night'] }),
      s('mew', 1, 72, 74, { w: ['fog'] }),
    ],
    trainerIds: [],
  },
]

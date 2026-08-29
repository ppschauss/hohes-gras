import type { PokeApi } from './pokeapi-client.ts'
import { germanName } from './pokeapi-client.ts'

/**
 * Items are hand-authored, not imported.
 *
 * PokéAPI knows what an Ultra Ball is called, but not what it should cost in
 * *this* game or how much it should improve a catch. Those numbers are balance
 * decisions and belong next to the game, so only the names come from the API.
 */

export interface ItemOut {
  id: string
  name: { de: string }
  description: { de: string }
  category: string
  price: number | null
  sellPrice: number | null
  stackable: boolean
  icon: string
  params: Record<string, number | string | boolean>
}

interface Authored {
  id: string
  category: ItemOut['category']
  price: number | null
  sellPrice: number | null
  params?: Record<string, number | string | boolean>
  name?: string
  description?: string
  stackable?: boolean
}

/** Der Störsender. Die Regel dahinter steht in `engine/league.ts`; hier steht
 *  nur, was er kostet und wie er heißt. */
const BAIT_ITEM_ID = 'rocket-bait'
const BAIT_CHARGES = 5

/** Der Metalldetektor. Die Regel dazu steht in `engine/foraging.ts`. */
const DETECTOR_ITEM_ID = 'metal-detector'
const DETECTOR_CHARGES = 1

/** Gegenstaende, deren Bild selbst erzeugt wurde und als Vektor vorliegt. */
export const SVG_ICONS = new Set([
  'rocket-bait', 'energy-drink', 'exp-candy-s', 'exp-candy-l',
  'golden-razz', 'legendary-berry', 'lure-legendary', 'soul-shiny',
  'metal-detector',
  // Die sechs Gartenhintergruende. Sie waren die einzigen fehlenden Bilder,
  // die im Spiel wirklich zu sehen waren: im Laden trugen alle sechs
  // dasselbe Ersatzsymbol und sahen damit identisch aus.
  'bg-classic', 'bg-beach', 'bg-forest', 'bg-dojo', 'bg-moonlight', 'bg-space',
])

export const AUTHORED: Authored[] = [
  {
    /*
     * Ein Überfall auf Bestellung.
     *
     * Überfälle sind die einzige Quelle für Sagenbeeren, und mit 4 % je
     * Erkundung ist das Warten darauf reine Geduld. Der Störsender kauft diese
     * Geduld ab — teuer genug, dass er eine Entscheidung bleibt: 10.000 Gold
     * sind mehr als jeder Ausbau der ersten Stufe.
     */
    id: BAIT_ITEM_ID, category: 'key', price: 10000, sellPrice: 500,
    name: 'Störsender',
    description: 'Funkt auf der Frequenz der Banden. Die nächsten '
      + `${BAIT_CHARGES} Erkundungen enden in einem Überfall.`,
    params: { rocketCharges: BAIT_CHARGES },
  },
  {
    /*
     * Die Schrottsuche auf Knopfdruck.
     *
     * Fundstücke liegen mit 3 % je Erkundung herum; wer gezielt Werkstoffe
     * braucht, wartet sonst auf den Zufall. Der Detektor ersetzt den Wurf für
     * genau eine Erkundung — und fördert dabei anderes zutage als der Zufall:
     * Schrott und Fragmente statt Geldbeutel. Sonst wären die 100 Gold ein
     * Einsatz, der sich selbst vervielfacht.
     */
    id: DETECTOR_ITEM_ID, category: 'key', price: 100, sellPrice: 10,
    name: 'Metalldetektor',
    description: 'Piept über allem, was im Boden liegt. Die nächste Erkundung '
      + 'fördert ein Fundstück zutage.',
    params: { detectorCharges: DETECTOR_CHARGES },
  },
  {
    /*
     * Das Schillernde Seelenfragment.
     *
     * Es fällt nur an einer Stelle: auf der letzten Stufe einer Saison, also
     * höchstens einmal die Woche. Deshalb ist es weder käuflich noch
     * verkäuflich — und deshalb reichen fünf, wo es von den gewöhnlichen
     * Fragmenten fünfundachtzig braucht.
     */
    id: 'soul-shiny', category: 'material', price: null, sellPrice: null,
    name: 'Schillerndes Seelenfragment',
    description: 'Belohnung der letzten Saisonstufe. '
      + `${SHINY_SOUL_PER_EGG} davon werden zu einem schillernden Ei — der Typ ist frei wählbar.`,
    params: { shinySoul: true },
  },
  {
    /*
     * Der Prüfstand für Legendäre.
     *
     * Ein Legendäres taucht nur in einer bezwungenen Region auf und dort mit
     * Bruchteilen eines Prozents — wer die Begegnung *testen* will, wartet
     * sonst tagelang auf einen Zufall. Dieser Duft ersetzt beides: er
     * überspringt die Regionsbedingung und den Wurf.
     *
     * Deshalb hat er keinen Preis. Er entsteht nur durch `/gegenstand` und
     * liegt damit dort, wo er hingehört — beim Admin. Anders als die
     * gekauften Düfte kommt er nicht als Fünferpackung: eine Einheit, eine
     * Erkundung, damit sich die Zahl im Beutel wie ein Vorrat an Versuchen
     * liest.
     */
    id: 'lure-legendary', category: 'lure', price: null, sellPrice: null,
    name: 'Legendärer Lockduft',
    description: 'Testgegenstand. Die nächste Erkundung führt zu einem '
      + 'Legendären der Region — ohne Rücksicht darauf, ob sie bezwungen ist. '
      + 'Eine Einheit je Erkundung.',
    params: { legendaryLure: true, packSize: 1 },
  },

  // --- Bälle. catchMultiplier geht direkt in die Fangformel ein. -----------
  { id: 'poke-ball',   category: 'ball', price: 30,   sellPrice: 15,  params: { catchMultiplier: 1.0 },
    description: 'Der Standardball. Günstig, zuverlässig, überall zu haben.' },
  { id: 'great-ball',  category: 'ball', price: 90,   sellPrice: 45,  params: { catchMultiplier: 1.5 },
    description: 'Fängt spürbar besser als ein Pokéball.' },
  { id: 'ultra-ball',  category: 'ball', price: 180,  sellPrice: 90,  params: { catchMultiplier: 2.0 },
    description: 'Der zuverlässigste Ball, den der Shop führt.' },
  { id: 'net-ball',    category: 'ball', price: 150,  sellPrice: 75,  params: { catchMultiplier: 1.0, bonusVsTypes: 'bug,water', bonusMultiplier: 3.5 },
    description: 'Gegen Käfer- und Wasser-Pokémon außergewöhnlich wirksam.' },
  { id: 'dusk-ball',   category: 'ball', price: 150,  sellPrice: 75,  params: { catchMultiplier: 1.0, bonusTimeOfDay: 'dusk,night', bonusMultiplier: 3.0 },
    description: 'Bei Dämmerung und in der Nacht deutlich wirksamer.' },
  { id: 'timer-ball',  category: 'ball', price: 150,  sellPrice: 75,  params: { catchMultiplier: 1.0, perTurnBonus: 0.3, maxMultiplier: 4.0 },
    description: 'Wird mit jeder Runde der Begegnung stärker.' },

  // --- Beeren. Werden vor dem Wurf eingesetzt. ------------------------------
  { id: 'razz-berry',  category: 'berry', price: 40,  sellPrice: 20,  params: { catchBonus: 1.5 },
    name: 'Himmihbeere', description: 'Lenkt das Pokémon ab — der nächste Ball hält besser.' },
  { id: 'nanab-berry', category: 'berry', price: 40,  sellPrice: 20,  params: { calmBonus: 1.0 },
    name: 'Nanabbeere', description: 'Beruhigt das Pokémon, es bewegt sich kaum noch.' },
  { id: 'pinap-berry', category: 'berry', price: 60,  sellPrice: 30,  params: { candyBonus: 2.0 },
    name: 'Sananabeere', description: 'Verdoppelt die Bonbons bei einem erfolgreichen Fang.' },
  { id: 'golden-razz', category: 'berry', price: 250, sellPrice: 90,  params: { catchBonus: 2.5 },
    name: 'Goldene Himmihbeere', description: 'Die wirksamste Beere überhaupt. Selten und teuer.' },
  // Die einzige Beere, die gegen Legendäre wirkt — und die einzige, die man
  /*
   * Nicht käuflich, nicht verkäuflich: sie fällt nur bei Überfällen.
   *
   * Hier stand `price: 0` mit dem Kommentar "taucht im Laden nicht auf" — eine
   * Behauptung, die der Laden nicht kannte. Er listet alles, was einen Preis
   * hat, und null Gold ist ein Preis. Ein Mitspieler hat sich so 34 Sagenbeeren
   * geholt, ein anderer 117. `null` heißt "kein Preis" und ist das, was hier
   * gemeint war.
   */
  { id: 'legendary-berry', category: 'berry', price: null, sellPrice: null, params: { legendaryBonus: 0.25 },
    name: 'Sagenbeere', description: 'Uralt und bitter. Nur sie beeindruckt ein Legendäres — höchstens drei auf einmal.' },
  { id: 'oran-berry',  category: 'berry', price: 50,  sellPrice: 25,  params: { careValue: 1, friendship: 3 },
    description: 'Lieblingssnack im Garten. Gibt Freundschaft und etwas Energie.' },

  // --- Medizin -------------------------------------------------------------
  { id: 'potion',        category: 'medicine', price: 100,  sellPrice: 50,  params: { heal: 20 },
    description: 'Heilt 20 KP.' },
  { id: 'super-potion',  category: 'medicine', price: 250,  sellPrice: 125, params: { heal: 60 },
    description: 'Heilt 60 KP.' },
  { id: 'hyper-potion',  category: 'medicine', price: 600,  sellPrice: 300, params: { heal: 120 },
    description: 'Heilt 120 KP.' },
  { id: 'full-restore',  category: 'medicine', price: 1200, sellPrice: 500, params: { healFull: true, cureAll: true },
    description: 'Stellt alle KP her und heilt jeden Statuszustand.' },
  { id: 'revive',        category: 'medicine', price: 900,  sellPrice: 400, params: { revive: 0.5 },
    description: 'Belebt ein besiegtes Pokémon mit der Hälfte seiner KP wieder.' },
  { id: 'full-heal',     category: 'medicine', price: 300,  sellPrice: 150, params: { cureAll: true },
    description: 'Heilt jeden Statuszustand.' },
  { id: 'energy-drink',  category: 'medicine', price: 200,  sellPrice: 80,  params: { energy: 40 },
    name: 'Energydrink', description: 'Füllt die Energie eines Gartenpokémon wieder auf.' },

  // --- Erfahrung -----------------------------------------------------------
  { id: 'rare-candy',  category: 'xp', price: 800,  sellPrice: 0,   params: { xp: 50, targetSingle: true },
    description: 'Gibt einem einzelnen Pokémon sofort 50 EP.' },
  { id: 'exp-candy-s', category: 'xp', price: 300,  sellPrice: 100, params: { xp: 800 },
    name: 'EP-Bonbon S', description: 'Ein kleiner Erfahrungsschub.' },
  { id: 'exp-candy-l', category: 'xp', price: 1400, sellPrice: 500, params: { xp: 5000 },
    name: 'EP-Bonbon L', description: 'Ein kräftiger Erfahrungsschub.' },

  // --- Material für das Handwerk -------------------------------------------
  { id: 'soft-sand',   category: 'material', price: null, sellPrice: 40,  name: 'Feinsand',
    description: 'Handwerksmaterial. Fällt bei Expeditionen an.' },
  { id: 'silk-thread', category: 'material', price: null, sellPrice: 40,  name: 'Seidenfaden',
    description: 'Handwerksmaterial. Fällt bei Expeditionen an.' },
  { id: 'iron-shard',  category: 'material', price: null, sellPrice: 70,  name: 'Eisensplitter',
    description: 'Handwerksmaterial. Fällt bei Expeditionen an.' },
  { id: 'dew-drop',    category: 'material', price: null, sellPrice: 70,  name: 'Tautropfen',
    description: 'Handwerksmaterial. Fällt bei Expeditionen an.' },
  { id: 'star-piece',  category: 'material', price: null, sellPrice: 300, name: 'Sternenstaub',
    description: 'Seltenes Handwerksmaterial. Sehr wertvoll.' },

  // --- Gartenhintergründe. Einmalkauf, nicht stapelbar. ---------------------
  { id: 'bg-classic',   category: 'background', price: 0,    sellPrice: null, stackable: false,
    name: 'Klassisch', description: 'Die vertraute Gartenwiese.' },
  { id: 'bg-forest',    category: 'background', price: 800,  sellPrice: null, stackable: false,
    name: 'Wald', description: 'Eine schattige Lichtung zwischen alten Bäumen.' },
  { id: 'bg-beach',     category: 'background', price: 800,  sellPrice: null, stackable: false,
    name: 'Strand', description: 'Sand, Brandung und viel Platz zum Toben.' },
  { id: 'bg-moonlight', category: 'background', price: 1500, sellPrice: null, stackable: false,
    name: 'Mondlicht', description: 'Stille Nacht unter einem klaren Himmel.' },
  { id: 'bg-dojo',      category: 'background', price: 1500, sellPrice: null, stackable: false,
    name: 'Dojo', description: 'Für Teams, die es ernst meinen.' },
  { id: 'bg-space',     category: 'background', price: 4000, sellPrice: null, stackable: false,
    name: 'Weltraum', description: 'Warum nicht. Es ist dein Garten.' },
]

/** Names for stones and trade items come from the API so they match the rest
 *  of the pack; prices are ours. */
const STONE_PRICE = 1500

/** Preis einer Packung Lockduft und wie viele Anwendungen darin stecken. */
export const LURE_PRICE = 50
export const LURE_PACK_SIZE = 5

/**
 * Ein Lockduft je Typ.
 *
 * Wird aus den Typen des Packs erzeugt, nicht von Hand gepflegt: kommt ein Typ
 * dazu, kommt sein Lockduft mit. Der Preis gilt für die Packung — im Beutel
 * liegen die fünf Anwendungen einzeln, jede Erkundung verbraucht eine.
 */
export function lureItems(types: Array<{ id: string; name: { de: string } }>): ItemOut[] {
  return types.map((t) => ({
    id: `lure-${t.id}`,
    name: { de: `Lockduft-${t.name.de}` },
    description: {
      de: `Lockt beim Erkunden ${t.name.de}-Pokémon an. Eine Packung reicht für `
        + `${LURE_PACK_SIZE} Erkundungen.`,
    },
    category: 'lure',
    price: LURE_PRICE,
    sellPrice: Math.floor(LURE_PRICE / 5),
    stackable: true,
    // SVG statt PNG: die Icons sind erzeugte Vektoren, skalieren verlustfrei
    // und wiegen zusammen weniger als ein einzelnes PNG in der Groesse.
    icon: `/media/items/lure-${t.id}.svg`,
    params: { lureType: t.id, packSize: LURE_PACK_SIZE },
  }))
}

/* Die Zahl kommt aus der Engine — der Text im Pack und die Spielregel duerfen
   nicht auseinanderlaufen. */
import { SHINY_SOUL_PER_EGG, SOUL_PER_EGG, SOUL_PER_SHINY_EGG } from '../packages/engine/dist/index.js'
export { SHINY_SOUL_PER_EGG, SOUL_PER_EGG, SOUL_PER_SHINY_EGG }

/**
 * Ein Seelenfragment je Typ.
 *
 * Nicht käuflich und nicht verkäuflich: es entsteht nur beim Verwerten eines
 * Pokémon und geht nur in ein Ei. Eine Währung, die man weder kaufen noch zu
 * Gold machen kann, bleibt das, was sie sein soll — ein Tauschmittel zwischen
 * dem, was man nicht braucht, und dem, was man sucht.
 */
export function soulItems(types: Array<{ id: string; name: { de: string } }>): ItemOut[] {
  return types.map((t) => ({
    id: `soul-${t.id}`,
    name: { de: `Seelenfragment (${t.name.de})` },
    description: {
      de: `Bleibt zurück, wenn ein ${t.name.de}-Pokémon verwertet wird. `
        + `${SOUL_PER_EGG} davon werden zu einem Ei, ${SOUL_PER_SHINY_EGG} zu einem schillernden.`,
    },
    category: 'material',
    price: null,
    sellPrice: null,
    stackable: true,
    icon: `/media/items/soul-${t.id}.svg`,
    params: { soulType: t.id },
  }))
}

export async function buildItems(
  api: PokeApi,
  requiredExtraIds: Set<string>,
  log: (m: string) => void,
): Promise<ItemOut[]> {
  const out: ItemOut[] = []
  const authoredIds = new Set(AUTHORED.map((a) => a.id))

  for (const a of AUTHORED) {
    out.push({
      id: a.id,
      name: { de: a.name ?? (await apiName(api, a.id)) },
      description: { de: a.description ?? '' },
      category: a.category,
      price: a.price,
      sellPrice: a.sellPrice,
      stackable: a.stackable ?? true,
      // SVG, wenn es eins gibt — die erzeugten Icons sind Vektoren; alles
      // andere bleibt beim PNG aus der PokeAPI.
      icon: SVG_ICONS.has(a.id) ? `/media/items/${a.id}.svg` : `/media/items/${a.id}.png`,
      params: a.params ?? {},
    })
  }

  // Anything an evolution refers to must exist, or the pack fails validation.
  for (const id of requiredExtraIds) {
    if (authoredIds.has(id)) continue
    out.push({
      id,
      name: { de: await apiName(api, id) },
      description: { de: 'Lässt bestimmte Pokémon sich entwickeln.' },
      category: 'stone',
      price: STONE_PRICE,
      sellPrice: Math.round(STONE_PRICE / 2),
      stackable: true,
      icon: `/media/items/${id}.png`,
      params: {},
    })
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  log(`Items: ${out.length} (${AUTHORED.length} kuratiert, ${out.length - AUTHORED.length} aus Entwicklungen abgeleitet)`)
  return out
}

async function apiName(api: PokeApi, id: string): Promise<string> {
  try {
    const item = await api.get<{ names: Array<{ name: string; language: { name: string } }> }>(`item/${id}`)
    return germanName(item.names, id)
  } catch {
    // Not every id we invent exists upstream; a readable fallback beats a crash.
    return id.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
  }
}

import { LINK_CABLE_ITEM_ID } from '@game/engine'
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
  'metal-detector', 'link-cable', 'egg-warmer',
  // Die sechs Gartenhintergruende. Sie waren die einzigen fehlenden Bilder,
  // die im Spiel wirklich zu sehen waren: im Laden trugen alle sechs
  // dasselbe Ersatzsymbol und sahen damit identisch aus.
  'bg-classic', 'bg-beach', 'bg-forest', 'bg-dojo', 'bg-moonlight', 'bg-space',
  // Die sechs Vitamine, der Kronkorken und die drei Duenger. Ohne Eintrag hier
  // schriebe der Generator `.png` und das Pack zeigte fuer alle zehn das
  // Ersatzsymbol — die gezeichneten Bilder liegen als SVG vor.
  'hp-up', 'protein', 'iron', 'calcium', 'zinc', 'carbos',
  'bottle-cap', 'fertiliser-1', 'fertiliser-2', 'fertiliser-3',
  // Die sechs Fleissbeeren.
  'pomeg-berry', 'kelpsy-berry', 'qualot-berry', 'hondew-berry', 'apicot-berry', 'tamato-berry',
])

export const AUTHORED: Authored[] = [
  {
    /*
     * Der Brutbeschleuniger.
     *
     * Ein Pruefgegenstand, kein Spielinhalt: er laesst ein Ei sofort schluepfen.
     * Deshalb hat er keinen Preis — es gibt ihn nur ueber `/gegenstand`, also
     * beim Admin. Wer die Zucht ausgiebig testen will, wartet sonst je Ei
     * Stunden, und ohne Test bleibt das Vererbungssystem unbeobachtet.
     *
     * Faende er den Weg in den Laden, waere die Brutzeit abgeschafft — und mit
     * ihr der einzige Preis, den ein Ei ueberhaupt hat.
     */
    id: 'egg-warmer', category: 'key', price: null, sellPrice: null,
    name: 'Brutbeschleuniger',
    description: 'Prüfgegenstand. Lässt ein Ei sofort schlüpfen.',
    params: { hatchNow: true },
  },
  {
    /*
     * Das Verbindungskabel.
     *
     * Elf Arten entwickeln sich im Vorbild nur durch einen Tausch — und blieben
     * damit in einer Runde von vier Leuten unerreichbar: es braucht nicht nur
     * jemanden, der tauscht, sondern jemanden, der *zurueck*tauscht.
     *
     * Das Kabel ist der Weg allein. Es ist bewusst nicht kaeuflich: sein Preis
     * sind Eisensplitter und Seidenfaeden aus Expeditionen, und das Rezept dazu
     * will erst erforscht werden. Wer Machomei will, faehrt dafuer eine Woche
     * lang Expeditionen — genau das war der Wunsch.
     *
     * Ein echter Tausch loest die Entwicklung weiterhin aus, und zwar ohne
     * Kabel. Der Umweg soll den Tausch ergaenzen, nicht ersetzen.
     */
    id: LINK_CABLE_ITEM_ID, category: 'key', price: null, sellPrice: 250,
    name: 'Verbindungskabel',
    description: 'Simuliert einen Tausch. Löst bei einem Pokémon, das sich nur '
      + 'durch Tausch entwickelt, genau diese Entwicklung aus — der '
      + 'Tragegegenstand wird dabei zusätzlich gebraucht.',
    params: { linkCable: true },
  },
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
    id: 'soul-shiny', category: 'material', price: null, sellPrice: 1500,
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
  /*
   * Pharmazie: Duenger, Fleissbeere, IV-Mittel.
   *
   * Nicht kaeuflich — sie sind der Ertrag einer Kette aus Forschung, Beet und
   * Werkstatt. Waeren sie im Laden, waere die Kette Zierde und Gold der
   * einzige Weg. Verkaufen laesst sich nur der Duenger, und auch der schlecht:
   * er soll auf dem Beet landen, nicht im Handel.
   */
  /*
   * Die Grundstufe gibt es auch zu kaufen — zehn Stueck fuer 50.000 Gold.
   *
   * `packSize`: der Preis gilt fuer die Packung, im Beutel liegen zehn. Damit
   * hat Gold endlich ein laufendes Ziel, und der Einstieg ins Duengen haengt
   * nicht am Sternenstaub. Die beiden hoeheren Stufen bleiben ausserhalb des
   * Ladens: sie sollen die Kette belohnen, nicht den Kontostand.
   */
  { id: 'fertiliser-1', category: 'material', price: 50000, sellPrice: 120, params: { fertiliser: 50, packSize: 10 },
    name: 'Dünger I', description: 'Beschleunigt das Wachstum um die Hälfte und hebt die Ernte ebenso.' },
  { id: 'fertiliser-2', category: 'material', price: null, sellPrice: 400, params: { fertiliser: 100 },
    name: 'Dünger II', description: 'Halbiert die Wachszeit und verdoppelt den Aufschlag auf die Ernte.' },
  { id: 'fertiliser-3', category: 'material', price: null, sellPrice: 1200, params: { fertiliser: 200 },
    name: 'Dünger III', description: 'Ein Drittel der Wachszeit, dreifacher Aufschlag. Selten und teuer.' },
  /*
   * Die sechs Vitamine — je eines fuer einen Wert.
   *
   * Hier stand zuerst eine erfundene "Fleissbeere" mit einer Wertwahl. Die
   * Vorlage kennt dafuer sechs eigene Gegenstaende, und die sind die bessere
   * Loesung: ein Protein *ist* Angriff, man muss nichts aussuchen und nichts
   * erklaeren. Der Bildschirm braucht damit auch keine zweite Abfrage mehr.
   *
   * 32 Fleisspunkte je Flasche — genau ein Trainingslauf. Das Vitamin ist
   * damit "ein Training in der Flasche": teurer, aber sofort und ohne das
   * Pokemon drei Stunden zu binden. Acht Flaschen fuellen einen Wert.
   */
  { id: 'hp-up',   category: 'medicine', price: null, sellPrice: 900, params: { evPoints: 32, evStat: 'hp' },
    name: 'KP-Plus', description: 'Hebt die Kraftpunkte eines Pokémon dauerhaft.' },
  { id: 'protein', category: 'medicine', price: null, sellPrice: 900, params: { evPoints: 32, evStat: 'atk' },
    name: 'Protein', description: 'Hebt den Angriff eines Pokémon dauerhaft.' },
  { id: 'iron',    category: 'medicine', price: null, sellPrice: 900, params: { evPoints: 32, evStat: 'def' },
    name: 'Eisen', description: 'Hebt die Verteidigung eines Pokémon dauerhaft.' },
  { id: 'calcium', category: 'medicine', price: null, sellPrice: 900, params: { evPoints: 32, evStat: 'spa' },
    name: 'Kalzium', description: 'Hebt den Spezial-Angriff eines Pokémon dauerhaft.' },
  { id: 'zinc',    category: 'medicine', price: null, sellPrice: 900, params: { evPoints: 32, evStat: 'spd' },
    name: 'Zink', description: 'Hebt die Spezial-Verteidigung eines Pokémon dauerhaft.' },
  { id: 'carbos',  category: 'medicine', price: null, sellPrice: 900, params: { evPoints: 32, evStat: 'spe' },
    name: 'Carbon', description: 'Hebt die Initiative eines Pokémon dauerhaft.' },
  /*
   * Der Kronkorken.
   *
   * Auch er hat eine Vorlage — und anders als bei den Vitaminen waehlt man
   * dort tatsaechlich den Wert aus. Die Abfrage bleibt deshalb, aber nur noch
   * fuer diesen einen Gegenstand.
   */
  { id: 'bottle-cap', category: 'medicine', price: null, sellPrice: 12000, params: { ivPerfect: true },
    name: 'Kronkorken', description: 'Bringt eine Veranlagung auf den Höchstwert. Du wählst, welche.' },
  /*
   * Die sechs Fleissbeeren.
   *
   * Eine je Wert, und das ist der Punkt: eine einzelne Allzweckbeere mit
   * Wertwahl gab es hier schon einmal, und sie machte die ganze Kette zu
   * einem einzigen Knopf. Sechs verschiedene Beeren heissen sechs
   * verschiedene Anbauten — und der Kronkorken verlangt am Ende alle sechs.
   *
   * Vier Fleisspunkte je Beere gegen 32 je Vitamin: die Beere ist der
   * langsame Weg, den man nebenbei im Beet geht, das Vitamin der schnelle,
   * den man im Labor bezahlt. Beide aus derselben Ernte — wer Vitamine baut,
   * hat weniger fuer den Kronkorken. Das soll wehtun.
   *
   * Nicht kaeuflich: die erste Beere kommt aus dem Labor, jede weitere aus
   * dem Beet. Ein Laden, der sie fuehrt, haette die Beete ueberfluessig
   * gemacht.
   */
  { id: 'pomeg-berry', category: 'berry', price: null, sellPrice: 140, params: { evPoints: 4, evStat: 'hp' },
    name: 'Granatbeere', description: 'Hebt KP beim Fressen ein wenig. Waechst im Beet nach.' },
  { id: 'kelpsy-berry', category: 'berry', price: null, sellPrice: 140, params: { evPoints: 4, evStat: 'atk' },
    name: 'Tsitrubeere', description: 'Hebt Angriff beim Fressen ein wenig. Waechst im Beet nach.' },
  { id: 'qualot-berry', category: 'berry', price: null, sellPrice: 140, params: { evPoints: 4, evStat: 'def' },
    name: 'Maronbeere', description: 'Hebt Verteidigung beim Fressen ein wenig. Waechst im Beet nach.' },
  { id: 'hondew-berry', category: 'berry', price: null, sellPrice: 140, params: { evPoints: 4, evStat: 'spa' },
    name: 'Pilzbeere', description: 'Hebt Spezial-Angriff beim Fressen ein wenig. Waechst im Beet nach.' },
  /* Die Sinelbeere waere hier die Vorlage — den Namen traegt im Pack aber
   * schon `oran-berry`. Die Elukisbeere haengt ohnehin an der
   * Spezial-Verteidigung, also passt sie und ist frei. */
  { id: 'apicot-berry', category: 'berry', price: null, sellPrice: 140, params: { evPoints: 4, evStat: 'spd' },
    name: 'Elukisbeere', description: 'Hebt Spezial-Verteidigung beim Fressen ein wenig. Waechst im Beet nach.' },
  { id: 'tamato-berry', category: 'berry', price: null, sellPrice: 140, params: { evPoints: 4, evStat: 'spe' },
    name: 'Wasmelbeere', description: 'Hebt Initiative beim Fressen ein wenig. Waechst im Beet nach.' },
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
  /*
   * Das Sonderbonbon hebt um ein Level, nicht um fuenfzig Erfahrungspunkte.
   *
   * Fuenfzig standen hier, und das war der ganze Gegenstand: bei Level 39
   * kostet ein Aufstieg 4.681 Punkte, bei Level 100 gut 30.000. Das Bonbon
   * war damit ein Achtzigstel dessen, was sein Name verspricht — teurer als
   * ein EP-Bonbon S und ein Bruchteil so wirksam. Jetzt tut es, wofuer es
   * benannt ist, und kostet entsprechend.
   */
  { id: 'rare-candy',  category: 'xp', price: 3000, sellPrice: 0,   params: { levelUp: true, targetSingle: true },
    name: 'Sonderbonbon', description: 'Hebt ein Pokémon um genau ein Level. Süß, selten, sofort.' },
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
import { SHINY_SOUL_PER_EGG, SOUL_PER_EGG, SOUL_PER_SHINY_EGG, SOUL_SELL_PRICE } from '../packages/engine/dist/index.js'
import { NATURE_EFFECTS } from '../packages/engine/dist/index.js'
export { SHINY_SOUL_PER_EGG, SOUL_PER_EGG, SOUL_PER_SHINY_EGG, SOUL_SELL_PRICE }

/**
 * Ein Seelenfragment je Typ.
 *
 * Nicht käuflich, aber verkäuflich — und das war zuerst anders.
 *
 * Hier stand, eine Währung, die man weder kaufen noch zu Gold machen kann,
 * bleibe das, was sie sein soll. Das Argument trägt beim Kaufen und fällt beim
 * Verkaufen: wer über Wochen vor allem Käfer-Pokémon verwertet, sitzt auf
 * Fragmenten, aus denen nie ein Ei wird, und hat keinen Weg, sie loszuwerden.
 *
 * 25 Gold ist gerechnet, nicht geschätzt. Aus echtem Spielbetrieb gemessen:
 * 1,08 Bälle je Fang (32 Gold) und 1,47 Fragmente je Verwertung — ein Fragment
 * kostet also rund 22 Gold an Bällen. Bei 25 wirft die Schleife aus Ball, Fang
 * und Verwerten 4 Gold je Energie ab, gegen 24 beim bloßen Erkunden. Damit
 * lohnt es sich nie, Fragmente für Gold zu farmen, und der Überschuss ist
 * trotzdem etwas wert.
 */
/**
 * Die deutschen Naturnamen.
 *
 * Sie stehen auch im Sprachkatalog unter `nature.<id>`, und beide muessen
 * dasselbe sagen: eine "Hart-Minze", die eine Natur namens "Adamant" setzt,
 * waere eine Falle. `tools/i18n-check.py` haelt die beiden Listen zusammen.
 */
const NATUR_NAMEN: Record<string, string> = {
  lonely: 'Solo', adamant: 'Hart', naughty: 'Frech', brave: 'Mutig',
  bold: 'Kühn', impish: 'Pfiffig', lax: 'Lasch', relaxed: 'Locker',
  modest: 'Mäßig', mild: 'Mild', rash: 'Hitzig', quiet: 'Ruhig',
  calm: 'Still', gentle: 'Zart', careful: 'Sacht', sassy: 'Forsch',
  timid: 'Scheu', hasty: 'Hastig', jolly: 'Froh', naive: 'Naiv',
}

const WERT_NAMEN: Record<string, string> = {
  atk: 'Angriff', def: 'Verteidigung',
  spa: 'Spezial-Angriff', spd: 'Spezial-Verteidigung', spe: 'Initiative',
}

/** Was eine Minze kostet. Siehe die Herleitung bei `mintItems`. */
export const MINT_PRICE = 20000

/**
 * Die zwanzig Minzen — eine je Natur, die etwas bewirkt.
 *
 * Die fuenf neutralen Naturen bekommen keine: eine Minze, die nichts
 * verschiebt, waere ein Knopf ohne Wirkung. Erzeugt wird die Liste aus
 * `NATURE_EFFECTS` und nicht abgetippt — sonst stuende irgendwann auf einer
 * Minze etwas anderes, als sie tut.
 *
 * Nicht herstellbar, sondern kaeuflich, und trotzdem hinter Forschung: zwanzig
 * Rezepte haetten die Werkstatt zugeschuettet, und eine Minze *ist* kein
 * Handwerk — sie ist eine Abkuerzung, die man bezahlt. 20.000 Gold, weil sie
 * genau das erspart, was sonst eine ganze Zuchtrunde kostet: ein Pokemon mit
 * fertigen Veranlagungen und Fleisspunkten auf die richtige Natur zu bringen,
 * ohne von vorn anzufangen.
 */
export function mintItems(): ItemOut[] {
  const heraus: ItemOut[] = []
  for (const [natur, wirkung] of Object.entries(NATURE_EFFECTS)) {
    if (!wirkung) continue
    const [hoch, runter] = wirkung
    const name = NATUR_NAMEN[natur]
    if (!name) throw new Error(`Kein deutscher Name fuer die Natur "${natur}"`)
    heraus.push({
      id: `mint-${natur}`,
      name: { de: `${name}-Minze` },
      description: {
        de: `Ändert das Wesen dauerhaft auf ${name}: `
          + `steigert ${WERT_NAMEN[hoch]}, senkt ${WERT_NAMEN[runter]}.`,
      },
      category: 'mint',
      price: MINT_PRICE,
      sellPrice: Math.round(MINT_PRICE / 4),
      stackable: true,
      // Ein Bild je gesteigertem Wert, nicht je Minze: zwanzig fast gleiche
      // Zeichnungen haetten niemandem geholfen, die Farbe sagt das Wesentliche.
      icon: `/media/items/mint-${hoch}.svg`,
      params: { nature: natur, requiresResearch: 'res-mints', targetSingle: true },
    })
  }
  return heraus
}

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
    sellPrice: SOUL_SELL_PRICE,
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

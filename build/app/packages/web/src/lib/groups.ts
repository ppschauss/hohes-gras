/**
 * Wie die Basis ihre langen Listen unterteilt.
 *
 * Beide Einteilungen sind reine Anzeige — der Server kennt sie nicht und muss
 * es auch nicht. Sie stehen hier zusammen, weil Werkstatt und Labor damit
 * dasselbe Aussehen bekommen: eine Reihe zugeklappter Gruppen statt einer
 * Rolle.
 */

/**
 * Die Reihenfolge der Werkstatt-Gruppen.
 *
 * Nach dem, was man am haeufigsten sucht: Baelle zuerst, weil sie das einzige
 * sind, das man staendig nachbaut. Hintergruende zuletzt, weil sie niemand
 * herstellt, um sie zu brauchen.
 */
export const CRAFT_ORDER = [
  'ball', 'medicine', 'berry', 'xp', 'stone', 'material', 'key', 'lure', 'background',
] as const

/** Der Abschnittsname des Ladens passt fast ueberall; was fehlt, steht hier. */
export const SECTION_KEY: Record<string, string> = {
  ball: 'balls',
  berry: 'berries',
  medicine: 'medicine',
  lure: 'lures',
  xp: 'xp',
  stone: 'stones',
  background: 'backgrounds',
  key: 'key',
  material: 'materials',
}

/**
 * Die vier Forschungszentren.
 *
 * Das Labor hatte sechzehn Projekte und einen Filter nach Bauart — Rezept oder
 * Bonus. Danach sucht aber niemand: man sucht nach einem *Gebiet*, in dem man
 * besser werden will. Vier Abteilungen beantworten das, und jedes Projekt
 * gehoert in genau eine.
 *
 * Bewusst keine neuen Gebaeude: ein zweites Labor mit eigenen Stufen und
 * eigenen Kosten waere eine Aenderung an der Wirtschaft, nicht an der Ordnung.
 * Hier wird nur einsortiert, was es laengst gibt.
 */
export const RESEARCH_CENTERS = ['catching', 'field', 'battle', 'workshop'] as const
export type ResearchCenter = (typeof RESEARCH_CENTERS)[number]

const ZUORDNUNG: Record<string, ResearchCenter> = {
  'res-ultra-ball': 'catching',
  'res-catch-drop': 'catching',
  'res-catch-rate': 'catching',
  'res-shiny': 'catching',
  'res-bait': 'catching',

  'res-find': 'field',
  'res-detector': 'field',
  'res-expedition': 'field',

  'res-battle-xp': 'battle',
  'res-battle-gold': 'battle',
  'res-training': 'battle',
  'res-rare-candy': 'battle',
  'res-exp-candy': 'battle',

  'res-stones': 'workshop',
  'res-link-cable': 'workshop',
  'res-star-piece': 'workshop',
}

/** Zu welchem Zentrum ein Projekt gehoert. Unbekanntes landet in der
 *  Werkstatt — lieber an einer plausiblen Stelle als nirgends. */
export const centerOf = (projectId: string): ResearchCenter =>
  ZUORDNUNG[projectId] ?? 'workshop'

import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config.js'
import { createContext, type AppContext } from '../src/context.js'
import { buildServer } from '../src/server.js'

export const TEST_BOT_TOKEN = '123456:TESTTOKEN-abcdefghijklmnopqrstuvwxyz0123456789'

/** Sign initData the way Telegram does, so tests exercise the real check
 *  instead of a bypass that would let a regression through unnoticed.
 *
 *  Includes a `signature` field by default: real clients send one, it is part
 *  of the HMAC data-check-string, and leaving it out of the fixtures is how a
 *  broken login passed every test here once already. */
export function signInitData(user: Record<string, unknown>, extra: Record<string, string> = {}, token = TEST_BOT_TOKEN): string {
  const fields: Record<string, string> = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    signature: 'ed25519-platzhalter',
    ...extra,
  }
  const pairs = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex')
  const params = new URLSearchParams(fields)
  params.set('hash', hash)
  return params.toString()
}

/** A throwaway data dir with the minimum pack the loader accepts. Keeping the
 *  fixture tiny makes cross-validation failures obvious. */
function writeMinimalPack(dataDir: string): void {
  const dir = join(dataDir, 'packs', 'test')
  mkdirSync(dir, { recursive: true })
  const put = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value))
  put('types.json', [
    { id: 'normal', name: { de: 'Normal' }, color: '#a8a878' },
    // Nur fuer das Beet: dessen Pfleger muessen Pflanzen-Pokemon sein.
    { id: 'grass', name: { de: 'Pflanze' }, color: '#78c850' },
  ])
  put('type-chart.json', { normal: {}, grass: {} })
  put('moves.json', [
    { id: 'tackle', name: { de: 'Tackle' }, type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35 },
    { id: 'growl', name: { de: 'Heuler' }, type: 'normal', category: 'status', power: 0, accuracy: 100, pp: 40,
      effectChance: 100, effect: { kind: 'stat_stage', target: 'foe', stat: 'atk', stages: -1 } },
    // Nur fuer die Attackenauswahl: mit einer einzigen lernbaren Attacke liesse
    // sich weder das Belegen von vier Plaetzen noch eine Ablehnung pruefen.
    { id: 'quick-attack', name: { de: 'Ruckzuckhieb' }, type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 30, priority: 1 },
    { id: 'harden', name: { de: 'Härtner' }, type: 'normal', category: 'status', power: 0, accuracy: 100, pp: 30,
      effectChance: 100, effect: { kind: 'stat_stage', target: 'self', stat: 'def', stages: 1 } },
    { id: 'body-slam', name: { de: 'Bodyslam' }, type: 'normal', category: 'physical', power: 85, accuracy: 100, pp: 15 },
  ])
  const species = (id: string, dex: number, over: Record<string, unknown> = {}) => ({
    id, dexNumber: dex, name: { de: id.charAt(0).toUpperCase() + id.slice(1) }, types: ['normal'],
    baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 },
    growthRate: 'medium_fast', catchRate: 200, baseXpYield: 64, hatchCycles: 5,
    eggGroups: ['field'], learnset: [{ moveId: 'tackle', level: 1 }], evolutions: [],
    sprite: `/media/${id}.png`, spriteShiny: `/media/${id}-shiny.png`,
    ...over,
  })
  put('species.json', [
    species('testmon', 1, {
      catchRate: 45,
      evolutions: [{ trigger: 'level', to: 'testmon-evo', level: 16 }],
      learnset: [
        { moveId: 'tackle', level: 1 },
        { moveId: 'growl', level: 3 },
        { moveId: 'quick-attack', level: 5 },
        { moveId: 'harden', level: 8 },
        { moveId: 'body-slam', level: 20 },
      ],
    }),
    species('testmon-evo', 2, { hatchCycles: 5 }),
    species('wildmon', 3),
    species('nachtmon', 4),
    species('einzelmon', 5, { eggGroups: ['no-eggs'] }),
    species('blattmon', 6, { types: ['grass'] }),
    // Fangrate 3 = legendaer. Steht in keiner Spawn-Tabelle: es taucht nur
    // ueber den 0,1-Prozent-Wurf auf.
    // Legendaer heisst jetzt: so im Pack ausgewiesen. Der Fangwert bleibt
    // niedrig, weil er die Fangchance mitbestimmt — er entscheidet nur nicht
    // mehr darueber, *ob* etwas legendaer ist.
    species('sagenmon', 7, { catchRate: 3, rarity: 'legendary' }),
    // Ereignis-Art: nirgends zu fangen, doppelte EP-Kurve, zaehlt nicht in den
    // Dex.
    species('festmon', 8, { event: true, xpFactor: 2 }),
    // Zwei Typen: nur damit laesst sich pruefen, dass Verwerten je Typ ein
    // Fragment gibt statt eines je Pokemon.
    species('mischmon', 9, { types: ['normal', 'grass'] }),
    // Die beiden Tauscharten: eine wie Maschock (nur Tausch), eine wie Onix
    // (Tausch plus Tragegegenstand). Ohne beide bliebe der teurere Fall
    // ungeprueft, und genau der ist der, der schiefgehen kann.
    species('tauschmon', 10, { evolutions: [{ trigger: 'trade', to: 'tauschmon-evo' }] }),
    species('tauschmon-evo', 11),
    species('haltmon', 12, { evolutions: [{ trigger: 'trade', to: 'haltmon-evo', heldItemId: 'metal-coat' }] }),
    species('haltmon-evo', 13),
  ])
  // Dieselben Ids wie im echten Pack: Startausruestung und Pflegelogik nennen
  // sie fest, eine abweichende Fixture wuerde am eigentlichen Verhalten
  // vorbeitesten.
  put('items.json', [
    { id: 'poke-ball', name: { de: 'Pokéball' }, description: { de: 'Fängt.' }, category: 'ball', price: 30, sellPrice: 15, icon: '/media/ball.png', params: { catchMultiplier: 1 } },
    { id: 'great-ball', name: { de: 'Superball' }, description: { de: 'Fängt besser.' }, category: 'ball', price: 90, sellPrice: 45, icon: '/media/ball2.png', params: { catchMultiplier: 1.5 } },
    { id: 'oran-berry', name: { de: 'Oranbeere' }, description: { de: 'Snack.' }, category: 'berry', price: 50, sellPrice: 25, icon: '/media/berry.png' },
    // Nicht kaeuflich: sie faellt nur bei Ueberfaellen.
    { id: 'legendary-berry', name: { de: 'Sagenbeere' }, description: { de: 'Gegen Legendäre.' }, category: 'berry', price: null, sellPrice: null, icon: '/media/lberry.png', params: { legendaryBonus: 0.25 } },
    { id: 'razz-berry', name: { de: 'Himmihbeere' }, description: { de: 'Lenkt ab.' }, category: 'berry', price: 40, sellPrice: 20, icon: '/media/berry2.png', params: { catchBonus: 1.5 } },
    { id: 'potion', name: { de: 'Trank' }, description: { de: 'Heilt.' }, category: 'medicine', price: 100, sellPrice: 50, icon: '/media/potion.png', params: { heal: 20 } },
    { id: 'bg-classic', name: { de: 'Klassisch' }, description: { de: 'Wiese.' }, category: 'background', price: 0, sellPrice: null, stackable: false, icon: '/media/bg.png' },
    // Lockduft als Packung: der Preis gilt fuer fuenf Anwendungen.
    { id: 'rocket-bait', name: { de: 'Störsender' }, description: { de: 'Ruft die Bande.' }, category: 'key', price: 10000, sellPrice: 500, icon: '/media/bait.png', params: { rocketCharges: 5 } },
    { id: 'metal-detector', name: { de: 'Metalldetektor' }, description: { de: 'Piept über Schrott.' }, category: 'key', price: 500, sellPrice: 50, icon: '/media/detector.svg', params: { detectorCharges: 10 } },
    { id: 'soul-shiny', name: { de: 'Schillerndes Seelenfragment' }, description: { de: 'Saisonlohn.' }, category: 'material', price: null, sellPrice: null, icon: '/media/shiny.svg', params: { shinySoul: true } },
    { id: 'soul-normal', name: { de: 'Seelenfragment (Normal)' }, description: { de: 'Rest.' }, category: 'material', price: null, sellPrice: null, icon: '/media/soul.svg', params: { soulType: 'normal' } },
    { id: 'soul-grass', name: { de: 'Seelenfragment (Pflanze)' }, description: { de: 'Rest.' }, category: 'material', price: null, sellPrice: null, icon: '/media/soul.svg', params: { soulType: 'grass' } },
    // Prueflduft: kein Typ, dafuer eine Zusage. Beides zusammen gibt es nicht.
    { id: 'lure-legendary', name: { de: 'Legendärer Lockduft' }, description: { de: 'Zieht ein Legendäres an.' }, category: 'lure', price: null, sellPrice: null, icon: '/media/lure2.svg', params: { legendaryLure: true, packSize: 1 } },
    { id: 'lure-grass', name: { de: 'Lockduft-Pflanze' }, description: { de: 'Lockt Pflanzen an.' }, category: 'lure', price: 50, sellPrice: 10, icon: '/media/lure.png', params: { lureType: 'grass', packSize: 5 } },
    // Dieselben Ids wie im echten Pack: der Tausch-Auslöser nennt beide fest.
    { id: 'link-cable', name: { de: 'Verbindungskabel' }, description: { de: 'Simuliert einen Tausch.' }, category: 'key', price: null, sellPrice: 250, icon: '/media/cable.svg', params: { linkCable: true } },
    { id: 'metal-coat', name: { de: 'Metallmantel' }, description: { de: 'Wird beim Tausch gebraucht.' }, category: 'stone', price: 2000, sellPrice: 200, icon: '/media/coat.png' },
    // Die zwei Werkstoffe, auf die die Kampfzone ohne eigene Regionszuordnung
    // zurueckfaellt. Ohne sie faellt dort stumm nichts, und der Beutepfad
    // bliebe ungeprueft.
    { id: 'iron-shard', name: { de: 'Eisensplitter' }, description: { de: 'Schrott.' }, category: 'material', price: null, sellPrice: 20, icon: '/media/iron.png' },
    { id: 'silk-thread', name: { de: 'Seidenfaden' }, description: { de: 'Faden.' }, category: 'material', price: null, sellPrice: 20, icon: '/media/silk.png' },
  ])
  put('regions.json', [
    // Sagenmon gehoert nach Testland. Nicht nur Beiwerk: der Lader besteht
    // darauf, dass jedes Legendaere eine Region hat — genau die Pruefung, die
    // verhindert, dass wieder zehn Arten unerreichbar werden.
    { id: 'testland', order: 1, name: { de: 'Testland' }, tagline: { de: 'Test' }, legendarySpeciesIds: ['sagenmon'] },
    // Zweite Region, bewusst weit oben entworfen: nur mit ihr laesst sich
    // pruefen, dass eine Region ihren Besucher empfaengt statt ihn auszusperren
    // — und dass sie danach nicht mit ihm mitwaechst.
    // Eigene Starter: dieselbe Wahl darf in zwei Regionen zwei verschiedene
    // Listen bedeuten.
    { id: 'hochland', order: 2, name: { de: 'Hochland' }, tagline: { de: 'Hoch' }, starterSpeciesIds: ['blattmon'] },
  ])
  put('areas.json', [
    {
      id: 'test-route', regionId: 'testland', order: 1,
      name: { de: 'Testroute' }, description: { de: 'Test' },
      icon: '/media/a.png', background: '/media/b.png',
      unlock: { previousAreaId: null, minCreaturesAtLevel: null },
      // Mindestens so viele bedingungslose Spawns wie test-cave verlangt —
      // sonst faellt die Fixture selbst durch die Erreichbarkeitspruefung.
      spawns: [
        { speciesId: 'wildmon', weight: 70, minLevel: 2, maxLevel: 5 },
        { speciesId: 'einzelmon', weight: 20, minLevel: 2, maxLevel: 5 },
        { speciesId: 'nachtmon', weight: 10, minLevel: 3, maxLevel: 6, timeOfDay: ['night'] },
        // Bewusst klein gehalten: gross genug, dass sich der Unterschied mit
        // und ohne Lockduft in wenigen Dutzend Wuerfen zeigt, klein genug,
        // dass der Lockduft ihn ueberhaupt machen muss.
        { speciesId: 'blattmon', weight: 10, minLevel: 2, maxLevel: 5 },
      ],
      trainerIds: ['test-rival', 'elite-eins', 'elite-zwei'],
      gymId: 'test-gym',
    },
    {
      id: 'test-cave', regionId: 'testland', order: 2,
      name: { de: 'Testhoehle' }, description: { de: 'Dunkel' },
      icon: '/media/c.png', background: '/media/cb.png',
      unlock: {
        previousAreaId: 'test-route', minDexCaught: 2, minCaughtInPrevious: 0,
        minCreaturesAtLevel: { count: 2, level: 10 },
        requiredBadgeIds: ['test-badge'],
      },
      spawns: [{ speciesId: 'wildmon', weight: 100, minLevel: 8, maxLevel: 12 }],
      // Der Meister sitzt hier: eine Region gilt erst mit ihm als bezwungen,
      // und ohne bezwungene Region liesse sich die Reisegrenze nicht pruefen.
      gymId: 'test-champ',
    },
    {
      id: 'hoch-tal', regionId: 'hochland', order: 1,
      name: { de: 'Hochtal' }, description: { de: 'Der Einstieg, weit oben entworfen.' },
      icon: '/media/h1.png', background: '/media/h1b.png',
      // Ohne Vorbedingung: das Hochland ist eine eigene Startregion.
      unlock: { previousAreaId: null, minCaughtInPrevious: 0, minCreaturesAtLevel: null, requiredBadgeIds: [] },
      spawns: [
        { speciesId: 'wildmon', weight: 60, minLevel: 58, maxLevel: 64 },
        { speciesId: 'nachtmon', weight: 40, minLevel: 58, maxLevel: 64 },
      ],
      // Derselbe Trainer wie auf der Testroute. Im echten Pack stehen sechs
      // Trainer in zwei Gebieten; ohne so einen Fall im Fixture liesse sich
      // der Fehler dahinter nicht pruefen.
      trainerIds: ['test-rival'],
    },
    {
      id: 'hoch-gipfel', regionId: 'hochland', order: 2,
      name: { de: 'Hochgipfel' }, description: { de: 'Das Ende derselben Region.' },
      icon: '/media/h2.png', background: '/media/h2b.png',
      // Weit oben entworfen, auch in der Bedingung: nur so laesst sich pruefen,
      // dass die Levelforderung mit dem Gebiet heruntergerechnet wird.
      unlock: { previousAreaId: 'hoch-tal', minDexCaught: 1, minCaughtInPrevious: 0, minCreaturesAtLevel: { count: 1, level: 80 }, requiredBadgeIds: [] },
      spawns: [{ speciesId: 'wildmon', weight: 100, minLevel: 84, maxLevel: 94 }],
      trainerIds: [],
    },
  ])
  put('trainers.json', [
    // Zwei aus den Top Vier plus Ereignis-Gegner: genug, um Reihenfolge und
    // Ueberfall zu pruefen, ohne die Fixture aufzublaehen.
    {
      id: 'elite-eins', name: { de: 'Erste' }, title: { de: 'Top Vier' }, kind: 'elite',
      sprite: '/media/e1.png', team: [{ speciesId: 'wildmon', level: 40 }],
      rewardGold: 500, repeatRewardRatio: 0.25,
      dialogue: { intro: { de: 'Los' }, win: { de: 'Nein' }, lose: { de: 'Gut' } },
    },
    {
      id: 'elite-zwei', name: { de: 'Zweite' }, title: { de: 'Top Vier' }, kind: 'elite',
      sprite: '/media/e2.png', team: [{ speciesId: 'wildmon', level: 42 }],
      rewardGold: 600, repeatRewardRatio: 0.25,
      dialogue: { intro: { de: 'Los' }, win: { de: 'Nein' }, lose: { de: 'Gut' } },
    },
    {
      // Bewusst NICHT auf die Testregion endend: sonst wuerde bei jeder
      // Erkundung mit 6 % ein Ueberfall statt einer Begegnung kommen, und
      // jeder Safari-Test waere zufallsabhaengig. Der Ereignis-Kampf wird
      // stattdessen gezielt vorgemerkt geprueft.
      id: 'event-rocket-anderswo', name: { de: 'Rüpel' }, title: { de: 'Überfall' }, kind: 'trainer',
      sprite: '/media/ev.png', team: [{ speciesId: 'wildmon', level: 5 }],
      rewardGold: 300, repeatRewardRatio: 1,
      dialogue: { intro: { de: 'Halt!' }, win: { de: 'Ha' }, lose: { de: 'Mist' } },
    },
    {
      id: 'test-rival', name: { de: 'Rivale' }, title: { de: 'Test' }, kind: 'rival',
      sprite: '/media/t.png', team: [{ speciesId: 'wildmon', level: 3 }],
      rewardGold: 100, repeatRewardRatio: 0.25,
      dialogue: { intro: { de: 'Hey' }, win: { de: 'Ha' }, lose: { de: 'Puh' } },
    },
    {
      id: 'test-champ', name: { de: 'Meisterin' }, title: { de: 'Champ' }, kind: 'champion',
      sprite: '/media/ch.png', team: [{ speciesId: 'wildmon', level: 45 }],
      rewardGold: 2000, repeatRewardRatio: 0.1,
      dialogue: { intro: { de: 'Zeig es' }, win: { de: 'Schwach' }, lose: { de: 'Stark' } },
    },
    {
      id: 'test-gym', name: { de: 'Arenaleiter' }, title: { de: 'Leiter' }, kind: 'gym',
      sprite: '/media/g.png', badgeId: 'test-badge',
      team: [{ speciesId: 'wildmon', level: 4 }, { speciesId: 'nachtmon', level: 5 }],
      rewardGold: 500, repeatRewardRatio: 0.15,
      dialogue: { intro: { de: 'Zeig es mir' }, win: { de: 'Zu schwach' }, lose: { de: 'Verdient' } },
    },
  ])
  put('badges.json', [{
    id: 'test-badge', name: { de: 'Testorden' }, description: { de: 'Test' },
    icon: '/media/x.png', obedienceLevel: 20,
  }])
  put('chapters.json', [
    {
      id: 'ch-1-first-steps', order: 1,
      title: { de: 'Erste Schritte' }, intro: { de: 'Fang ein paar.' }, outro: { de: 'Gut.' },
      requires: [{ kind: 'dexCaught', value: 3 }],
      reward: { gold: 300, itemId: 'poke-ball', quantity: 5 },
    },
    {
      id: 'ch-2-badge', order: 2,
      title: { de: 'Erster Orden' }, intro: { de: 'Zur Arena.' }, outro: { de: 'Verdient.' },
      requires: [{ kind: 'badges', value: 1 }],
      reward: { gold: 800 },
    },
  ])
  put('pack.json', {
    id: 'test', name: 'Test', version: '1.0.0',
    starterSpeciesIds: ['testmon'], startingArea: 'test-route',
  })
}

export interface TestApp {
  app: FastifyInstance
  ctx: AppContext
  close: () => Promise<void>
  post: (path: string, body: unknown, token?: string) => Promise<{ status: number; body: any }>
  get: (path: string, token?: string) => Promise<{ status: number; body: any }>
  put: (path: string, body: unknown, token?: string) => Promise<{ status: number; body: any }>
  patch: (path: string, body: unknown, token?: string) => Promise<{ status: number; body: any }>
  del: (path: string, token?: string) => Promise<{ status: number; body: any }>
  /** Einen weiteren Trainer anlegen. Social-Funktionen brauchen zwei Konten. */
  addTrainer: (telegramId: number, name: string) => Promise<{ token: string; id: string }>
  /** Clear the rate-limit window.
   *
   *  Some tests need more calls in one go than a human ever would (throwing
   *  balls until one sticks). The limit itself is covered by its own test; here
   *  it would only turn a deterministic assertion into a flaky one. */
  resetRateLimits: () => void
  /** Die Taktkontrolle zuruecksetzen.
   *
   *  Tests klicken schneller als jede Hand — genau das, wogegen die Kontrolle
   *  schuetzt. Wer nicht sie selbst prueft, schaltet sie hier ab. */
  resetPacing: () => void
}

export async function makeTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(join(tmpdir(), 'poke-test-'))
  writeMinimalPack(dataDir)

  const config = loadConfig({
    BOT_TOKEN: TEST_BOT_TOKEN,
    SESSION_SECRET: 'test-secret-that-is-long-enough-for-the-check',
    DATA_DIR: dataDir,
    CONTENT_PACK: 'test',
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    ...overrides,
  } as NodeJS.ProcessEnv)

  const ctx = await createContext(config)
  const app = await buildServer(ctx)

  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    token?: string,
  ) => {
    const res = await app.inject({
      method, url: path,
      ...(body !== undefined ? { payload: body as object } : {}),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    let parsed: unknown = res.body
    try { parsed = JSON.parse(res.body) } catch { /* HTML-Antwort */ }
    return { status: res.statusCode, body: parsed as any }
  }

  return {
    app, ctx,
    post: (path, body, token) => call('POST', path, body, token),
    get: (path, token) => call('GET', path, undefined, token),
    put: (path, body, token) => call('PUT', path, body, token),
    patch: (path, body, token) => call('PATCH', path, body, token),
    del: (path, token) => call('DELETE', path, undefined, token),
    resetRateLimits: () => { ctx.db.prepare('DELETE FROM rate_limits').run() },
    resetPacing: () => { ctx.db.prepare('DELETE FROM action_pulse').run() },
    addTrainer: async (telegramId: number, name: string) => {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/session',
        payload: { initData: signInitData({ id: telegramId, first_name: name }) },
      })
      const body = JSON.parse(res.body)
      if (!body.token) throw new Error(`addTrainer fehlgeschlagen: ${res.body}`)
      return { token: body.token, id: body.trainer.id }
    },
    close: async () => {
      await app.close()
      ctx.db.close()
      // Das Pack-Verzeichnis wieder wegräumen. Ohne das bleibt je Testfall ein
      // Ordner von ~660 kB liegen — bei ~750 Tests pro Lauf und einer RAM-Disk
      // als /tmp ist der Host nach ein paar Wochen voll. Genau so ist es auch
      // gekommen: 19.512 Ordner, 9,8 GB.
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

import type {
  ApiError, AuthResponse, Bootstrap, CareAction, CareResponse, CenterState, CenterVisit,
  DexRow, EnergyOverview, EnergyState, GardenState, MoveSet, PlotsState, ShopState,
  StartRegion, StarterOption, TeamsState, ThemesState,
} from '@game/shared'

import { looksLikeEnergy, useEnergy } from './energyStore.js'

const TOKEN_KEY = 'poke.session'

export class ApiFailure extends Error {
  constructor(readonly code: string, readonly detail: Record<string, unknown>, readonly status: number) {
    super(code)
    this.name = 'ApiFailure'
  }
}

/**
 * Wo der Token liegt, haengt davon ab, wie man hereingekommen ist.
 *
 * In Telegram reicht `sessionStorage`: die Mini-App holt sich beim naechsten
 * Oeffnen ohnehin eine frische Sitzung aus dem `initData`. Im Browser gibt es
 * diese Quelle nicht — laege der Token dort nur in der Sitzung, muesste man
 * nach jedem Schliessen des Tabs einen neuen Code aus dem Chat holen.
 * `localStorage` ist deshalb kein Bequemlichkeitsgewinn, sondern das, was die
 * Anmeldung ueberhaupt brauchbar macht. Die Sitzung dahinter laeuft nach
 * dreissig Tagen ab und ist jederzeit widerrufbar.
 */
let token: string | null = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY)

export const setToken = (value: string | null, persist = false): void => {
  token = value
  sessionStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
  if (value) (persist ? localStorage : sessionStorage).setItem(TOKEN_KEY, value)
}

export const hasToken = (): boolean => token !== null

/**
 * Einmal neu laden, wenn der Server einen neuen Bau ausliefert.
 *
 * Eine Mini-App bleibt tagelang offen. Wer sie ueber einen Deploy hinweg nicht
 * neu laedt, spricht mit einem neuen Server und einer alten Oberflaeche — und
 * bekommt fuer jede Antwortart, die es beim Laden noch nicht gab, irgendetwas
 * Falsches angezeigt. Genau so gemeldet: neue Fundstuecke kamen als "nichts
 * gefunden" an, obwohl sie laengst im Beutel lagen.
 *
 * Das Flag verhindert eine Schleife, falls das Neuladen selbst scheitert.
 */
let seenBuild: string | null = null
let reloading = false

function checkBuild(build: string | null): void {
  if (!build) return
  if (seenBuild === null) { seenBuild = build; return }
  if (build === seenBuild || reloading) return
  reloading = true
  window.location.reload()
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (init.body) headers.set('content-type', 'application/json')
  if (token) headers.set('authorization', `Bearer ${token}`)

  const res = await fetch(path, { ...init, headers })
  checkBuild(res.headers.get('x-app-build'))
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const err = body as ApiError
    // A dead session is not an error the UI should show; it means log in again.
    if (res.status === 401) setToken(null)
    throw new ApiFailure(err.error ?? 'unknown', err.detail ?? {}, res.status)
  }

  // Jede Antwort, die einen Energiestand mitbringt, aktualisiert die Anzeige in
  // der Kopfzeile. So bleibt sie aktuell, ohne dass jeder Bildschirm daran
  // denken muss.
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>
    if (looksLikeEnergy(record.energy)) useEnergy.getState().setEnergy(record.energy)
    // Gold steht in fast jeder Antwort, die es veraendert — Beutel, Shop,
    // Beet, Energie. Damit bleibt die Kopfzeile aktuell, ohne dass ein
    // Bildschirm daran denken muss.
    if (typeof record.gold === 'number') useEnergy.getState().setGold(record.gold)
  }
  return body as T
}

export const api = {
  health: () => request<{ ok: boolean; species: number; pack: string }>('/api/health'),

  authenticate: (initData: string) =>
    request<AuthResponse>('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    }),

  state: () => request<Bootstrap>('/api/state'),
  today: () => request<TodayView>('/api/today'),

  garden: () => request<GardenState>('/api/garden'),
  care: (action: CareAction) =>
    request<CareResponse>('/api/garden/care', { method: 'POST', body: JSON.stringify({ action }) }),
  setBackground: (itemId: string) =>
    request<GardenState>('/api/garden/background', { method: 'POST', body: JSON.stringify({ itemId }) }),

  starterInfo: (regionId?: string) =>
    request<{ needsStarter: boolean; options: StarterOption[]; regions: StartRegion[] }>(
      regionId ? `/api/starter?regionId=${encodeURIComponent(regionId)}` : '/api/starter',
    ),
  chooseStarter: (speciesId: string, regionId: string | null) =>
    request<GardenState>('/api/starter', {
      method: 'POST',
      body: JSON.stringify(regionId ? { speciesId, regionId } : { speciesId }),
    }),

  box: () => request<{
    creatures: CreatureLike[]; teamCapacity: number; boxCapacity: number; boxUsed: number
  }>('/api/box'),
  setTeam: (creatureIds: string[]) =>
    request<GardenState>('/api/team', { method: 'POST', body: JSON.stringify({ creatureIds }) }),

  teams: () => request<TeamsState>('/api/teams'),
  createTeam: (name: string) =>
    request<TeamsState>('/api/teams', { method: 'POST', body: JSON.stringify({ name }) }),
  renameTeam: (teamId: string, name: string) =>
    request<TeamsState>(`/api/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteTeam: (teamId: string) =>
    request<TeamsState>(`/api/teams/${teamId}`, { method: 'DELETE' }),
  setTeamMembers: (teamId: string, creatureIds: string[]) =>
    request<TeamsState>(`/api/teams/${teamId}/members`, { method: 'PUT', body: JSON.stringify({ creatureIds }) }),
  activateTeam: (teamId: string) =>
    request<TeamsState>(`/api/teams/${teamId}/activate`, { method: 'POST', body: '{}' }),

  moveSet: (creatureId: string) => request<MoveSet>(`/api/creatures/${creatureId}/moves`),
  setMoves: (creatureId: string, moveIds: string[]) =>
    request<MoveSet>(`/api/creatures/${creatureId}/moves`, {
      method: 'PUT', body: JSON.stringify({ moveIds }),
    }),

  themes: () => request<ThemesState>('/api/themes'),
  buyTheme: (themeId: string) =>
    request<ThemesState>('/api/themes/buy', { method: 'POST', body: JSON.stringify({ themeId }) }),
  wearTheme: (themeId: string) =>
    request<ThemesState>('/api/themes/wear', { method: 'POST', body: JSON.stringify({ themeId }) }),
  setThemeMode: (mode: 'auto' | 'day' | 'night') =>
    request<ThemesState>('/api/themes/mode', { method: 'POST', body: JSON.stringify({ mode }) }),

  plots: () => request<PlotsState>('/api/plots'),
  plant: (body: { slot: number; kind: 'item' | 'gold'; itemId?: string; amount: number; tenderId?: string | null }) =>
    request<PlotsState>('/api/plots/plant', { method: 'POST', body: JSON.stringify(body) }),
  tendPlot: (slot: number) =>
    request<{ kind: 'weed' | 'water'; phasesDone: number; bonusPercent: number; state: PlotsState }>(
      '/api/plots/tend', { method: 'POST', body: JSON.stringify({ slot }) }),
  harvestPlot: (slot: number) =>
    request<{
      kind: 'item' | 'gold'; itemId: string | null; name: string; icon: string
      staked: number; received: number; bonusPercent: number; state: PlotsState
    }>('/api/plots/harvest', { method: 'POST', body: JSON.stringify({ slot }) }),
  setPlotTender: (slot: number, tenderId: string | null) =>
    request<PlotsState>('/api/plots/tender', { method: 'POST', body: JSON.stringify({ slot, tenderId }) }),

  center: () => request<CenterState>('/api/center'),
  centerVisit: () => request<CenterVisit>('/api/center/visit', { method: 'POST', body: '{}' }),
  acceptTrade: (offerId: string, creatureId: string) =>
    request<{ gaveName: string; received: CreatureLike; newDexEntry: boolean; state: CenterState }>(
      '/api/center/trade/accept', { method: 'POST', body: JSON.stringify({ offerId, creatureId }) }),
  declineTrade: (offerId: string) =>
    request<CenterState>('/api/center/trade/decline', { method: 'POST', body: JSON.stringify({ offerId }) }),

  energy: () => request<EnergyOverview>('/api/energy'),
  buyEnergy: (packId: string) =>
    request<EnergyOverview>('/api/energy/buy', { method: 'POST', body: JSON.stringify({ packId }) }),
  expandEnergy: () => request<EnergyOverview>('/api/energy/expand', { method: 'POST', body: '{}' }),

  dex: () => request<{ rows: DexRow[]; counts: { seen: number; caught: number; total: number } }>('/api/dex'),

  world: () => request<WorldMap>('/api/world'),
  travel: (areaId: string) =>
    request<WorldMap>('/api/world/travel', { method: 'POST', body: JSON.stringify({ areaId }) }),
  setLevelScaling: (enabled: boolean) =>
    request<WorldMap>('/api/world/scaling', { method: 'POST', body: JSON.stringify({ enabled }) }),

  safari: (ballId: string, berryId: string | null) =>
    request<SafariState>(`/api/safari?ballId=${encodeURIComponent(ballId)}${berryId ? `&berryId=${encodeURIComponent(berryId)}` : ''}`),
  explore: (ballId: string, berryId: string | null, lureId: string | null = null) =>
    request<ExploreResponse>('/api/safari/explore', {
      method: 'POST', body: JSON.stringify({ ballId, berryId, lureId }),
    }),
  useJammer: () => request<{ charges: number }>('/api/safari/jammer', { method: 'POST' }),
  useDetector: () => request<{ charges: number }>('/api/safari/detector', { method: 'POST' }),
  useLegendaryBerry: (ballId: string, berryId: string | null) =>
    request<EncounterView>('/api/safari/berry', { method: 'POST', body: JSON.stringify({ ballId, berryId }) }),
  soften: (action: 'weaken' | 'calm', ballId: string, berryId: string | null) =>
    request<EncounterView>('/api/safari/soften', { method: 'POST', body: JSON.stringify({ action, ballId, berryId }) }),
  throwBall: (ballId: string, berryId: string | null) =>
    request<ThrowResult>('/api/safari/throw', { method: 'POST', body: JSON.stringify({ ballId, berryId }) }),
  flee: () => request<{ ok: boolean }>('/api/safari/flee', { method: 'POST', body: '{}' }),
  startEventBattle: () => request<BattleView>('/api/battle/event', { method: 'POST', body: '{}' }),

  expeditions: () => request<ExpeditionOverview>('/api/expeditions'),
  startExpedition: (kind: string, duration: string, creatureIds: string[]) =>
    request<{ overview: ExpeditionOverview }>('/api/expeditions', {
      method: 'POST', body: JSON.stringify({ kind, duration, creatureIds }),
    }),
  rushExpedition: (id: string) =>
    request<{ result: { cost: number; endsAt: number }; overview: ExpeditionOverview }>(
      '/api/expeditions/rush', { method: 'POST', body: JSON.stringify({ id }) },
    ),
  collectExpedition: (id: string) =>
    request<{ result: CollectResult; overview: ExpeditionOverview }>('/api/expeditions/collect', {
      method: 'POST', body: JSON.stringify({ id }),
    }),

  exportUrl: () => '/api/account/export',

  redeemLink: (code: string) =>
    request<{ token: string; expiresAt: number }>('/api/auth/link/redeem', {
      method: 'POST', body: JSON.stringify({ code }),
    }),

  useItem: (itemId: string, creatureId?: string) =>
    request<{ result: UseItemResult }>('/api/items/use', {
      method: 'POST', body: JSON.stringify({ itemId, creatureId }),
    }),

  sendGift: (trainerId: string) =>
    request<{ sent: { to: string; egg: boolean; label: string }; friends: FriendOverview }>(
      '/api/friends/gift', { method: 'POST', body: JSON.stringify({ trainerId }) }),
  openGift: (giftId: string) =>
    request<{
      opened: { label: string; egg: { id: string; speciesId: string } | null; eggSkipped: boolean }
      friends: FriendOverview
    }>('/api/gifts/open', { method: 'POST', body: JSON.stringify({ giftId }) }),

  areaSpawns: () => request<AreaSpawns>('/api/area/spawns'),

  arena: () => request<ArenaView>('/api/arena'),
  arenaStart: (tier: string) =>
    request<{ arena: ArenaView }>('/api/arena/start', { method: 'POST', body: JSON.stringify({ tier }) }),
  arenaNext: () =>
    request<{ done: boolean; won: boolean; healed: number; battle: unknown | null; arena: ArenaView }>(
      '/api/arena/next', { method: 'POST', body: '{}' }),
  arenaAbandon: () => request<{ arena: ArenaView }>('/api/arena/abandon', { method: 'POST', body: '{}' }),

  gauntlet: () => request<GauntletView>('/api/gauntlet'),
  gauntletStart: (regionId: string) =>
    request<{ gauntlet: GauntletView }>('/api/gauntlet/start', {
      method: 'POST', body: JSON.stringify({ regionId }),
    }),
  gauntletAbandon: () =>
    request<{ gauntlet: GauntletView; summary: GauntletSummary | null }>(
      '/api/gauntlet/abandon', { method: 'POST', body: '{}' }),

  login: () => request<LoginView>('/api/login'),
  claimLogin: () => request<{
    day: number; streak: number; bonus: boolean; label: string; state: LoginView
  }>('/api/login/claim', { method: 'POST', body: '{}' }),

  souls: () => request<{
    souls: SoulView[]; eggsOpen: number; eggsMax: number
    shinySouls: number; shinySoulsPerEgg: number
  }>('/api/souls'),
  salvage: (creatureId: string) =>
    request<{ result: SalvageResult; souls: SoulView[] }>('/api/souls/salvage', {
      method: 'POST', body: JSON.stringify({ creatureId }),
    }),
  salvageMany: (creatureIds: string[]) =>
    request<{ bulk: BulkSalvageResult; souls: SoulView[] }>('/api/souls/salvage', {
      method: 'POST', body: JSON.stringify({ creatureIds }),
    }),
  redeemSouls: (typeId: string, shiny = false) =>
    request<{ egg: { id: string; speciesId: string }; souls: SoulView[] }>('/api/souls/redeem', {
      method: 'POST', body: JSON.stringify({ typeId, shiny }),
    }),

  sessions: () => request<{ sessions: SessionView[] }>('/api/sessions'),
  linkCode: () => request<{ code: string; expiresAt: number }>('/api/auth/link/code', { method: 'POST' }),
  revokeSession: (id: string) =>
    request<{ sessions: SessionView[] }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () =>
    request<{ removed: number; sessions: SessionView[] }>('/api/sessions/revoke-others', { method: 'POST' }),
  deleteAccount: (confirm: string) =>
    request<{ deleted: boolean; deletedRows: number }>('/api/account/delete', {
      method: 'POST', body: JSON.stringify({ confirm }),
    }),

  admin: () => request<AdminDashboard>('/api/admin'),
  release: () => request<ReleaseInfo>('/api/admin/release'),
  requestUpdate: () => request<ReleaseInfo>('/api/admin/update', { method: 'POST', body: '{}' }),
  setBan: (targetId: string, value: boolean) =>
    request<AdminDashboard>('/api/admin/ban', { method: 'POST', body: JSON.stringify({ targetId, value }) }),

  story: () => request<StoryView>('/api/story'),
  claimChapter: (chapterId: string) =>
    request<{ chapterId: string; story: StoryView }>('/api/story/claim', {
      method: 'POST', body: JSON.stringify({ chapterId }),
    }),

  evolutions: () => request<{ candidates: EvolutionCandidate[] }>('/api/evolutions'),
  tradeStation: () => request<TradeStationView>('/api/trade-station'),

  evolve: (creatureId: string, targetSpeciesId: string) =>
    request<{
      creature: CreatureLike; fromName: string; newDexEntry: boolean
      energyGained: number; energyLeftToday: number
    }>('/api/evolutions/evolve', {
      method: 'POST', body: JSON.stringify({ creatureId, targetSpeciesId }),
    }),

  buildings: () => request<BuildingsView>('/api/buildings'),
  upgradeBuilding: (buildingId: string) =>
    request<{ buildingId: string; level: number; cost: number; buildings: BuildingsView }>('/api/buildings/upgrade', {
      method: 'POST', body: JSON.stringify({ buildingId }),
    }),

  tendEgg: (id: string) =>
    request<{ overview: EggOverview }>('/api/eggs/tend', { method: 'POST', body: JSON.stringify({ id }) }),
  setBrooder: (id: string, creatureId: string | null) =>
    request<{ overview: EggOverview }>('/api/eggs/brooder', {
      method: 'POST', body: JSON.stringify({ id, creatureId }),
    }),

  habitat: (speciesId: string) =>
    request<HabitatView>(`/api/dex/habitat?speciesId=${encodeURIComponent(speciesId)}`),

  boarding: () => request<BoardingView>('/api/boarding'),
  dropBoarding: (creatureId: string) =>
    request<{ boarding: BoardingView }>('/api/boarding/drop', {
      method: 'POST', body: JSON.stringify({ creatureId }),
    }),
  pickBoarding: (id: string) =>
    request<{ result: BoardingPickup; boarding: BoardingView }>('/api/boarding/pick', {
      method: 'POST', body: JSON.stringify({ id }),
    }),

  quests: () => request<QuestOverview>('/api/quests'),
  claimQuest: (questId: string) =>
    request<{ result: { questId: string; gold: number }; quests: QuestOverview }>('/api/quests/claim', {
      method: 'POST', body: JSON.stringify({ questId }),
    }),

  research: () => request<ResearchView>('/api/research'),
  startResearch: (projectId: string, creatureId: string) =>
    request<{ research: ResearchView }>('/api/research/start', {
      method: 'POST', body: JSON.stringify({ projectId, creatureId }),
    }),
  trainCreature: (creatureId: string, stat: string) =>
    request<{ research: ResearchView }>('/api/research/train', {
      method: 'POST', body: JSON.stringify({ creatureId, stat }),
    }),
  collectResearch: (id: string) =>
    request<{ result: ResearchClaimView; research: ResearchView }>('/api/research/collect', {
      method: 'POST', body: JSON.stringify({ id }),
    }),
  abortResearch: (id: string) =>
    request<{ research: ResearchView }>('/api/research/abort', {
      method: 'POST', body: JSON.stringify({ id }),
    }),

  crafting: () => request<CraftingView>('/api/crafting'),
  craft: (recipeId: string, count?: number) =>
    request<{ output: { itemId: string; quantity: number }; crafting: CraftingView }>('/api/crafting/craft', {
      method: 'POST', body: JSON.stringify({ recipeId, ...(count === undefined ? {} : { count }) }),
    }),

  season: () => request<SeasonView>('/api/season'),
  claimSeasonTier: (tier: number) =>
    request<{ tier: number; label: string; season: SeasonView }>('/api/season/claim', {
      method: 'POST', body: JSON.stringify({ tier }),
    }),

  achievements: () => request<AchievementsView>('/api/achievements'),
  claimAchievement: (achievementId: string) =>
    request<{ gold: number; achievements: AchievementsView }>('/api/achievements/claim', {
      method: 'POST', body: JSON.stringify({ achievementId }),
    }),

  guild: () => request<GuildOverview>('/api/guild'),
  foundGuild: (name: string, tag: string, motto: string) =>
    request<GuildOverview>('/api/guild/found', { method: 'POST', body: JSON.stringify({ name, tag, motto }) }),
  joinGuild: (guildId: string) =>
    request<GuildOverview>('/api/guild/join', { method: 'POST', body: JSON.stringify({ guildId }) }),
  leaveGuild: () => request<GuildOverview>('/api/guild/leave', { method: 'POST', body: '{}' }),
  claimGuildGoal: (kind: string) =>
    request<{ gold: number; guild: GuildOverview }>('/api/guild/claim', {
      method: 'POST', body: JSON.stringify({ kind }),
    }),

  raids: () => request<RaidOverview>('/api/raids'),
  summonRaid: (tier: 1 | 3 | 5) =>
    request<RaidOverview>('/api/raids/summon', { method: 'POST', body: JSON.stringify({ tier }) }),
  attackRaid: (raidId: string) =>
    request<RaidAttackResponse>('/api/raids/attack', { method: 'POST', body: JSON.stringify({ raidId }) }),

  pvp: () => request<PvpOverview>('/api/pvp'),
  pvpLadder: () => request<PvpLadder>('/api/pvp/ladder'),
  pvpHistory: () => request<{ duels: PvpHistoryEntry[] }>('/api/pvp/history'),
  duel: (opponentId: string) =>
    request<DuelResult>('/api/pvp/duel', { method: 'POST', body: JSON.stringify({ opponentId }) }),

  tournament: () => request<TournamentView>('/api/tournament'),
  enterTournament: () => request<TournamentView>('/api/tournament/enter', { method: 'POST', body: '{}' }),

  friends: () => request<FriendOverview>('/api/friends'),
  requestFriend: (code: string) =>
    request<{ status: 'sent' | 'accepted' }>('/api/friends/request', { method: 'POST', body: JSON.stringify({ code }) }),
  respondFriend: (fromId: string, accept: boolean) =>
    request<FriendOverview>('/api/friends/respond', { method: 'POST', body: JSON.stringify({ fromId, accept }) }),
  removeFriend: (trainerId: string) =>
    request<FriendOverview>('/api/friends/remove', { method: 'POST', body: JSON.stringify({ trainerId }) }),

  myCard: () => request<TrainerCard>('/api/card'),
  card: (trainerId: string) => request<TrainerCard>(`/api/card/${trainerId}`),

  market: () => request<MarketOverview>('/api/market'),
  listOnMarket: (creatureId: string, price: number, note: string) =>
    request<MarketOverview>('/api/market/list', { method: 'POST', body: JSON.stringify({ creatureId, price, note }) }),
  cancelListing: (listingId: string) =>
    request<MarketOverview>('/api/market/cancel', { method: 'POST', body: JSON.stringify({ listingId }) }),
  buyListing: (listingId: string) =>
    request<{ paid: number; market: MarketOverview }>('/api/market/buy', { method: 'POST', body: JSON.stringify({ listingId }) }),

  trades: () => request<TradeOverview>('/api/trades'),
  offerTrade: (toTrainerId: string, offeredId: string, requestedId: string | null, message: string) =>
    request<TradeOverview>('/api/trades/offer', {
      method: 'POST', body: JSON.stringify({ toTrainerId, offeredId, requestedId, message }),
    }),
  respondTrade: (tradeId: string, accept: boolean) =>
    request<{ accepted: boolean; trades: TradeOverview }>('/api/trades/respond', {
      method: 'POST', body: JSON.stringify({ tradeId, accept }),
    }),

  chat: () => request<ChatView>('/api/chat'),
  sendChat: (text: string) =>
    request<ChatView>('/api/chat', { method: 'POST', body: JSON.stringify({ text }) }),

  leaderboard: () => request<LeaderboardView>('/api/leaderboard'),
  setPrivacy: (changes: Record<string, boolean>) =>
    request<unknown>('/api/privacy', { method: 'POST', body: JSON.stringify(changes) }),

  opponents: () => request<OpponentList>('/api/battle/opponents'),
  currentBattle: () => request<{ battle: BattleView | null; arena: ArenaContext | null }>('/api/battle'),
  startBattle: (opponentId: string) =>
    request<BattleView>('/api/battle/start', { method: 'POST', body: JSON.stringify({ opponentId }) }),
  battleAction: (action: BattleAction) =>
    request<BattleView & {
      arena: ArenaContext | null
      /** Der Durchlauf ist weitergegangen: geheilt und naechster Gegner. */
      arenaAdvance?: { healed: number; round: number | null }
      /** Der Durchlauf ist zu Ende. */
      arenaDone?: {
        payout: {
          gold: number
          /** Ein weiterer Durchlauf am selben Tag zahlt ein Viertel. */
          repeat: boolean
          items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
        } | null
      }
    }>('/api/battle/action', { method: 'POST', body: JSON.stringify(action) }),
  forfeitBattle: () => request<BattleView>('/api/battle/forfeit', { method: 'POST', body: '{}' }),
  healTeam: () => request<{ cost: number; healed: number; gold: number }>('/api/team/heal', { method: 'POST', body: '{}' }),

  eggs: () => request<EggOverview>('/api/eggs'),
  rushEgg: (id: string) =>
    request<{ overview: EggOverview }>('/api/eggs/rush', { method: 'POST', body: JSON.stringify({ id }) }),
  pairEggs: (creatureIdA: string, creatureIdB: string) =>
    request<{ overview: EggOverview }>('/api/eggs/pair', {
      method: 'POST', body: JSON.stringify({ creatureIdA, creatureIdB }),
    }),
  hatchEgg: (id: string) =>
    request<{ creature: CreatureLike; newDexEntry: boolean; overview: EggOverview }>('/api/eggs/hatch', {
      method: 'POST', body: JSON.stringify({ id }),
    }),

  bag: () => request<{ gold: number; items: BagItem[] }>('/api/bag'),
  shop: () => request<ShopState>('/api/shop'),
  buy: (itemId: string, quantity = 1) =>
    request<ShopState>('/api/shop/buy', { method: 'POST', body: JSON.stringify({ itemId, quantity }) }),
  sell: (itemId: string, quantity = 1) =>
    request<ShopState>('/api/shop/sell', { method: 'POST', body: JSON.stringify({ itemId, quantity }) }),
}

export type CreatureLike = GardenState['team'][number]

export interface BagItem {
  id: string
  quantity: number
  name: string
  description: string
  category: string
  icon: string
  sellPrice: number | null
}


/* ---------------------------------------------------------------------------
 * Response shapes for the world features.
 *
 * Declared here rather than in @game/shared because they are assembled by
 * services from several sources; duplicating a zod schema for them would mean
 * maintaining the same shape twice with no extra safety on the client, which
 * only ever reads them.
 * ------------------------------------------------------------------------- */

export interface TypeChip { id: string; name: string; color: string }

export interface UnlockRequirement {
  kind: 'previous_area' | 'dex_caught' | 'creatures_at_level' | 'badges' | 'region_cleared'
  met: boolean
  label: string
  have: number
  need: number
  detail?: string[]
}

export interface AreaView {
  id: string
  name: string
  description: string
  icon: string
  order: number
  unlocked: boolean
  visited: boolean
  isCurrent: boolean
  requirements: UnlockRequirement[]
  caughtHere: number
  speciesHere: number
  encounters: number
  gymId: string | null
  gymCleared: boolean
  trainerCount: number
  spawnableNow: number
  levels: { min: number; max: number }
  /** Wie viele Level die dynamische Skalierung draufgelegt hat. */
  levelBoost: number
}

export interface TodayTask {
  kind: 'expedition' | 'plot_harvest' | 'plot_tend' | 'center' | 'egg' | 'pvp' | 'raid' | 'care'
  screen: string
  count: number
  order: number
}

export interface TodayView {
  tasks: TodayTask[]
  energy: EnergyState
  gold: number
  teamSize: number
  nextAt: number | null
  journey: {
    areaName: string | null
    dexCaught: number
    dexTotal: number
    badges: number
    badgeTotal: number
  }
}

export interface WorldMap {
  regions: Array<{
    id: string; name: string; tagline: string; areas: AreaView[]
    entered: boolean; cleared: boolean; locked: boolean
  }>
  clock: { timeOfDay: string; weather: string; gameDate: string }
  currentAreaId: string | null
  badges: string[]
  levelScaling: boolean
  /** Median-Level des aktiven Teams; 0, wenn die Skalierung aus ist. */
  referenceLevel: number
  league: Array<{
    regionId: string
    regionName: string
    cleared: boolean
    badges: { have: number; need: number }
    elites: Array<{ id: string; name: string; defeated: boolean; locked: boolean }>
    champion: { id: string; name: string; defeated: boolean; locked: boolean } | null
  }>
  /** Die Reisegrenze: das hoechste Level, das fuer diesen Trainer ueberhaupt
   *  existiert. Waechst mit jeder bezwungenen Region. */
  travel: {
    cap: number
    clearedRegions: number
    totalRegions: number
    levelsPerRegion: number
    nextCap: number | null
  }
}

export interface EncounterView {
  active: boolean
  /** Art schon im Dex. */
  caught: boolean
  areaId: string
  areaName: string
  speciesId: string
  speciesName: string
  sprite: string
  types: TypeChip[]
  level: number
  shiny: boolean
  rarity: string
  turn: number
  weakenStacks: number
  calmStacks: number
  maxWeaken: number
  maxCalm: number
  probability: number
  chain: number
  legendary: boolean
  legendaryBerries: number
  maxLegendaryBerries: number
  berriesOwned: number
}

export interface SafariState {
  encounter: EncounterView | null
  exploresUsed: number
  energy: EnergyState
  energyCost: number
  /** Restliche Erkundungen mit garantiertem Überfall. */
  jammerCharges: number
  /** Restliche Erkundungen mit garantiertem Fundstück. */
  detectorCharges: number
  /** Laufende Fangserie — sie zählt nur für die gejagte Art. */
  chain: {
    speciesId: string
    speciesName: string
    sprite: string
    streak: number
    cap: number
    odds: number
    baseOdds: number
    plateau: number
    plateauOdds: number
  } | null
}

export interface LureUse {
  itemId: string
  name: string
  typeName: string
  left: number
}

/** Was im Unterholz lag — beim Eintreffen hier schon eingesammelt. */
export interface FindResult {
  what: 'item' | 'coins' | 'fragment'
  itemId: string | null
  name: string
  icon: string | null
  quantity: number
  gold: number
  /** Restliche Ladungen des Detektors; null, wenn es Zufall war. */
  detectorLeft: number | null
}

export type ExploreResponse =
  | { kind: 'encounter'; encounter: EncounterView; legendary: boolean; lure: LureUse | null }
  | { kind: 'nothing'; lure: LureUse | null }
  | { kind: 'event'; opponent: { id: string; name: string; title: string; kind: string; sprite: string; intro: string }; wanderer: boolean; lure: LureUse | null }
  | { kind: 'find'; find: FindResult; lure: LureUse | null }

export interface ThrowResult {
  caught: boolean
  shakes: number
  probability: number
  fled: boolean
  creature: CreatureLike | null
  newDexEntry: boolean
  chain: number
  reward: { gold: number } | null
  areaCompleted: { areaId: string; areaName: string; energy: number } | null
  encounter: EncounterView | null
}

export interface ResearchInput {
  itemId: string
  name: string
  icon: string
  quantity: number
  have: number
}

export interface ResearchProjectView {
  id: string
  kind: 'recipe' | 'bonus' | 'training'
  tiers: number
  done: number
  complete: boolean
  lab: number
  bonusNow: number
  bonusNext: number
  step: number
  unlocks: string | null
  hours: number
  goldCost: number
  xp: number
  inputs: ResearchInput[]
  blockedReason: string | null
}

export interface ResearchClaimView {
  projectId: string
  tier: number
  training: boolean
  stat: string | null
  creatureName: string | null
  xpGained: number
  leveledUp: boolean
  newLevel: number | null
  evGained: number
}

export interface ResearchView {
  lab: number
  slots: number
  used: number
  gold: number
  trainingUnlocked: boolean
  evPerTraining: number
  evMaxPerStat: number
  evMaxTotal: number
  training: { hours: number; gold: number; inputs: ResearchInput[] }
  running: Array<{
    id: string
    projectId: string
    training: boolean
    tier: number
    stat: string | null
    creatureName: string | null
    readyAt: number
    ready: boolean
    totalMs: number
    xp: number
  }>
  projects: ResearchProjectView[]
}

export interface QuestView {
  id: string
  cadence: 'daily' | 'weekly'
  metric: string
  target: number
  progress: number
  complete: boolean
  claimed: boolean
  reward: { gold: number; items: Array<{ itemId: string; name: string; icon: string; quantity: number }> }
}

export interface QuestOverview {
  daily: QuestView[]
  weekly: QuestView[]
  perDay: number
  perWeek: number
  dayKey: string
  weekKey: string
}

export interface HabitatArea {
  areaId: string
  areaName: string
  regionId: string
  regionName: string
  chance: number
  minLevel: number
  maxLevel: number
  timeOfDay: string[] | null
  weather: string[] | null
  visited: boolean
  availableNow: boolean
}

export interface HabitatView {
  speciesId: string
  known: boolean
  name: string | null
  sprite: string | null
  areas: HabitatArea[]
}

export interface BoardingEntry {
  id: string
  creatureId: string
  name: string
  sprite: string
  level: number
  levelAtStart: number
  startedAt: number
  readyAt: number
  ready: boolean
  progress: number
  levelsEarned: number
  levelsMax: number
  energyCost: number
}

export interface BoardingView {
  slots: number
  used: number
  hours: number
  maxLevels: number
  abortCost: number
  levelCap: number
  entries: BoardingEntry[]
}

export interface BoardingPickup {
  name: string
  levelsGained: number
  newLevel: number
  early: boolean
  energySpent: number
}

export interface ExpeditionView {
  id: string
  kind: string
  kindName: string
  duration: string
  areaName: string
  startedAt: number
  endsAt: number
  ready: boolean
  /** Energie, um den Rest zu überspringen. */
  rushCost: number
  members: Array<{ id: string; name: string; sprite: string; level: number }>
}

export interface ExpeditionOverview {
  open: ExpeditionView[]
  /** null = unbegrenzt viele gleichzeitig. */
  maxOpen: number | null
  energy: EnergyState
  kinds: Array<{ id: string; name: string; favouredTypes: TypeChip[] }>
  durations: Array<{ id: string; minutes: number; energyCost: number; trainerEnergyCost: number }>
  available: Array<{
    id: string; name: string; sprite: string; level: number; energy: number; types: string[]
    /** Auf welche Arten von Expedition dieses Pokémon überhaupt darf. */
    fitsKinds: string[]
  }>
  /** Was ungefähr herauskommt, je Art und Dauer, bei vollem passendem Team. */
  expected: Array<{
    kindId: string
    durationId: string
    gold: number
    xpPerMember: number
    loot: Array<{ itemId: string; name: string; icon: string; quantity: number }>
  }>
  partyRange: { min: number; max: number }
}

export interface CollectResult {
  loot: Array<{ itemId: string; name: string; quantity: number; icon: string; category: string }>
  gold: number
  xpPerMember: number
  levelUps: Array<{ creatureId: string; name: string; newLevel: number }>
}

export interface EggView {
  id: string
  speciesKnown: boolean
  speciesName: string | null
  sprite: string | null
  shiny: boolean
  progress: number
  hatchMinutes: number
  minutesLeft: number
  ready: boolean
  ivPercentHint: string
  /* Brut-Beet */
  phasesDone: number
  phases: number
  phaseDue: boolean
  phaseKind: 'warm' | 'turn'
  nextPhaseAt: number | null
  brooder: { id: string; name: string; sprite: string; level: number } | null
  care: number
  minutesSaved: number
  ivBonus: number
  shinyFactor: number
}

export interface EggOverview {
  eggs: EggView[]
  maxEggs: number
  minLevel: number
  candidates: Array<{ id: string; name: string; sprite: string; level: number; eggGroups: string[]; shiny: boolean }>
}


export type BattleAction =
  | { kind: 'move'; moveIndex: number }
  | { kind: 'switch'; partyIndex: number }
  | { kind: 'item'; itemId: string; targetIndex: number }
  | { kind: 'forfeit' }

export interface OpponentEntry {
  id: string
  name: string
  title: string
  kind: string
  isGym: boolean
  sprite: string
  teamSize: number
  maxLevel: number
  rewardGold: number
  defeated: boolean
  wins: number
  badgeId: string | null
  badgeEarned: boolean
  intro: string
  /** Warum gerade nicht — null, wenn es geht. Nur bei Liga-Gegnern gesetzt. */
  locked: {
    reason: 'elite_locked' | 'champion_locked'
    /** Wer vorher dran ist (bei `elite_locked`). */
    requiresName?: string
    /** Wie viele der Top Vier noch offen sind (bei `champion_locked`). */
    missing?: number
  } | null
}

export interface OpponentList {
  areaId: string
  areaName: string
  /** Streuner der Route — ohne Liga. */
  trainers: OpponentEntry[]
  /** Die Top Vier, in ihrer Reihenfolge. */
  elites: OpponentEntry[]
  champion: OpponentEntry | null
  gym: OpponentEntry | null
}

export interface BattleFighterView {
  id: string
  name: string
  level: number
  hp: number
  hpMax: number
  status: string
  sprite: string
  shiny: boolean
  types: TypeChip[]
  stages: Record<string, number>
  confused: boolean
  fainted: boolean
}

export interface BattleMoveView {
  index: number
  id: string
  name: string
  type: string
  typeColor: string
  category: string
  power: number
  accuracy: number
  pp: number
  ppMax: number
  effectiveness: number
}

export interface EventLoot {
  gold: number
  items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
  perfect: { speciesId: string; name: string; sprite: string; level: number } | null
}

export interface BattleReward {
  won: boolean
  gold: number
  energy: number
  event: EventLoot | null
  xpPerMember: number
  firstWin: boolean
  badge: { id: string; name: string } | null
  levelUps: Array<{ creatureId: string; name: string; newLevel: number }>
  dialogue: string
}

/** Mirrors the engine's BattleEvent union. Kept structural rather than
 *  imported so the web bundle does not pull in the whole engine. */
export type BattleEventView = { type: string; [key: string]: unknown }

export interface BattleView {
  id: string
  kind: string
  turn: number
  weather: string
  finished: boolean
  winner: number | null
  opponentName: string
  player: { active: BattleFighterView; party: BattleFighterView[]; moves: BattleMoveView[] }
  foe: { active: BattleFighterView; party: BattleFighterView[] }
  lastEvents: BattleEventView[]
  reward: BattleReward | null
}


export interface FriendBrief {
  /** Heute schon beschenkt — der Knopf braucht nur ja oder nein. */
  giftedToday?: boolean
  trainerId: string
  displayName: string
  lastSeenAt: number
  score: number
  badges: number
  dexCaught: number
}

export interface FriendOverview {
  trainerCode: string
  gifts: Array<{ id: string; fromName: string; sentAt: number; egg: boolean; label: string }>
  friends: FriendBrief[]
  incoming: FriendBrief[]
  outgoing: FriendBrief[]
}

export interface TrainerCard {
  trainerId: string
  displayName: string
  trainerCode: string
  joinedAt: number
  rank: number | null
  score: number
  dexCaught: number
  dexTotal: number
  badges: Array<{ id: string; name: string; icon: string }>
  battlesWon: number
  shinies: number
  highestLevel: number
  teamPreview: Array<{ speciesId: string; name: string; sprite: string; level: number; shiny: boolean }>
  isFriend: boolean
  isSelf: boolean
  requestPending: boolean
}

export interface MarketListingView {
  id: string
  price: number
  note: string
  createdAt: number
  sellerName: string
  isOwn: boolean
  creature: CreatureLike | null
}

export interface MarketOverview {
  gold: number
  minPrice: number
  maxPrice: number
  feePercent: number
  listings: MarketListingView[]
  ownListings: MarketListingView[]
  sellable: CreatureLike[]
}

export interface TradeOfferView {
  id: string
  fromName: string
  toName: string
  message: string
  expiresAt: number
  offered: CreatureLike | null
  requested: CreatureLike | null
}

export interface TradeOverview {
  incoming: TradeOfferView[]
  outgoing: TradeOfferView[]
  friends: Array<{ trainerId: string; displayName: string }>
  tradable: CreatureLike[]
}

export interface LeaderboardView {
  rows: Array<{
    rank: number
    trainerId: string
    displayName: string
    dexCaught: number
    badges: number
    battlesWon: number
    shinies: number
    highestLevel: number
    teamPower: number
    score: number
    isSelf: boolean
  }>
  ownRank: number | null
  hidden: boolean
  /** Die Rangliste ueber alle Instanzen — null, wenn kein Verbund laeuft. */
  global: Array<{
    rank: number
    trainerId: string
    displayName: string
    instanceId: string
    badges: number
    dexCaught: number
    battlesWon: number
    level: number
    isSelf: boolean
  }> | null
}


export interface GuildMember {
  trainerId: string
  displayName: string
  role: string
  joinedAt: number
  contribution: number
}

export interface GuildOverview {
  guild: {
    id: string
    name: string
    tag: string
    motto: string
    treasury: number
    chatBound: boolean
    joinOpen: boolean
    role: string
    members: GuildMember[]
    memberCount: number
    maxMembers: number
    /** Drei Ziele gleichzeitig statt eines grossen. */
    goals: Array<{
      kind: string
      labelKey: string
      /** Soll je Mitglied — daraus ergibt sich `target`. */
      perMember: number
      target: number
      progress: number
      complete: boolean
      claimed: boolean
      rewardPerMember: number
    }>
  } | null
  open: Array<{ id: string; name: string; tag: string; motto: string; memberCount: number }>
  foundingCost: number
  maxMembers: number
  gold: number
}

export interface RaidView {
  id: string
  speciesId: string
  name: string
  sprite: string
  types: TypeChip[]
  level: number
  tier: number
  hpLeft: number
  hpMax: number
  progress: number
  expiresAt: number
  defeated: boolean
  participants: Array<{ trainerId: string; displayName: string; damage: number; attacks: number }>
  myDamage: number
  myAttacks: number
  attacksLeft: number
  maxAttacks: number
  goldPool: number
}

export interface RaidOverview {
  guild: { id: string; name: string; tag: string; chatBound: boolean } | null
  open: RaidView[]
  recent: RaidView[]
  tiers: Array<{ tier: number; levelRange: [number, number]; durationHours: number; goldPool: number }>
}

export interface RaidAttackResponse {
  damage: number
  contributions: Array<{ creatureId: string; name: string; damage: number; effectiveness: number }>
  raid: RaidView
  defeated: boolean
  reward: {
    gold: number
    caught: boolean
    creature: CreatureLike | null
    /** Werkstoffe aus dem Raid — vorher gab es hier nur Gold. */
    items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
  } | null
}

export interface PvpOverview {
  rating: number
  tier: string
  wins: number
  losses: number
  streak: number
  duelsToday: number
  /** Deine Reisegrenze. Im Duell gilt die niedrigere von beiden. */
  levelCap: number
  /** null = kein Tageslimit mehr; die Zahl bleibt als Statistik. */
  duelsPerDay: number | null
  energy: EnergyState
  energyCost: number
  unseenDefences: number
  opponents: Array<{
    trainerId: string
    displayName: string
    rating: number
    tier: string
    teamPreview: Array<{ sprite: string; level: number }>
  }>
}

export interface PvpLadder {
  rows: Array<{
    rank: number
    trainerId: string
    displayName: string
    rating: number
    tier: string
    wins: number
    losses: number
    isSelf: boolean
  }>
  own: { rating: number; tier: string; wins: number; losses: number; streak: number }
}

export interface PvpHistoryEntry {
  id: string
  opponentName: string
  asChallenger: boolean
  won: boolean
  delta: number
  foughtAt: number
}

export interface DuelResult {
  /** Zweiter Sieg am selben Tag gegen denselben Gegner: ohne Ertrag. */
  repeat: boolean
  duelId: string
  won: boolean
  ratingBefore: number
  ratingAfter: number
  delta: number
  gold: number
  opponentName: string
  events: BattleEventView[]
  turns: number
}

export interface TournamentView {
  weekKey: string
  state: string
  closesAt: number
  resolvedAt: number | null
  entryFee: number
  prizes: number[]
  entered: boolean
  myPlacement: number | null
  entryCount: number
  minEntries: number
  entries: Array<{ trainerId: string; displayName: string; seedScore: number; placement: number | null; seed: number; isSelf: boolean }>
  bracket: Array<{ round: number; a: string | null; b: string | null; winner: string | null }>
}


export interface EvolutionCandidate {
  creature: CreatureLike
  options: Array<{ speciesId: string; name: string; sprite: string; how: string }>
}

export interface BuildingsView {
  gold: number
  buildings: Array<{
    id: string
    level: number
    maxLevel: number
    effectKind: string
    currentEffect: number
    nextEffect: number | null
    upgradeCost: number | null
    affordable: boolean
    maxed: boolean
  }>
}

export interface CraftingView {
  gold: number
  recipes: Array<{
    id: string
    output: { itemId: string; name: string; icon: string; category: string; quantity: number }
    inputs: Array<{ itemId: string; name: string; icon: string; category: string; quantity: number; have: number }>
    goldCost: number
    requiresBuilding: { buildingId: string; level: number } | null
    craftable: boolean
    blockedReason: string | null
    /** Wählbare Mengen mit eigenem Preis. Bei den meisten Rezepten genau eine. */
    batches: Array<{
      count: number
      goldCost: number
      inputs: Array<{ itemId: string; name: string; icon: string; category: string; quantity: number; have: number }>
      craftable: boolean
      blockedReason: string | null
    }>
  }>
}

export interface SeasonView {
  earn: Array<{ action: string; points: number }>
  seasonKey: string
  endsAt: number
  points: number
  tier: number
  nextTierPoints: number | null
  currentTierPoints: number
  tiers: Array<{
    tier: number
    pointsRequired: number
    reached: boolean
    claimed: boolean
    rewardLabel: string
  }>
}

export interface AchievementsView {
  visible: Array<{
    id: string
    metric: string
    target: number
    progress: number
    unlocked: boolean
    claimed: boolean
    rewardGold: number
  }>
  unlockedCount: number
  totalCount: number
}


export interface ChapterView {
  regionId: string | null
  id: string
  order: number
  /** Wer durch das Kapitel führt — je Region ein anderer. */
  guide: string | null
  title: string
  text: string
  reached: boolean
  claimed: boolean
  isCurrent: boolean
  requirements: Array<{ kind: string; label: string; have: number; need: number; met: boolean }>
  reward: { gold: number; itemName: string | null; quantity: number }
}

export interface StoryView {
  regions: Array<{ id: string; name: string; entered: boolean; cleared: boolean; chapters: number; done: number }>
  chapters: ChapterView[]
  currentChapter: ChapterView | null
  completed: number
  total: number
}


export interface AdminDashboard {
  trainers: { total: number; activeToday: number; activeWeek: number; banned: number }
  content: { pack: string; version: string; species: number; areas: number; trainers: number }
  activity: {
    creatures: number; shinies: number; battles: number; duels: number
    raids: number; guilds: number; marketSales: number; goldInCirculation: number
  }
  recentTrainers: Array<{
    id: string; displayName: string; trainerCode: string
    createdAt: number; lastSeenAt: number; isAdmin: number; isBanned: number; gold: number
  }>
  uptimeSeconds: number
}


export interface UseItemResult {
  kind: 'heal' | 'revive' | 'cure' | 'xp' | 'jammer'
  itemName: string
  creatureName?: string
  healed?: number
  xpGained?: number
  leveledUp?: boolean
  charges?: number
}

export interface SoulView {
  typeId: string
  typeName: string
  color: string
  itemId: string
  have: number
  need: number
  ready: boolean
  /** Kosten und Bereitschaft für das schillernde Ei. */
  needShiny: number
  readyShiny: boolean
}

export interface SalvageResult {
  creatureName: string
  fragments: Array<{ itemId: string; typeId: string; name: string; quantity: number }>
}

export interface BulkSalvageResult {
  count: number
  names: string[]
  fragments: SalvageResult['fragments']
}

export interface AreaSpawns {
  areaId: string
  areaName: string
  clock: {
    timeOfDay: string; weather: string
    nextTimeOfDay: string; nextTimeOfDayAt: number
    nextWeather: string; nextWeatherAt: number
  }
  total: number
  unknown: number
  caught: number
  species: Array<{
    speciesId: string
    known: boolean
    caught: boolean
    name: string | null
    sprite: string | null
    types: string[]
    chance: number
    availableNow: boolean
    minLevel: number
    maxLevel: number
    timeOfDay: string[] | null
    weather: string[] | null
  }>
}

export interface ArenaContext {
  tier: string
  round: number
  rounds: number
  wins: number
}

export interface ArenaView {
  energyCost: number
  date: string
  typeId: string | null
  typeName: string | null
  averageLevel: number
  teamHealth: number
  rounds: number
  healPercent: number
  tiers: Array<{
    id: string; levelDelta: number; levels: number[]
    goldPerWin: number; bonusGold: number; xpMultiplier: number
    foesPerBattle: number; foesTotal: number
    bonus: Array<{ itemId: string; quantity: number; name: string }>
    clearedToday: boolean
  }>
  run: { tier: string; round: number; wins: number; battleOpen: boolean } | null
}

export interface LoginView {
  day: number
  streak: number
  bestStreak: number
  claimedTotal: number
  cycleDays: number
  weekDays: number
  claimable: boolean
  nextDay: number
  streakAtRisk: boolean
  days: Array<{
    day: number; bonus: boolean; claimed: boolean; isNext: boolean; label: string
  }>
}

export interface SessionView {
  id: string
  kind: 'telegram' | 'browser'
  userAgent: string
  issuedAt: number
  lastSeenAt: number
  expiresAt: number
  current: boolean
}


export interface TradeStationView {
  /** Wie viele Verbindungskabel im Beutel liegen. */
  cables: number
  /** Ist das Rezept erforscht? Sonst weiss niemand, wo Kabel herkommen. */
  recipeUnlocked: boolean
  rows: Array<{
    creatureId: string
    name: string
    level: number
    sprite: string
    targetSpeciesId: string
    targetName: string
    targetSprite: string
    heldItem: { id: string; name: string; owned: number } | null
    ready: boolean
  }>
}


export interface GauntletView {
  regions: Array<{
    id: string
    name: string
    best: number
    /** Werkstoffe, die es in dieser Region gibt — der Grund, sie zu wählen. */
    drops: Array<{ itemId: string; name: string; icon: string }>
  }>
  energyCost: number
  healPercent: number
  xpMultiplier: number
  averageLevel: number
  milestones: Array<{ at: number; gold: number; materials: number; heals: boolean }>
  run: {
    regionId: string
    regionName: string
    streak: number
    next: { at: number; gold: number; materials: number } | null
    battleOpen: boolean
  } | null
}


/** Die Abrechnung eines Kampfzonen-Laufs — was am Ende zusammengekommen ist. */
export interface GauntletSummary {
  streak: number
  best: number
  regionName: string
  gold: number
  xp: number
  items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
}


/** Der Stand dieser Installation gegen den, den der Verbund als aktuell nennt. */
export interface ReleaseInfo {
  current: string
  latest: string | null
  notes: string
  outdated: boolean
  /** Update angefordert, der Wächter auf dem Wirt ist dran. */
  pending: boolean
}


/** Der globale Chat des Verbunds. `enabled: false` heißt: kein Verbund. */
export interface ChatView {
  enabled: boolean
  me: string | null
  messages: Array<{
    id: number
    trainerId: string
    instanceId: string
    name: string
    body: string
    createdAt: number
    isSelf: boolean
  }>
}

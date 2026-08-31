import type { InstanceRow, ProfileRow, Store, TrainerRow, ReleaseRow, ChatRow, FriendRow, FriendRequestRow } from './store.js'

/**
 * Ein Speicher im Arbeitsspeicher.
 *
 * Für Tests, und als Vorlage für die beiden echten Umsetzungen: was hier in
 * einer Zeile steht, ist bei D1 eine Anweisung. Solange die Logik nur diese
 * Schnittstelle kennt, lässt sie sich vollständig ohne Netz prüfen.
 */
export function memoryStore(): Store {
  const instances = new Map<string, InstanceRow>()
  const trainers = new Map<string, TrainerRow>()
  const profiles = new Map<string, ProfileRow>()

  const score = (p: ProfileRow): number =>
    p.badges * 1000 + p.dexCaught * 10 + p.battlesWon

  const ranked = () => [...profiles.values()]
    .sort((a, b) => score(b) - score(a) || a.trainerId.localeCompare(b.trainerId))

  let release: ReleaseRow | null = null
  const chat: ChatRow[] = []
  const friends: FriendRow[] = []
  const requests: FriendRequestRow[] = []
  return {
    async trainerByCode(code) {
      return [...trainers.values()].find((t) => t.code === code) ?? null
    },
    async addFriend(row) {
      if (!friends.some((f) => f.lowId === row.lowId && f.highId === row.highId)) friends.push(row)
    },
    async removeFriend(a, b) {
      const [low, high] = [a, b].sort()
      const i = friends.findIndex((f) => f.lowId === low && f.highId === high)
      if (i >= 0) friends.splice(i, 1)
    },
    async friendsOf(id) {
      return friends.filter((f) => f.lowId === id || f.highId === id)
        .map((f) => (f.lowId === id ? f.highId : f.lowId))
    },
    async addFriendRequest(row) {
      if (!requests.some((r) => r.fromId === row.fromId && r.toId === row.toId)) requests.push(row)
    },
    async removeFriendRequest(fromId, toId) {
      const i = requests.findIndex((r) => r.fromId === fromId && r.toId === toId)
      if (i >= 0) requests.splice(i, 1)
    },
    async requestsFor(id) {
      return {
        incoming: requests.filter((r) => r.toId === id).map((r) => r.fromId),
        outgoing: requests.filter((r) => r.fromId === id).map((r) => r.toId),
      }
    },
    async profilesOf(ids) {
      return ids.flatMap((id) => {
        const t = trainers.get(id)
        const pr = profiles.get(id)
        if (!t) return []
        return [{
          ...(pr ?? { trainerId: id, badges: 0, dexCaught: 0, battlesWon: 0, rating: 0, level: 0, updatedAt: 0 }),
          displayName: t.displayName, instanceId: t.instanceId, code: t.code,
        }]
      })
    },
    async addChat(row) {
      const id = chat.length + 1
      chat.push({ ...row, id })
      return id
    },
    async chatSince(since, limit) {
      return chat.filter((m) => m.id > since).slice(-limit)
    },
    async chatCountSince(instanceId, after) {
      return chat.filter((m) => m.instanceId === instanceId && m.createdAt >= after).length
    },
    async getRelease() { return release },
    async putRelease(row) { release = row },
    async getInstance(id) { return instances.get(id) ?? null },
    async putInstance(row) { instances.set(row.id, row) },
    async getTrainer(id) { return trainers.get(id) ?? null },
    async putTrainer(row) { trainers.set(row.id, row) },
    async countTrainers(instanceId) {
      return [...trainers.values()].filter((t) => t.instanceId === instanceId).length
    },
    async putProfile(row) { profiles.set(row.trainerId, row) },
    async topProfiles(limit) {
      return ranked().slice(0, limit).map((p) => {
        const t = trainers.get(p.trainerId)
        return { ...p, displayName: t?.displayName ?? '—', instanceId: t?.instanceId ?? '?' }
      })
    },
    async rankOf(trainerId) {
      const i = ranked().findIndex((p) => p.trainerId === trainerId)
      return i < 0 ? null : i + 1
    },
  }
}

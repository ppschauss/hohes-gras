import type { InstanceRow, ProfileRow, Store, TrainerRow, ReleaseRow, ChatRow } from './store.js'

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
  return {
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

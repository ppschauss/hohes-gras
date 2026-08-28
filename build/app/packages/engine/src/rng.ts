/** Deterministic random source.
 *
 *  Every engine function that needs randomness takes an `Rng` argument rather
 *  than calling Math.random(). That is what makes battles reproducible: the
 *  server stores the seed, and replaying it yields byte-identical results, so a
 *  PvP replay cannot disagree with the outcome that was recorded. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number
  /** True with the given percentage chance (0..100). */
  chance(percent: number): boolean
  pick<T>(items: readonly T[]): T
  /** Weighted pick. Entries with weight <= 0 are ignored. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T
  /** Number of values drawn so far — used to assert determinism in tests. */
  readonly draws: number
}

/** xoshiro128** — small, fast, and good enough for game randomness.
 *  Chosen over Math.random() because it is seedable and portable across
 *  Node versions, so an old replay still resolves the same way after upgrades. */
export function createRng(seed: string | number): Rng {
  let s0: number, s1: number, s2: number, s3: number
  {
    let h = 1779033703 ^ String(seed).length
    for (const ch of String(seed)) {
      h = Math.imul(h ^ ch.charCodeAt(0), 3432918353)
      h = (h << 13) | (h >>> 19)
    }
    const nextSeed = () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507)
      h = Math.imul(h ^ (h >>> 13), 3266489909)
      return (h ^= h >>> 16) >>> 0
    }
    s0 = nextSeed(); s1 = nextSeed(); s2 = nextSeed(); s3 = nextSeed()
    if ((s0 | s1 | s2 | s3) === 0) s0 = 1
  }

  let draws = 0
  const rotl = (x: number, k: number) => (x << k) | (x >>> (32 - k))

  const nextUint32 = (): number => {
    draws++
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7) >>> 0, 9) >>> 0
    const t = (s1 << 9) >>> 0
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t
    s3 = rotl(s3, 11) >>> 0
    return result >>> 0
  }

  const rng: Rng = {
    next: () => nextUint32() / 4294967296,
    int(min, max) {
      if (max < min) throw new RangeError(`int(${min}, ${max}): max < min`)
      return min + Math.floor(rng.next() * (max - min + 1))
    },
    chance(percent) {
      if (percent <= 0) return false
      if (percent >= 100) return true
      return rng.next() * 100 < percent
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() auf leerer Liste')
      return items[rng.int(0, items.length - 1)]!
    },
    weighted(items, weightOf) {
      const usable = items.filter((i) => weightOf(i) > 0)
      if (usable.length === 0) throw new RangeError('weighted() ohne positive Gewichte')
      const total = usable.reduce((sum, i) => sum + weightOf(i), 0)
      let roll = rng.next() * total
      for (const item of usable) {
        roll -= weightOf(item)
        if (roll < 0) return item
      }
      return usable[usable.length - 1]!
    },
    get draws() { return draws },
  }
  return rng
}

/** Derive a stable child seed, so a battle inside a raid does not consume the
 *  parent stream and thereby couple unrelated outcomes together. */
export function deriveSeed(parent: string, ...parts: (string | number)[]): string {
  return [parent, ...parts].join(':')
}

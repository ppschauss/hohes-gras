import { randomBytes, randomUUID } from 'node:crypto'

export const newId = (): string => randomUUID()

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // ohne 0/O/1/I

/** Human-readable code that survives being read aloud or retyped. */
export function randomCode(length = 8): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  return out
}

/** Trainer codes are shown in groups of four: `A1B2-C3D4`. */
export function newTrainerCode(): string {
  const raw = randomCode(8)
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

import { createHmac, timingSafeEqual } from 'node:crypto'

export interface TelegramUser {
  id: string
  firstName: string
  lastName: string
  username: string
  languageCode: string
  isPremium: boolean
  photoUrl: string
}

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number; startParam: string | null }
  | { ok: false; reason: 'malformed' | 'missing_hash' | 'bad_signature' | 'expired' | 'no_user' }

/**
 * Validate the `initData` string a Telegram Mini App passes to its page.
 *
 * The scheme is fixed by Telegram: build a newline-joined `key=value` list of
 * every received field except `hash`, sorted by key; the signing key is
 * HMAC_SHA256("WebAppData", bot_token); the signature is HMAC_SHA256 of that
 * list under the signing key.
 *
 * `signature` stays IN the list. Telegram's docs describe two schemes, and only
 * the *third-party* one (Ed25519, for validating without the bot token)
 * excludes both `hash` and `signature`. Carrying that exclusion over to the
 * HMAC scheme rejects every real login while self-signed test data still
 * passes — which is exactly how it went unnoticed here.
 *
 * This is the only thing standing between a stranger and someone else's
 * account, so it fails closed on anything unexpected and compares in constant
 * time. `maxAgeSeconds` bounds replay of a captured initData string.
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSeconds = 86_400, now = Date.now()): InitDataResult {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'missing_hash' }

  // Sortiert wird nach dem Schluessel, nicht nach der ganzen Zeile: bei
  // Schluesseln, von denen einer Praefix eines anderen ist, unterscheiden sich
  // die beiden Reihenfolgen.
  const fields: Array<[string, string]> = []
  for (const [key, value] of params) {
    if (key === 'hash') continue
    fields.push([key, value])
  }
  fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const pairs = fields.map(([key, value]) => `${key}=${value}`)

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(pairs.join('\n')).digest()
  const provided = Buffer.from(hash, 'hex')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' }
  }

  const authDate = Number(params.get('auth_date') ?? '0')
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' }
  if (now / 1000 - authDate > maxAgeSeconds) return { ok: false, reason: 'expired' }

  const rawUser = params.get('user')
  if (!rawUser) return { ok: false, reason: 'no_user' }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawUser)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof parsed.id !== 'number' && typeof parsed.id !== 'string') return { ok: false, reason: 'no_user' }

  return {
    ok: true,
    authDate,
    startParam: params.get('start_param'),
    user: {
      id: String(parsed.id),
      firstName: typeof parsed.first_name === 'string' ? parsed.first_name : '',
      lastName: typeof parsed.last_name === 'string' ? parsed.last_name : '',
      username: typeof parsed.username === 'string' ? parsed.username : '',
      languageCode: typeof parsed.language_code === 'string' ? parsed.language_code : 'de',
      isPremium: parsed.is_premium === true,
      photoUrl: typeof parsed.photo_url === 'string' ? parsed.photo_url : '',
    },
  }
}

/** Display name from the Telegram profile, trimmed to something a UI can show. */
export function displayNameOf(user: TelegramUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  const name = full || user.username || `Trainer ${user.id.slice(-4)}`
  return name.slice(0, 32)
}

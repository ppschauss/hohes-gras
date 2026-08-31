/**
 * Wer spricht hier?
 *
 * Jede Instanz bekommt bei der Anmeldung ein Geheimnis. Jede Anfrage trägt
 * eine Signatur über Methode, Pfad, Zeitstempel und Rumpf. Das ist dasselbe
 * Verfahren, mit dem Telegram sein `initData` absichert — nichts Neues zu
 * verstehen, und es kommt ohne Sitzungen aus.
 *
 * Der Zeitstempel ist Teil der Signatur und darf nicht älter als fünf Minuten
 * sein: sonst ließe sich eine einmal mitgeschnittene Anfrage beliebig oft
 * wiederholen.
 */

export const SIGNATURE_MAX_AGE_MS = 5 * 60_000

export interface SignedRequest {
  instanceId: string
  timestamp: number
  signature: string
}

/** Was signiert wird. Bewusst als eine Zeile: was nicht drinsteht, ist auch
 *  nicht geschützt, und das soll man sehen können. */
export const signingPayload = (
  method: string, path: string, timestamp: number, body: string,
): string => [method.toUpperCase(), path, String(timestamp), body].join('\n')

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sign(
  secret: string, method: string, path: string, timestamp: number, body: string,
): Promise<string> {
  return hmac(secret, signingPayload(method, path, timestamp, body))
}

export type AuthResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_instance' | 'bad_signature' | 'stale' | 'blocked' }

export async function verify(
  secret: string, req: SignedRequest, method: string, path: string, body: string, now: number,
): Promise<AuthResult> {
  if (Math.abs(now - req.timestamp) > SIGNATURE_MAX_AGE_MS) return { ok: false, reason: 'stale' }
  const expected = await sign(secret, method, path, req.timestamp, body)
  // Zeitkonstanter Vergleich: ein früh abbrechender verrät über viele Versuche,
  // wie weit man richtig lag.
  if (expected.length !== req.signature.length) return { ok: false, reason: 'bad_signature' }
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ req.signature.charCodeAt(i)
  return diff === 0 ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

/**
 * Die globale Trainer-Id.
 *
 * Ein Hash aus Telegram-Id und einem Salz des Verbunds. Global eindeutig, weil
 * die Telegram-Id es ist — aber die rohe Zahl liegt damit nicht in fremden
 * Datenbanken, und aus der globalen Id lässt sie sich nicht zurückrechnen.
 */
export async function globalTrainerId(telegramId: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`${salt}:${telegramId}`),
  )
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
}

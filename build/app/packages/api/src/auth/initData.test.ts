import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { displayNameOf, verifyInitData } from './initData.js'

const BOT_TOKEN = '123456:TESTTOKEN-abcdefghijklmnopqrstuvwxyz0123456789'

/** Build a correctly signed initData string, the way Telegram would. */
function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const pairs = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex')
  const params = new URLSearchParams(fields)
  params.set('hash', hash)
  return params.toString()
}

const nowSec = 1_700_000_000
const nowMs = nowSec * 1000
const user = JSON.stringify({ id: 42, first_name: 'Patrick', last_name: 'S', username: 'patrick', language_code: 'de' })

describe('verifyInitData', () => {
  it('akzeptiert korrekt signierte Daten', () => {
    const data = sign({ user, auth_date: String(nowSec), query_id: 'AAF' })
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.user.id).toBe('42')
      expect(r.user.firstName).toBe('Patrick')
      expect(r.authDate).toBe(nowSec)
    }
  })

  it('weist eine manipulierte Nutzlast ab', () => {
    const data = sign({ user, auth_date: String(nowSec) })
    const tampered = data.replace('Patrick', 'Angreif')
    const r = verifyInitData(tampered, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('weist eine Signatur eines fremden Bot-Tokens ab', () => {
    const data = sign({ user, auth_date: String(nowSec) }, '999:ANDERER-TOKEN-abcdefghijklmnopqrstuvwxyz')
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('weist fehlenden Hash ab', () => {
    const r = verifyInitData(`user=${encodeURIComponent(user)}&auth_date=${nowSec}`, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'missing_hash' })
  })

  it('weist einen Hash falscher Laenge ab, ohne zu werfen', () => {
    const r = verifyInitData(`user=${encodeURIComponent(user)}&auth_date=${nowSec}&hash=abc`, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'missing_hash' })
  })

  it('weist abgelaufene Daten ab', () => {
    const data = sign({ user, auth_date: String(nowSec - 90_000) })
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'expired' })
  })

  it('akzeptiert Daten knapp innerhalb des Zeitfensters', () => {
    const data = sign({ user, auth_date: String(nowSec - 86_399) })
    expect(verifyInitData(data, BOT_TOKEN, 86400, nowMs).ok).toBe(true)
  })

  it('weist Daten ohne user-Feld ab', () => {
    const data = sign({ auth_date: String(nowSec) })
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'no_user' })
  })

  it('weist kaputtes user-JSON ab', () => {
    const data = sign({ user: '{nicht json', auth_date: String(nowSec) })
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rechnet das signature-Feld MIT, wie es Telegram fuer den Bot-Token vorsieht', () => {
    // Telegrams Doku kennt zwei Verfahren. Nur das Drittanbieter-Verfahren
    // (Ed25519, ohne Bot-Token) laesst `hash` UND `signature` weg; beim
    // HMAC-Verfahren gehen ALLE empfangenen Felder in die Pruefsumme ein.
    // Diese Unterscheidung zu uebersehen weist jede echte Anmeldung ab,
    // waehrend selbst signierte Testdaten weiter durchlaufen — genau so ist
    // der Fehler hier einmal durch eine gruene Testsuite gerutscht.
    const signed = sign({ user, auth_date: String(nowSec), signature: 'ed25519-platzhalter' })
    expect(verifyInitData(signed, BOT_TOKEN, 86400, nowMs).ok).toBe(true)
  })

  it('bemerkt eine Manipulation am signature-Feld', () => {
    const signed = sign({ user, auth_date: String(nowSec), signature: 'echt' })
    const tampered = signed.replace('signature=echt', 'signature=gefaelscht')
    expect(verifyInitData(tampered, BOT_TOKEN, 86400, nowMs)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('sortiert nach Schluessel, nicht nach der ganzen Zeile', () => {
    // `chat` ist Praefix von `chat_instance`; die beiden Sortierungen koennen
    // sich je nach Wert unterscheiden.
    const signed = sign({
      user, auth_date: String(nowSec),
      chat: '{"id":1}', chat_instance: '-999', chat_type: 'private',
    })
    expect(verifyInitData(signed, BOT_TOKEN, 86400, nowMs).ok).toBe(true)
  })

  it('liest start_param fuer Einladungslinks aus', () => {
    const data = sign({ user, auth_date: String(nowSec), start_param: 'ABCD1234' })
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r.ok && r.startParam).toBe('ABCD1234')
  })

  it('akzeptiert eine numerisch als String gelieferte id', () => {
    const data = sign({ user: JSON.stringify({ id: '42', first_name: 'X' }), auth_date: String(nowSec) })
    const r = verifyInitData(data, BOT_TOKEN, 86400, nowMs)
    expect(r.ok && r.user.id).toBe('42')
  })
})

describe('displayNameOf', () => {
  const base = { id: '987654', username: '', languageCode: 'de', isPremium: false, photoUrl: '', lastName: '' }
  it('bevorzugt den vollen Namen', () => {
    expect(displayNameOf({ ...base, firstName: 'Ash', lastName: 'Ketchum' })).toBe('Ash Ketchum')
  })
  it('faellt auf den Benutzernamen zurueck', () => {
    expect(displayNameOf({ ...base, firstName: '', username: 'ash' })).toBe('ash')
  })
  it('faellt zuletzt auf die ID zurueck', () => {
    expect(displayNameOf({ ...base, firstName: '' })).toBe('Trainer 7654')
  })
  it('kuerzt zu lange Namen', () => {
    expect(displayNameOf({ ...base, firstName: 'A'.repeat(100) }).length).toBe(32)
  })
})

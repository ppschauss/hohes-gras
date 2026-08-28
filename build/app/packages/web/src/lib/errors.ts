import { t } from '../i18n'

/**
 * Fehlermeldung aus Code und Detail.
 *
 * Die meisten Fehler brauchen nur ihren Code. Zwei Faelle nicht: die
 * Taktkontrolle nennt einen Grund, und fast jede Meldung will Zahlen aus dem
 * Detail einsetzen — "in 42 Sekunden" statt "in {retryAfter} Sekunden".
 */
export function errorText(code: string | null, detail: Record<string, unknown> = {}): string {
  if (!code) return ''
  const vars = Object.fromEntries(
    Object.entries(detail).filter(([, v]) => typeof v === 'string' || typeof v === 'number'),
  ) as Record<string, string | number>

  if (code === 'rate_limited' && typeof detail.reason === 'string') {
    const specific = `error.rate_limited.${detail.reason}`
    const text = t(specific, vars)
    // t() gibt bei fehlendem Schluessel den Schluessel zurueck — dann greift
    // die allgemeine Meldung.
    if (text !== specific) return text
  }
  return t(`error.${code}`, vars)
}

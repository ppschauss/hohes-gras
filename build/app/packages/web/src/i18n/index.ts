import de from './de.json'

type Catalog = Record<string, string>
const catalogs: Record<string, Catalog> = { de }
let active = 'de'

export function setLocale(locale: string): void {
  if (catalogs[locale]) active = locale
}

/**
 * Look up a translation and fill `{placeholders}`.
 *
 * A missing key returns the key itself rather than an empty string — an
 * untranslated label is visible in the UI and gets fixed, a blank one is not.
 */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const catalog = catalogs[active] ?? catalogs.de!
  const template = catalog[key] ?? catalogs.de![key] ?? key
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  )
}

export const availableLocales = (): string[] => Object.keys(catalogs)

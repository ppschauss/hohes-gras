import { t } from '../i18n'

/** Human-readable countdown. Rounds up so "1 Min" never sits at zero for a
 *  whole minute while the button still refuses. */
export function untilLabel(endsAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.ceil((endsAt - now) / 60_000))
  if (minutes === 0) return t('time.now')
  if (minutes < 60) return t('time.minutes', { n: minutes })
  return t('time.hours', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

export function minutesLabel(minutes: number): string {
  if (minutes <= 0) return t('time.now')
  if (minutes < 60) return t('time.minutes', { n: minutes })
  return t('time.hours', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

export const percent = (value: number): string => `${Math.round(value * 100)} %`

export const number = (value: number): string => new Intl.NumberFormat('de-DE').format(value)

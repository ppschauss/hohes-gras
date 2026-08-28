import { useEffect, useState } from 'react'

/**
 * Ab hier gilt die Rechnerfassung.
 *
 * 1024 Punkte und quer: das ist die Schwelle, ab der eine Seitenleiste neben
 * dem Inhalt steht, ohne ihm den Platz zu nehmen. Ein Tablet im Hochformat
 * bleibt bewusst bei der Telefonfassung — dort ist die Höhe das knappe Gut,
 * genau wie auf dem Telefon.
 */
export const WIDE_QUERY = '(min-width: 1024px) and (orientation: landscape)'

export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

import type { ReactNode } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Icon } from './Icon'
import { Resources } from './Resources'

interface Props {
  eyebrow?: string
  title: string
  onBack: () => void
  aside?: ReactNode
  children: ReactNode
}

/**
 * Die eine Kopfzeile.
 *
 * Vorher gab es zwei übereinander: eine App-Leiste mit Uhr und Energie, und
 * darunter je Bildschirm noch einmal Zurück-Knopf und Titel. Auf einem Telefon
 * mit 844 Punkten Höhe waren das rund 130 Punkte, bevor überhaupt Inhalt kam —
 * ein Sechstel des Bildschirms für zwei Zeilen, die dasselbe Thema hatten.
 *
 * Jetzt trägt eine Zeile alles: zurück, wo man ist, und was man hat.
 */
export function Screen({ eyebrow, title, onBack, aside, children }: Props) {
  return (
    <>
      <header className="appbar">
        <button
          type="button"
          className="appbar__back"
          onClick={() => { haptic.tap(); onBack() }}
          aria-label={t('screen.back')}
        >
          <Icon name="back" size={20} />
        </button>

        <span className="appbar__text">
          <span className="appbar__title">{title}</span>
          {eyebrow && <span className="appbar__eyebrow">{eyebrow}</span>}
        </span>

        {aside && <span className="appbar__aside">{aside}</span>}
        {/* Gold und Energie stehen immer da. Sie entscheiden ueberall
            darueber, was gerade geht — ein Bildschirm, auf dem sie fehlen,
            zwingt zum Zurueckspringen, nur um nachzusehen. */}
        <Resources />
      </header>
      {children}
    </>
  )
}

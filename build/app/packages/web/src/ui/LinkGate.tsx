import { useState, type FormEvent } from 'react'
import { t } from '../i18n'

interface Props {
  message: string | null
  submitting: boolean
  onSubmit: (code: string) => void
}

/**
 * Der Eingang im Browser.
 *
 * Hier gibt es kein `initData` — die Identität kommt einmalig als Code aus dem
 * Chat, der ohnehin schon authentifiziert ist. Kein Passwort, weil das nur ein
 * zweiter Weg wäre, ein Konto zu verlieren.
 */
export function LinkGate({ message, submitting, onSubmit }: Props) {
  const [code, setCode] = useState('')
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const ready = clean.length === 8

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || submitting) return
    onSubmit(clean)
  }

  return (
    <div className="center">
      <form className="center__inner gate" onSubmit={submit}>
        <span className="gate__mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" width="56" height="56" role="presentation">
            <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M3 24h42" stroke="currentColor" strokeWidth="3" />
            <circle cx="24" cy="24" r="7" fill="var(--bg)" stroke="currentColor" strokeWidth="3" />
          </svg>
        </span>

        <h2>{t('link.title')}</h2>
        <p className="center__body">{t('link.body')}</p>

        {message && <p className="notice" role="alert">{t(`error.${message}`)}</p>}

        <input
          className="field field--code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX"
          aria-label={t('link.title')}
          aria-invalid={message ? 'true' : undefined}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={9}
          disabled={submitting}
          // Der Code kommt vom Handy; auf dem Rechner ist das Feld das Erste,
          // was gebraucht wird.
          autoFocus
        />

        <button type="submit" className="btn btn--primary btn--block" disabled={!ready || submitting}>
          {submitting && <span className="spinner" aria-hidden="true" />}
          {t('link.submit')}
        </button>

        <p className="gate__hint">{t('link.hint')}</p>
      </form>
    </div>
  )
}

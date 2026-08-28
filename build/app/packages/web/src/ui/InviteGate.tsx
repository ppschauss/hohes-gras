import { useState, type FormEvent } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'

interface Props {
  message: string | null
  submitting: boolean
  onSubmit: (code: string) => void
}

export function InviteGate({ message, submitting, onSubmit }: Props) {
  const [code, setCode] = useState('')
  const tooShort = code.trim().length < 4

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (tooShort || submitting) return
    haptic.tap()
    onSubmit(code)
  }

  return (
    <div className="center">
      <form className="center__inner" onSubmit={submit}>
        <div className="center__glyph" aria-hidden="true">✉️</div>
        <h2>{t('auth.needInvite.title')}</h2>
        <p className="center__body">{t('auth.needInvite.body')}</p>

        {message && <p className="notice" role="alert">{t(message)}</p>}

        <input
          className="field"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('auth.needInvite.placeholder')}
          aria-label={t('auth.needInvite.placeholder')}
          aria-invalid={message ? 'true' : undefined}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={16}
          disabled={submitting}
        />

        <button type="submit" className="btn btn--primary btn--block" disabled={tooShort || submitting}>
          {submitting && <span className="spinner" aria-hidden="true" />}
          {t('auth.needInvite.submit')}
        </button>
      </form>
    </div>
  )
}

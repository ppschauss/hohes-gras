import { useState } from 'react'
import type { SessionView } from '../lib/api'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'

/**
 * Verbundene Geräte.
 *
 * Der Code für den Browser und diese Liste gehören zusammen: eine Anmeldung,
 * die man vergeben kann, muss man auch zurücknehmen können. Ohne die Liste
 * wäre der Code eine Tür ohne Schloss.
 */
export function SessionsPanel() {
  const list = useAsync(() => api.sessions(), [])
  const action = useAction()
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)

  const make = () => {
    haptic.tap()
    void action.run(() => api.linkCode(), (res) => { setCode(res); haptic.success() })
  }
  const revoke = (id: string) => {
    haptic.tap()
    void action.run(() => api.revokeSession(id), (res) => { list.set(res); haptic.success() })
  }
  const revokeOthers = () => {
    haptic.tap()
    void action.run(() => api.revokeOtherSessions(), (res) => { list.set(res); haptic.success() })
  }

  const sessions = list.data?.sessions ?? []
  const others = sessions.filter((s) => !s.current).length

  return (
    <section className="section">
      <h2>{t('sessions.title')}</h2>
      <p className="center__body">{t('sessions.hint')}</p>

      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}

      {code
        ? (
          <div className="codeCard">
            <code className="codeCard__code">{code.code}</code>
            <span className="codeCard__hint">{t('sessions.codeHint')}</span>
          </div>
        )
        : (
          <button type="button" className="btn btn--primary btn--block" disabled={action.busy} onClick={make}>
            {t('sessions.newCode')}
          </button>
        )}

      <div className="stack">
        {sessions.map((s) => (
          <article key={s.id} className="friend">
            <span className="friend__text">
              <span className="friend__name">
                {deviceName(s)}
                {s.current && <span className="tag tag--active">{t('sessions.current')}</span>}
              </span>
              <span className="friend__meta num">
                {t('sessions.seen', { when: relative(s.lastSeenAt) })}
              </span>
            </span>
            {!s.current && (
              <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                onClick={() => revoke(s.id)}>{t('sessions.revoke')}</button>
            )}
          </article>
        ))}
      </div>

      {others > 0 && (
        <button type="button" className="btn btn--ghost btn--block" disabled={action.busy} onClick={revokeOthers}>
          {t('sessions.revokeOthers', { n: others })}
        </button>
      )}
    </section>
  )
}

/**
 * Ein lesbarer Name aus dem User-Agent.
 *
 * Bewusst grob: die Zeichenkette ist beliebig und lügt oft. Sie soll nur die
 * eine Frage beantworten, um die es hier geht — *war ich das?* Was nicht
 * erkannt wird, heißt „unbekanntes Gerät" statt einer erfundenen Genauigkeit.
 */
function deviceName(s: SessionView): string {
  if (s.kind === 'telegram') return t('sessions.telegram')
  const ua = s.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : null
  if (!browser && !os) return t('sessions.unknown')
  return [browser, os].filter(Boolean).join(' · ')
}

function relative(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (minutes < 1) return t('sessions.now')
  if (minutes < 60) return t('sessions.minutes', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('sessions.hours', { n: hours })
  return t('sessions.days', { n: Math.round(hours / 24) })
}

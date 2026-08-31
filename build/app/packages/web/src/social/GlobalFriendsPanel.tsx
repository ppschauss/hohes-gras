import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type GlobalFriend, type GlobalFriendsView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

/**
 * Freunde über Instanzgrenzen.
 *
 * Gesucht wird über den Trainer-Code — den gibt man ohnehin weiter. Ohne
 * Verbund steht hier eine Erklärung statt einer leeren Liste.
 */
export function GlobalFriendsPanel() {
  const view = useAsync(() => api.globalFriends(), [])
  const action = useAction()
  const [code, setCode] = useState('')
  const [hinweis, setHinweis] = useState<string | null>(null)
  const d = view.data

  const anfragen = () => {
    const eingabe = code.trim().toUpperCase()
    if (eingabe === '') return
    haptic.tap()
    void action.run(() => api.requestGlobalFriend(eingabe), (res) => {
      view.set(res.view)
      setCode('')
      setHinweis(res.accepted ? t('gfriends.becameFriends') : t('gfriends.sent'))
      haptic.success()
    })
  }

  const antworten = (otherId: string, accept: boolean) => {
    haptic.tap()
    void action.run(() => api.respondGlobalFriend(otherId, accept), (res) => view.set(res.view))
  }

  if (d && !d.enabled) {
    return <CenterState glyph="🌐" title={t('gfriends.title')} body={t('gfriends.noHub')} />
  }

  const zeile = (f: GlobalFriend, rechts: React.ReactNode) => (
    <article key={f.trainerId} className="friend">
      <span className="friend__text">
        <span className="friend__name">{f.displayName}</span>
        <span className="friend__meta num">
          {f.instanceId}
          {' · '}
          {t('gfriends.stats', {
            badges: f.badges, dex: f.dexCaught, battles: f.battlesWon, level: f.level,
          })}
        </span>
      </span>
      {rechts}
    </article>
  )

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {hinweis && <p className="notice notice--ok" role="status">{hinweis}</p>}

      {d?.myCode && (
        <p className="center__body num">{t('gfriends.myCode', { code: d.myCode })}</p>
      )}

      <form className="chat__form" onSubmit={(e) => { e.preventDefault(); anfragen() }}>
        <input
          className="chat__input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={16}
          placeholder={t('gfriends.add')}
          aria-label={t('gfriends.add')}
        />
        <button type="submit" className="btn btn--primary btn--sm"
          disabled={action.busy || code.trim() === ''}>
          {t('gfriends.send')}
        </button>
      </form>

      {(d?.incoming.length ?? 0) > 0 && (
        <section className="section">
          <h2>{t('gfriends.incoming')}</h2>
          <div className="stack">
            {d?.incoming.map((f) => zeile(f, (
              <span className="row">
                <button type="button" className="btn btn--primary btn--sm" disabled={action.busy}
                  onClick={() => antworten(f.trainerId, true)}>{t('gfriends.accept')}</button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                  onClick={() => antworten(f.trainerId, false)}>{t('gfriends.decline')}</button>
              </span>
            )))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>{t('gfriends.title')}</h2>
        {d?.friends.length === 0
          ? <p className="center__body">{t('gfriends.none')}</p>
          : <div className="stack">
              {d?.friends.map((f) => zeile(f, (
                <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                  onClick={() => { haptic.tap(); void action.run(() => api.removeGlobalFriend(f.trainerId), (r) => view.set(r.view)) }}>
                  {t('gfriends.remove')}
                </button>
              )))}
            </div>}
      </section>

      {(d?.outgoing.length ?? 0) > 0 && (
        <section className="section">
          <span className="section__eyebrow">{t('gfriends.outgoing')}</span>
          <div className="stack">
            {d?.outgoing.map((f) => zeile(f, null))}
          </div>
        </section>
      )}
    </>
  )
}

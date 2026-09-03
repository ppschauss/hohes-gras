import { useState } from 'react'
import type { FriendBrief } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

export function FriendsPanel() {
  const friends = useAsync(() => api.friends(), [])
  const action = useAction()
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const submit = () => {
    haptic.tap()
    void action.run(() => api.requestFriend(code), (res) => {
      setStatus(res.status === 'accepted' ? 'friends.accepted' : 'friends.sent')
      setCode('')
      friends.reload()
      haptic.success()
    })
  }

  const respond = (fromId: string, accept: boolean) => {
    haptic.tap()
    void action.run(() => api.respondFriend(fromId, accept), (next) => friends.set(next))
  }

  const remove = (trainerId: string) => {
    haptic.tap()
    void action.run(() => api.removeFriend(trainerId), (next) => friends.set(next))
  }

  const copy = async () => {
    if (!friends.data) return
    try {
      await navigator.clipboard.writeText(friends.data.trainerCode)
      setCopied(true)
      haptic.success()
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard is blocked in some in-app browsers; the code stays visible
      // and selectable, so this is a missing convenience, not a failure.
      setCopied(false)
    }
  }

  const d = friends.data

  return (
    <>
      <section className="codeCard">
        <span className="section__eyebrow">{t('friends.yourCode')}</span>
        <div className="codeCard__row">
          <code className="codeCard__code">{d?.trainerCode ?? '····-····'}</code>
          <button type="button" className="btn btn--ghost btn--sm" onClick={copy}>
            {copied ? t('friends.copied') : t('friends.copy')}
          </button>
        </div>
      </section>

      <div className="addRow">
        <input className="field field--inline field--text" value={code} maxLength={9}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('friends.addPlaceholder')}
          autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        <button type="button" className="btn btn--primary btn--sm"
          disabled={code.trim().length < 4 || action.busy} onClick={submit}>
          {t('friends.add')}
        </button>
      </div>

      {status && <p className="notice notice--ok">{t(status)}</p>}
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      {d && d.incoming.length > 0 && (
        <section className="section">
          <h2>{t('friends.incoming')}</h2>
          <div className="stack">
            {d.incoming.map((f) => (
              <FriendRow key={f.trainerId} friend={f}
                actions={[
                  { label: t('friends.accept'), primary: true, onClick: () => respond(f.trainerId, true) },
                  { label: t('friends.decline'), onClick: () => respond(f.trainerId, false) },
                ]} busy={action.busy} />
            ))}
          </div>
        </section>
      )}

      {d && d.outgoing.length > 0 && (
        <section className="section">
          <h2>{t('friends.outgoing')}</h2>
          <div className="stack">
            {d.outgoing.map((f) => <FriendRow key={f.trainerId} friend={f} actions={[]} busy={action.busy} />)}
          </div>
        </section>
      )}

      {d && d.gifts.length > 0 && (
        <section className="section">
          <h2>{t('gifts.inbox', { n: d.gifts.length })}</h2>
          <div className="stack">
            {d.gifts.map((g) => (
              <article key={g.id} className="friend">
                <span className="friend__text">
                  <span className="friend__name">{g.fromName}{g.egg ? ' 🥚' : ''}</span>
                  <span className="friend__meta">{g.label}</span>
                </span>
                <span className="friend__actions">
                  <button type="button" className="btn btn--primary btn--sm" disabled={action.busy}
                    onClick={() => {
                      haptic.tap()
                      void action.run(() => api.openGift(g.id), (res) => { d && friends.set(res.friends); haptic.success() })
                    }}>
                    {t('gifts.open')}
                  </button>
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>{t('friends.list')}</h2>
        {d && d.friends.length === 0
          ? <CenterState glyph="🤝" title={t('friends.empty.title')} body={t('friends.empty.body')} />
          : <div className="stack">
              {d?.friends.map((f) => (
                <FriendRow key={f.trainerId} friend={f}
                  actions={[
                    {
                      label: f.giftedToday ? t('gifts.sentToday') : t('gifts.send'),
                      primary: !f.giftedToday,
                      disabled: f.giftedToday,
                      onClick: () => {
                        haptic.tap()
                        void action.run(() => api.sendGift(f.trainerId), (res) => {
                          friends.set(res.friends); haptic.success()
                        })
                      },
                    },
                    { label: t('friends.remove'), onClick: () => remove(f.trainerId) },
                  ]}
                  busy={action.busy} />
              ))}
            </div>}
      </section>
    </>
  )
}

function FriendRow({ friend, actions, busy }: {
  friend: FriendBrief
  actions: Array<{ label: string; onClick: () => void; primary?: boolean; disabled?: boolean }>
  busy: boolean
}) {
  return (
    <article className="friend">
      <span className="friend__text">
        <span className="friend__name">{friend.displayName}</span>
        <span className="friend__meta num">
          {t('friends.stats', { dex: friend.dexCaught, badges: friend.badges })}
        </span>
      </span>
      <span className="friend__actions">
        {actions.map((a) => (
          <button key={a.label} type="button"
            className={`btn btn--sm ${a.primary ? 'btn--primary' : 'btn--ghost'}`}
            disabled={busy || a.disabled} onClick={a.onClick}>{a.label}</button>
        ))}
      </span>
    </article>
  )
}

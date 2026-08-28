import { useState } from 'react'
import type { TradeOfferView } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { untilLabel } from '../lib/format'
import { CenterState } from '../ui/States'

export function TradePanel() {
  const trades = useAsync(() => api.trades(), [])
  const action = useAction()
  const [friendId, setFriendId] = useState<string | null>(null)
  const [offered, setOffered] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const d = trades.data

  const send = () => {
    if (!friendId || !offered) return
    haptic.tap()
    void action.run(() => api.offerTrade(friendId, offered, null, message), (next) => {
      trades.set(next); setOffered(null); setMessage(''); haptic.success()
    })
  }

  const respond = (offer: TradeOfferView, accept: boolean) => {
    haptic.tap()
    void action.run(() => api.respondTrade(offer.id, accept), (res) => {
      trades.set(res.trades); if (res.accepted) haptic.success()
    })
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      <section className="section">
        <h2>{t('trade.incoming')}</h2>
        {d && d.incoming.length === 0
          ? <CenterState glyph="📨" title={t('trade.empty.title')} body={t('trade.empty.body')} />
          : <div className="stack">
              {d?.incoming.map((o) => (
                <OfferCard key={o.id} offer={o} busy={action.busy}
                  actions={[
                    { label: t('trade.accept'), primary: true, onClick: () => respond(o, true) },
                    { label: t('trade.decline'), onClick: () => respond(o, false) },
                  ]} />
              ))}
            </div>}
      </section>

      {d && d.outgoing.length > 0 && (
        <section className="section">
          <h2>{t('trade.outgoing')}</h2>
          <div className="stack">
            {d.outgoing.map((o) => <OfferCard key={o.id} offer={o} busy={action.busy} actions={[]} />)}
          </div>
        </section>
      )}

      <section className="section">
        <h2>{t('trade.offer')}</h2>
        {d && d.friends.length === 0
          ? <p className="center__body">{t('trade.noFriends')}</p>
          : <>
              <span className="section__eyebrow">{t('trade.chooseFriend')}</span>
              <div className="segmented segmented--scroll">
                {d?.friends.map((f) => (
                  <button key={f.trainerId} type="button" className="segmented__btn"
                    aria-pressed={friendId === f.trainerId}
                    onClick={() => { haptic.select(); setFriendId(f.trainerId) }}>
                    {f.displayName}
                  </button>
                ))}
              </div>

              <span className="section__eyebrow">{t('trade.chooseOffered')}</span>
              {d && d.tradable.length === 0
                ? <p className="center__body">{t('market.noSellable')}</p>
                : <div className="picks">
                    {d?.tradable.map((c) => (
                      <button key={c.id} type="button"
                        className={`pick${offered === c.id ? ' pick--on' : ''}`}
                        aria-pressed={offered === c.id}
                        onClick={() => { haptic.select(); setOffered(offered === c.id ? null : c.id) }}>
                        <img src={c.sprite} alt="" width={40} height={40} className="pick__mon" />
                        <span className="pick__name">{c.displayName}</span>
                        <span className="pick__meta num">{t('creature.level', { n: c.level })}</span>
                      </button>
                    ))}
                  </div>}

              <input className="field field--inline field--text" maxLength={140} value={message}
                placeholder={t('trade.message')} onChange={(e) => setMessage(e.target.value)} />

              <button type="button" className="btn btn--primary btn--block"
                disabled={!friendId || !offered || action.busy} onClick={send}>
                {t('trade.offer')}
              </button>
            </>}
      </section>
    </>
  )
}

function OfferCard({ offer, busy, actions }: {
  offer: TradeOfferView
  busy: boolean
  actions: Array<{ label: string; onClick: () => void; primary?: boolean }>
}) {
  return (
    <article className="offer">
      <div className="offer__sides">
        <div className="offer__side">
          <span className="section__eyebrow">{offer.fromName} {t('trade.gives')}</span>
          {offer.offered && (
            <span className="offer__mon">
              <img src={offer.offered.sprite} alt="" width={48} height={48} />
              <span>{offer.offered.displayName}</span>
              <span className="num">{t('creature.level', { n: offer.offered.level })}</span>
            </span>
          )}
        </div>
        <span className="offer__arrow" aria-hidden="true">⇄</span>
        <div className="offer__side">
          <span className="section__eyebrow">{t('trade.wants')}</span>
          {offer.requested
            ? <span className="offer__mon">
                <img src={offer.requested.sprite} alt="" width={48} height={48} />
                <span>{offer.requested.displayName}</span>
                <span className="num">{t('creature.level', { n: offer.requested.level })}</span>
              </span>
            : <span className="offer__gift">{t('trade.gift')}</span>}
        </div>
      </div>
      {offer.message && <p className="offer__message">„{offer.message}"</p>}
      <div className="offer__foot">
        <span className="num">{t('trade.expires', { n: untilLabel(offer.expiresAt) })}</span>
        <span className="offer__actions">
          {actions.map((a) => (
            <button key={a.label} type="button"
              className={`btn btn--sm ${a.primary ? 'btn--primary' : 'btn--ghost'}`}
              disabled={busy} onClick={a.onClick}>{a.label}</button>
          ))}
        </span>
      </div>
    </article>
  )
}

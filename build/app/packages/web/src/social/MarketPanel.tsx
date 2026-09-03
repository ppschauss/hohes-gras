import { useState } from 'react'
import type { MarketListingView } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { CenterState } from '../ui/States'
import { CreatureCard } from '../ui/CreatureCard'

export function MarketPanel() {
  const market = useAsync(() => api.market(), [])
  const action = useAction()
  const [selling, setSelling] = useState<string | null>(null)
  const [price, setPrice] = useState(500)
  const [note, setNote] = useState('')
  const [bought, setBought] = useState<number | null>(null)
  const [unterwegs, setUnterwegs] = useState<string | null>(null)

  const d = market.data

  const list = () => {
    if (!selling) return
    haptic.tap()
    void action.run(() => api.listOnMarket(selling, price, note), (next) => {
      market.set(next); setSelling(null); setNote(''); haptic.success()
    })
  }

  const buy = (listing: MarketListingView) => {
    haptic.tap()
    void action.run(() => api.buyListing(listing.id), (res) => {
      market.set(res.market); setBought(res.paid); haptic.success()
    })
  }

  /*
   * Kaufen im Verbund.
   *
   * Getrennt vom oertlichen Kauf, weil es ein anderes Versprechen ist: das
   * Gold ist sofort weg, das Pokemon kommt spaeter. Wer das nicht liest,
   * sucht danach in seiner Box und findet nichts — deshalb sagt es die
   * Rueckmeldung ausdruecklich.
   */
  const kaufeFern = (l: { id: string; speciesName: string }) => {
    haptic.tap()
    void action.run(() => api.buyRemote(l.id), (res) => {
      market.set(res.market)
      setUnterwegs(t('market.remoteOrdered', { name: l.speciesName }))
      haptic.success()
    })
  }

  const cancel = (listing: MarketListingView) => {
    haptic.tap()
    void action.run(() => api.cancelListing(listing.id), (next) => market.set(next))
  }

  return (
    <>
      <div className="marketHead">
        <span className="num">🪙 {number(d?.gold ?? 0)}</span>
        <span className="section__eyebrow">{t('market.fee', { n: d?.feePercent ?? 0 })}</span>
      </div>

      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {bought !== null && <p className="notice notice--ok">{t('market.bought', { n: bought })}</p>}

      <section className="section">
        <h2>{t('market.sell')}</h2>
        {d && d.sellable.length === 0
          ? <p className="center__body">{t('market.noSellable')}</p>
          : <>
              <span className="section__eyebrow">{t('market.chooseCreature')}</span>
              <div className="picks">
                {d?.sellable.map((c) => (
                  <button key={c.id} type="button"
                    className={`pick${selling === c.id ? ' pick--on' : ''}`}
                    aria-pressed={selling === c.id}
                    onClick={() => { haptic.select(); setSelling(selling === c.id ? null : c.id) }}>
                    <img src={c.sprite} alt="" width={40} height={40} className="pick__mon" />
                    <span className="pick__name">{c.displayName}</span>
                    <span className="pick__meta num">{t('creature.level', { n: c.level })}</span>
                  </button>
                ))}
              </div>
              {selling && (
                <div className="sellForm">
                  <label className="picker">
                    <span className="picker__label">{t('market.price')}</span>
                    <input className="field field--inline" type="number" inputMode="numeric"
                      min={d?.minPrice} max={d?.maxPrice} value={price}
                      onChange={(e) => setPrice(Number(e.target.value))} />
                  </label>
                  <label className="picker">
                    <span className="picker__label">{t('market.note')}</span>
                    <input className="field field--inline field--text" maxLength={140} value={note}
                      onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button type="button" className="btn btn--primary btn--block"
                    disabled={action.busy} onClick={list}>{t('market.sell')}</button>
                </div>
              )}
            </>}
      </section>

      {d && d.ownListings.length > 0 && (
        <section className="section">
          <h2>{t('market.own')}</h2>
          <div className="stack">
            {d.ownListings.map((l) => (
              <ListingRow key={l.id} listing={l} busy={action.busy}
                actionLabel={t('market.cancel')} onAction={() => cancel(l)} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>{t('market.offers')}</h2>
        {d && d.listings.length === 0
          ? <CenterState glyph="🏷️" title={t('market.empty.title')} body={t('market.empty.body')} />
          : <div className="stack">
              {d?.listings.map((l) => (
                <ListingRow key={l.id} listing={l} busy={action.busy || (d.gold < l.price)}
                  actionLabel={t('market.buy')} onAction={() => buy(l)} />
              ))}
            </div>}
      </section>
      {/*
        * Der Aushang des Verbunds.
        *
        * Nur zum Ansehen: gekauft wird ueber Instanzgrenzen noch nicht, und
        * das steht auch dabei. Ein Knopf, der nichts tut, waere schlimmer als
        * keiner — ein Angebot ohne Erklaerung, warum es keinen gibt, aber
        * auch.
        */}
      {d && d.global.length > 0 && (
        <section className="section">
          <h2>{t('market.global')}</h2>
          <p className="explain">{t('market.globalHint')}</p>
          {unterwegs && <p className="notice" role="status">{unterwegs}</p>}
          <div className="stack">
            {d.global.map((l) => (
              <div key={`${l.instanceId}:${l.id}`} className="listing listing--far">
                <div className="farRow">
                  {l.sprite && <img src={l.sprite} alt="" width={48} height={48} className="farRow__mon" />}
                  <span className="farRow__text">
                    <span className="farRow__name">
                      {l.speciesName}
                      {l.shiny && <span title={t('creature.shiny')}> ✨</span>}
                    </span>
                    <span className="farRow__meta num">
                      {t('creature.level', { n: l.level })} · {t('creature.ivs')} {l.ivPercent} %
                    </span>
                  </span>
                  <span className="listing__price num">{number(l.price)}</span>
                </div>
                <div className="listing__foot">
                  <span className="listing__meta">
                    <span className="listing__seller">{t('market.by', { name: l.sellerName })}</span>
                    {l.note && <span className="listing__note">„{l.note}"</span>}
                  </span>
                  <button
                    type="button" className="btn btn--sm"
                    disabled={action.busy || (d?.gold ?? 0) < l.price}
                    onClick={() => kaufeFern(l)}
                  >
                    {t('market.buy')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function ListingRow({ listing, busy, actionLabel, onAction }: {
  listing: MarketListingView; busy: boolean; actionLabel: string; onAction: () => void
}) {
  return (
    <div className="listing">
      {listing.creature && <CreatureCard creature={listing.creature} />}
      <div className="listing__foot">
        <span className="listing__meta">
          <span className="listing__price num">🪙 {number(listing.price)}</span>
          {!listing.isOwn && (
            <span className="listing__seller">
              {t('market.by', { name: listing.sellerName })}
              {listing.sellerIsBot && <span className="tag tag--bot">{t('rank.bot')}</span>}
            </span>
          )}
          {listing.note && <span className="listing__note">„{listing.note}"</span>}
        </span>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

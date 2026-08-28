import { useEffect, useState } from 'react'
import type { CenterEvent, CenterOffer } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

/**
 * Poke-Center.
 *
 * Ein Knopf, der immer heilt — und manchmal mehr. Die Abklingzeit laeuft
 * sichtbar herunter, statt den Knopf nur kommentarlos zu sperren: eine
 * Wartezeit, deren Ende man nicht sieht, fuehlt sich doppelt so lang an.
 */
export function CenterScreen({ onBack }: { onBack: () => void }) {
  const center = useAsync(() => api.center(), [])
  const action = useAction()
  const [event, setEvent] = useState<CenterEvent | null>(null)
  const [healed, setHealed] = useState(0)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const d = center.data
  const remaining = d && !d.ready ? Math.max(0, d.readyAt - Date.now()) : 0
  const ready = d ? d.ready || remaining === 0 : false

  const visit = () => {
    haptic.tap()
    void action.run(() => api.centerVisit(), (res) => {
      center.set(res.state)
      setHealed(res.healed)
      setEvent(res.event)
      if (res.event.kind !== 'none') haptic.success()
    })
  }

  if (center.loading && !d) {
    return <main className="content">{[0, 1].map((i) => <div key={i} className="skeleton skeleton--row" />)}</main>
  }

  return (
    <Screen
      eyebrow={t('center.eyebrow')}
      title={t('center.title')}
      onBack={onBack}
      aside={d && <span className="num">{t('center.hurt', { n: d.hurt, max: d.teamSize })}</span>}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}

        <section className="centerDesk">
          <span className="centerDesk__glyph" aria-hidden="true">🏥</span>
          <p className="centerDesk__line">
            {ready ? t('center.welcome') : t('center.wait', { time: clock(remaining) })}
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={!ready || action.busy}
            onClick={visit}
          >
            {ready ? t('center.heal') : clock(remaining)}
          </button>
          <p className="centerDesk__note">{t('center.cooldownNote', { n: Math.round((d?.cooldownMs ?? 0) / 60000) })}</p>
        </section>

        {event && <Outcome event={event} healed={healed} />}

        {d?.offer && (
          <TradeOffer
            offer={d.offer}
            busy={action.busy}
            onAccept={(creatureId) => {
              haptic.tap()
              void action.run(() => api.acceptTrade(d.offer!.id, creatureId), (res) => {
                center.set(res.state)
                setEvent(null)
                setHealed(0)
                haptic.success()
              })
            }}
            onDecline={() => {
              haptic.tap()
              void action.run(() => api.declineTrade(d.offer!.id), (next) => center.set(next))
            }}
          />
        )}

        <section className="explain">
          <h3>{t('center.explain.title')}</h3>
          <p>{t('center.explain.body')}</p>
        </section>
      </main>
    </Screen>
  )
}

function Outcome({ event, healed }: { event: CenterEvent; healed: number }) {
  return (
    <section className="centerResult" aria-live="polite">
      <p className="centerResult__heal">
        {healed > 0 ? t('center.healed', { n: healed }) : t('center.nothingToHeal')}
      </p>
      {event.kind === 'gold' && (
        <p className="centerResult__event num">🪙 {t('center.event.gold', { n: event.gold })}</p>
      )}
      {event.kind === 'gift' && (
        <p className="centerResult__event">
          <img src={event.item.icon} alt="" width={24} height={24} />
          {t('center.event.gift', { n: event.item.quantity, name: event.item.name })}
        </p>
      )}
      {event.kind === 'trade' && (
        <p className="centerResult__event">{t('center.event.trade', { name: event.offer.npcName })}</p>
      )}
    </section>
  )
}

function TradeOffer({
  offer, busy, onAccept, onDecline,
}: {
  offer: CenterOffer
  busy: boolean
  onAccept: (creatureId: string) => void
  onDecline: () => void
}) {
  const [pick, setPick] = useState<string | null>(offer.candidates[0]?.id ?? null)

  useEffect(() => { setPick(offer.candidates[0]?.id ?? null) }, [offer.id, offer.candidates])

  return (
    <section className="tradeOffer">
      <h2>{t('center.trade.title', { name: offer.npcName })}</h2>
      <p className="tradeOffer__line">
        {t('center.trade.line', { wanted: offer.wanted.name, offered: offer.offered.name })}
      </p>

      <div className="tradeOffer__deal">
        <span className="tradeOffer__side">
          <img src={offer.wanted.sprite} alt="" width={64} height={64} />
          <span className="tradeOffer__label">{t('center.trade.you')}</span>
          <span className="tradeOffer__name">{offer.wanted.name}</span>
        </span>
        <span className="tradeOffer__arrow" aria-hidden="true">⇄</span>
        <span className="tradeOffer__side">
          <img src={offer.offered.sprite} alt="" width={64} height={64} />
          <span className="tradeOffer__label">{t('center.trade.them')}</span>
          <span className="tradeOffer__name">
            {offer.offered.name} {offer.offered.shiny && '✨'}
          </span>
          <span className="num">{t('creature.level', { n: offer.offered.level })}</span>
        </span>
      </div>

      {offer.candidates.length === 0
        ? <p className="notice">{t('center.trade.noCandidate', { name: offer.wanted.name })}</p>
        : (
          <>
            <p className="tradeOffer__hint">{t('center.trade.choose')}</p>
            <ul className="tradeOffer__picks">
              {offer.candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="tradeOffer__pick"
                    aria-pressed={pick === c.id}
                    onClick={() => { haptic.select(); setPick(c.id) }}
                  >
                    <img src={c.sprite} alt="" width={32} height={32} />
                    <span className="tradeOffer__pickName">{c.displayName}</span>
                    <span className="num">{t('creature.level', { n: c.level })}</span>
                    {c.inTeam && <span className="tag">{t('center.trade.inTeam')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

      <div className="rowActions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || pick === null}
          onClick={() => pick && onAccept(pick)}
        >
          {t('center.trade.accept')}
        </button>
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onDecline}>
          {t('center.trade.decline')}
        </button>
      </div>
    </section>
  )
}

/** mm:ss, weil eine Restzeit in Sekunden niemand liest. */
function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

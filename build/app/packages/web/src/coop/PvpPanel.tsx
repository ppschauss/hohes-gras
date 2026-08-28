import { useState } from 'react'
import type { DuelResult } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'

export function PvpPanel() {
  const pvp = useAsync(() => api.pvp(), [])
  const ladder = useAsync(() => api.pvpLadder(), [])
  const history = useAsync(() => api.pvpHistory(), [])
  const action = useAction()
  const [result, setResult] = useState<DuelResult | null>(null)

  const d = pvp.data

  const fight = (opponentId: string) => {
    haptic.tap()
    void action.run(() => api.duel(opponentId), (res) => {
      setResult(res)
      pvp.reload(); ladder.reload(); history.reload()
      haptic[res.won ? 'success' : 'error']()
    })
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      {d && (
        <section className="ratingCard">
          <div>
            <span className="ratingCard__tier">{t(`tier.${d.tier}`)}</span>
            <span className="ratingCard__value num">{d.rating}</span>
          </div>
          <div className="ratingCard__meta num">
            <span>{t('pvp.record', { wins: d.wins, losses: d.losses })}</span>
            {d.streak !== 0 && <span>{t('pvp.streak', { n: d.streak })}</span>}
            <span>{t('pvp.duelsToday', { n: d.duelsToday })}</span>
            <span>{t('pvp.duelCost', { n: d.energyCost })}</span>
            <span>{t('pvp.levelCap', { n: d.levelCap })}</span>
            {d.unseenDefences > 0 && <span className="tag tag--count">{t('pvp.defended', { n: d.unseenDefences })}</span>}
          </div>
        </section>
      )}

      <p className="explain">{t('pvp.explain')}</p>

      {result && (
        <section className={`result${result.won ? ' result--win' : ''}`}>
          <h2>{result.won ? t('pvp.won') : t('pvp.lost')}</h2>
          <p className="center__body">{t('battle.vs', { name: result.opponentName })} · {t('battle.turn', { n: result.turns })}</p>
          <p className="num">{t('pvp.delta', { n: result.delta > 0 ? `+${result.delta}` : result.delta })}</p>
          <p className="num">{t('battle.reward.gold', { n: result.gold })}</p>
          {/* Sonst sieht der zweite Sieg wie ein Fehler aus: gewonnen, aber
              null Gold und null Wertung. */}
          {result.repeat && <p className="chain__hint">{t('pvp.repeat')}</p>}
        </section>
      )}

      <section className="section">
        <h2>{t('pvp.opponents')}</h2>
        {d && d.opponents.length === 0
          ? <p className="center__body">{t('pvp.noOpponents')}</p>
          : <div className="stack">
              {d?.opponents.map((o) => (
                <article key={o.trainerId} className="friend">
                  <span className="friend__text">
                    <span className="friend__name">{o.displayName}</span>
                    <span className="friend__meta num">{t(`tier.${o.tier}`)} · {o.rating}</span>
                    <span className="teamStrip">
                      {o.teamPreview.map((m, i) => (
                        <span key={i} className="teamStrip__mon">
                          <img src={m.sprite} alt="" width={28} height={28} />
                          <span className="num">{m.level}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                  <button type="button" className="btn btn--primary btn--sm"
                    disabled={action.busy || d.energy.current < d.energyCost}
                    onClick={() => fight(o.trainerId)}>{t('pvp.fight')}</button>
                </article>
              ))}
            </div>}
      </section>

      <section className="section">
        <h2>{t('pvp.ladder')}</h2>
        <ol className="ranking">
          {ladder.data?.rows.map((row) => (
            <li key={row.trainerId} className={`ranking__row${row.isSelf ? ' ranking__row--self' : ''}`}>
              <span className="ranking__place num">{row.rank}</span>
              <span className="ranking__text">
                <span className="ranking__name">{row.displayName}</span>
                <span className="ranking__meta num">{t(`tier.${row.tier}`)} · {t('pvp.record', { wins: row.wins, losses: row.losses })}</span>
              </span>
              <span className="ranking__score num">{number(row.rating)}</span>
            </li>
          ))}
        </ol>
      </section>

      {history.data && history.data.duels.length > 0 && (
        <section className="section">
          <h2>{t('pvp.history')}</h2>
          <div className="stack">
            {history.data.duels.map((duel) => (
              <article key={duel.id} className="friend">
                <span className="friend__text">
                  <span className="friend__name">{duel.opponentName}</span>
                  <span className="friend__meta num">
                    {duel.asChallenger ? t('pvp.asChallenger') : t('pvp.asDefender')} ·{' '}
                    {duel.won ? t('pvp.won') : t('pvp.lost')}
                  </span>
                </span>
                <span className={`num ${duel.delta >= 0 ? 'delta--up' : 'delta--down'}`}>
                  {duel.delta > 0 ? `+${duel.delta}` : duel.delta}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

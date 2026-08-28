import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number, untilLabel } from '../lib/format'

export function TournamentPanel() {
  const tournament = useAsync(() => api.tournament(), [])
  const action = useAction()
  const d = tournament.data

  const enter = () => {
    haptic.tap()
    void action.run(() => api.enterTournament(), (next) => { tournament.set(next); haptic.success() })
  }

  const nameOf = (id: string | null) =>
    id ? d?.entries.find((e) => e.trainerId === id)?.displayName ?? '?' : '—'

  const rounds = [...new Set((d?.bracket ?? []).map((m) => m.round))].sort()

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      {d && (
        <section className="goalCard">
          <span className="section__eyebrow">
            {d.state === 'finished' ? t('tournament.finished') : t('tournament.open')} · {d.weekKey}
          </span>
          <h3>{t('tournament.title')}</h3>
          <p className="center__body">{t('tournament.explain')}</p>
          <p className="num">
            {t('tournament.entries', { n: d.entryCount })}
            {d.state !== 'finished' && ` · ${t('tournament.closesIn', { n: untilLabel(d.closesAt) })}`}
          </p>
          {d.entryCount < d.minEntries && d.state !== 'finished' && (
            <p className="center__body">{t('tournament.needMore', { n: d.minEntries })}</p>
          )}
          {d.myPlacement && <p className="result__badge">{t('tournament.placement', { n: d.myPlacement })}</p>}
          <button type="button" className="btn btn--primary btn--block"
            disabled={d.entered || d.state !== 'open' || action.busy} onClick={enter}>
            {d.entered ? t('tournament.entered') : `${t('tournament.enter')} · ${t('tournament.fee', { n: d.entryFee })}`}
          </button>
        </section>
      )}

      <section className="section">
        <h2>{t('tournament.prizes')}</h2>
        <div className="statGrid">
          {d?.prizes.map((prize, i) => (
            <div key={i} className="statTile">
              <span className="statTile__value num">{number(prize)}</span>
              <span className="statTile__label">{t('tournament.placement', { n: i + 1 })}</span>
            </div>
          ))}
        </div>
      </section>

      {d && d.entries.length > 0 && (
        <section className="section">
          <h2>{t('tournament.entries', { n: d.entryCount })}</h2>
          <ol className="ranking">
            {d.entries.map((e) => (
              <li key={e.trainerId} className={`ranking__row${e.isSelf ? ' ranking__row--self' : ''}`}>
                <span className="ranking__place num">{e.placement ?? e.seed}</span>
                <span className="ranking__text">
                  <span className="ranking__name">{e.displayName}</span>
                  <span className="ranking__meta num">Team {e.seedScore}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {rounds.length > 0 && (
        <section className="section">
          <h2>{t('tournament.bracket')}</h2>
          {rounds.map((round) => (
            <div key={round} className="bracketRound">
              <span className="section__eyebrow">{t('tournament.round', { n: round })}</span>
              {d?.bracket.filter((m) => m.round === round).map((m, i) => (
                <div key={i} className="bracketMatch">
                  <span className={m.winner === m.a ? 'bracketMatch__win' : ''}>{nameOf(m.a)}</span>
                  <span className="bracketMatch__vs">vs</span>
                  <span className={m.winner === m.b ? 'bracketMatch__win' : ''}>{nameOf(m.b)}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  )
}

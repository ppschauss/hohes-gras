import { t } from '../i18n'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { number } from '../lib/format'

export function RankingPanel() {
  const board = useAsync(() => api.leaderboard(), [])
  const d = board.data

  return (
    <>
      {d && (
        <p className="center__body">
          {d.hidden ? t('rank.hidden') : d.ownRank ? t('rank.yourRank', { n: d.ownRank }) : t('card.noRank')}
        </p>
      )}

      {board.loading && !d
        ? [0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)
        : d && d.rows.length === 0
          ? <p className="center__body">{t('rank.empty')}</p>
          : <ol className="ranking">
              {d?.rows.map((row) => (
                <li key={row.trainerId} className={`ranking__row${row.isSelf ? ' ranking__row--self' : ''}`}>
                  <span className="ranking__place num">{row.rank}</span>
                  <span className="ranking__text">
                    <span className="ranking__name">{row.displayName}</span>
                    <span className="ranking__meta num">
                      🏅{row.badges} · 📖{row.dexCaught} · ⚔️{row.battlesWon}
                      {row.shinies > 0 && ` · ✨${row.shinies}`}
                    </span>
                  </span>
                  <span className="ranking__score num">{number(row.score)}</span>
                </li>
              ))}
            </ol>}
    </>
  )
}

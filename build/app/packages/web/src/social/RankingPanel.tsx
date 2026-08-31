import { useState } from 'react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { number } from '../lib/format'

/**
 * Rangliste.
 *
 * Zwei Listen, wenn ein Verbund läuft: die eigene Runde und alle Instanzen
 * zusammen. Ohne Verbund gibt es die Umschaltung nicht — ein Schalter mit nur
 * einer Wahl ist keine Wahl.
 */
export function RankingPanel() {
  const board = useAsync(() => api.leaderboard(), [])
  const [scope, setScope] = useState<'local' | 'global'>('local')
  const d = board.data
  const global = d?.global ?? null
  const showing = global && scope === 'global' ? 'global' : 'local'

  return (
    <>
      {d && (
        <p className="center__body">
          {d.hidden ? t('rank.hidden') : d.ownRank ? t('rank.yourRank', { n: d.ownRank }) : t('card.noRank')}
        </p>
      )}

      {global && (
        <div className="segmented" role="tablist">
          {(['local', 'global'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={showing === id}
              className="segmented__btn"
              onClick={() => setScope(id)}
            >
              {t(`rank.scope.${id}`)}
            </button>
          ))}
        </div>
      )}

      {board.loading && !d
        ? [0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)
        : showing === 'global'
          ? global!.length === 0
            ? <p className="center__body">{t('rank.globalEmpty')}</p>
            : <ol className="ranking">
                {global!.map((row) => (
                  <li key={row.trainerId} className={`ranking__row${row.isSelf ? ' ranking__row--self' : ''}`}>
                    <span className="ranking__place num">{row.rank}</span>
                    <span className="ranking__text">
                      <span className="ranking__name">{row.displayName}</span>
                      <span className="ranking__meta num">
                        🏅{row.badges} · 📖{row.dexCaught} · ⚔️{row.battlesWon}
                        {' · '}{t('rank.instance', { name: row.instanceId })}
                      </span>
                    </span>
                    <span className="ranking__score num">{number(row.level)}</span>
                  </li>
                ))}
              </ol>
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

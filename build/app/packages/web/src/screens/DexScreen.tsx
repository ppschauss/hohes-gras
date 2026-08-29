import { useMemo, useState } from 'react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

type Filter = 'all' | 'seen' | 'caught' | 'missing'

export function DexScreen({ onBack }: { onBack: () => void }) {
  const dex = useAsync(() => api.dex(), [])
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const all = dex.data?.rows ?? []
    // "Gesehen" heisst: begegnet, aber noch nicht im Team gelandet — der
    // Zwischenstand, den der Dex vorher nicht zeigen konnte.
    if (filter === 'seen') return all.filter((r) => r.seen && !r.caught)
    if (filter === 'caught') return all.filter((r) => r.caught)
    if (filter === 'missing') return all.filter((r) => !r.seen && !r.caught)
    return all
  }, [dex.data, filter])

  const counts = dex.data?.counts

  return (
    <Screen
      eyebrow={t('dex.eyebrow')}
      title={t('dex.title')}
      onBack={onBack}
      aside={counts && <span className="num">{counts.caught}/{counts.total}</span>}
    >
      <main className="content">
        {counts && (
          <div className="progressCard">
            <div className="bar bar--lg">
              <span className="bar__fill bar__fill--dex" style={{ width: `${(counts.caught / counts.total) * 100}%` }} />
            </div>
            <p className="center__body">
              {t('dex.progress', { caught: counts.caught, total: counts.total })}
              {' · '}
              {t('dex.seenCount', { n: counts.seen })}
            </p>
          </div>
        )}

        <div className="segmented" role="tablist">
          {(['all', 'seen', 'caught', 'missing'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className="segmented__btn"
              onClick={() => setFilter(f)}
            >
              {t(`dex.filter.${f}`)}
            </button>
          ))}
        </div>

        {dex.loading && !dex.data
          ? <div className="dexgrid">{Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton dexcell" />)}</div>
          : <div className="dexgrid">
              {rows.map((r) => (
                <article key={r.speciesId} className={`dexcell${r.caught ? '' : ' dexcell--locked'}`}>
                  <span className="dexcell__num num">#{String(r.dexNumber).padStart(3, '0')}</span>
                  <img
                    className="dexcell__sprite"
                    src={r.sprite}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="dexcell__name">{r.caught || r.seen ? r.name : t('dex.unknown')}</span>
                  {r.owned > 1 && <span className="dexcell__owned num">{t('dex.owned', { n: r.owned })}</span>}
                </article>
              ))}
            </div>}
      </main>
    </Screen>
  )
}

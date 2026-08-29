import { useMemo, useState } from 'react'
import { t } from '../i18n'
import { api, type HabitatArea } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

type Filter = 'all' | 'seen' | 'caught' | 'missing'

export function DexScreen({ onBack }: { onBack: () => void }) {
  const dex = useAsync(() => api.dex(), [])
  const [filter, setFilter] = useState<Filter>('all')
  /** Welche Art gerade ihren Fundort zeigt. */
  const [open, setOpen] = useState<string | null>(null)

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
        {open && <Habitat speciesId={open} onClose={() => setOpen(null)} />}

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
                /* Gesehene und gefangene lassen sich antippen: dahinter steht,
                   wo man sie findet. Bei unbekannten waere es eine Karte zu
                   einem Ort, den man noch nicht kennen soll. */
                <article key={r.speciesId} className={`dexcell${r.caught ? '' : ' dexcell--locked'}`}>
                  {(r.seen || r.caught) && (
                    <button type="button" className="dexcell__hit"
                      aria-label={t('dex.where', { name: r.name })}
                      onClick={() => { haptic.tap(); setOpen(r.speciesId) }} />
                  )}
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

/**
 * Wo man es findet.
 *
 * Steht nur fuer Arten offen, die man schon gesehen hat — bei allen anderen
 * waere es eine Karte zu einem Ort, den man erst noch entdecken soll. Die
 * Gebiete stehen nach Haeufigkeit sortiert: die erste Zeile ist die Antwort
 * auf "wo am ehesten".
 */
function Habitat({ speciesId, onClose }: { speciesId: string; onClose: () => void }) {
  const habitat = useAsync(() => api.habitat(speciesId), [speciesId])
  const d = habitat.data

  return (
    <section className="section habitat">
      <div className="sectionHead">
        <h2>{d?.name ? t('dex.whereTitle', { name: d.name }) : t('dex.whereLoading')}</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>{t('moves.close')}</button>
      </div>

      {habitat.loading && !d && <div className="skeleton skeleton--row" />}
      {d && d.areas.length === 0 && <p className="center__body">{t('dex.whereNone')}</p>}

      <ul className="habitat__list">
        {(d?.areas ?? []).map((a) => (
          <li key={a.areaId} className={`habitat__row${a.visited ? '' : ' habitat__row--far'}`}>
            <span className="habitat__where">
              <span className="habitat__area">{a.areaName}</span>
              <span className="habitat__region">{a.regionName}{a.visited ? '' : ` · ${t('dex.whereUnvisited')}`}</span>
            </span>
            <span className="habitat__facts num">
              <span>{t('dex.whereChance', { n: a.chance })}</span>
              <span className="habitat__level">{t('dex.whereLevel', { from: a.minLevel, to: a.maxLevel })}</span>
              {conditions(a) && <span className="habitat__when">{conditions(a)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Tageszeit und Wetter als ein Satzteil — beides steht selten, aber wenn, ist
 *  es der Grund, warum jemand vergeblich sucht. */
function conditions(a: HabitatArea): string | null {
  const parts: string[] = []
  if (a.timeOfDay?.length) parts.push(a.timeOfDay.map((x) => t(`time.${x}`)).join('/'))
  if (a.weather?.length) parts.push(a.weather.map((x) => t(`weather.${x}`)).join('/'))
  return parts.length > 0 ? t('dex.whereOnly', { what: parts.join(', ') }) : null
}

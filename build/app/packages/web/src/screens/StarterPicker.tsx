import { useState } from 'react'
import type { StartRegion, StarterOption } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

interface Props { onDone: () => void }

export function StarterPicker({ onDone }: Props) {
  const info = useAsync(() => api.starterInfo(), [])
  const [region, setRegion] = useState<StartRegion | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const action = useAction()

  if (info.loading) return <div className="content"><div className="skeleton skeleton--journey" /></div>
  if (info.error || !info.data) {
    return (
      <CenterState glyph="⚠️" title={t('error.network')}>
        <button type="button" className="btn btn--ghost" onClick={info.reload}>{t('app.retry')}</button>
      </CenterState>
    )
  }

  const regions = info.data.regions
  // Bei nur einer freien Region gibt es nichts zu waehlen — dann waere der
  // Schritt eine Frage mit einer einzigen Antwort.
  const picked = region ?? (regions.length === 1 ? regions[0] : null)

  const chooseRegion = (r: StartRegion) => { haptic.tap(); setRegion(r); setChosen(null) }

  const confirm = (option: StarterOption) => {
    haptic.tap()
    if (chosen !== option.speciesId) { setChosen(option.speciesId); return }
    void action.run(
      () => api.chooseStarter(option.speciesId, picked?.regionId ?? null),
      () => { haptic.success(); onDone() },
    )
  }

  if (!picked) {
    return (
      <main className="content">
        <section className="intro">
          <h1>{t('start.region.title')}</h1>
          <p className="intro__lead">{t('start.region.body')}</p>
        </section>

        <div className="starters">
          {regions.map((r) => (
            <button key={r.regionId} type="button" className="region" onClick={() => chooseRegion(r)}>
              <span className="region__name">{r.name}</span>
              <span className="region__tagline">{r.tagline}</span>
              <span className="region__meta">
                {t('start.region.meta', { area: r.areaName, count: String(r.areaCount) })}
              </span>
            </button>
          ))}
        </div>
      </main>
    )
  }

  return (
    <main className="content">
      <section className="intro">
        <h1>{t('starter.title')}</h1>
        <p className="intro__lead">{t('starter.body')}</p>
      </section>

      {regions.length > 1 && (
        <div className="pickedRegion">
          <span className="pickedRegion__label">{t('start.region.picked', { name: picked.name })}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => { haptic.tap(); setRegion(null); setChosen(null) }}
            disabled={action.busy}
          >
            {t('start.region.change')}
          </button>
        </div>
      )}

      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}

      <div className="starters">
        {info.data.options.map((option) => {
          const selected = chosen === option.speciesId
          return (
            <button
              key={option.speciesId}
              type="button"
              className={`starter${selected ? ' starter--selected' : ''}`}
              onClick={() => confirm(option)}
              disabled={action.busy}
              aria-pressed={selected}
            >
              <img className="starter__art" src={option.sprite} alt="" width={112} height={112} />
              <span className="starter__name">{option.name}</span>
              <span className="starter__types">
                {option.types.map((type) => (
                  <span key={type.id} className="chip" style={{ '--chip': type.color } as React.CSSProperties}>
                    {type.name}
                  </span>
                ))}
              </span>
              <span className="starter__desc">{option.description}</span>
              {selected && (
                <span className="starter__confirm">
                  {action.busy ? <span className="spinner" /> : t('starter.choose', { name: option.name })}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {chosen && !action.busy && <p className="center__body">{t('starter.confirm')}</p>}
    </main>
  )
}

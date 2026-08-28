import { useState } from 'react'
import type { StarterOption } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'

interface Props { onDone: () => void }

export function StarterPicker({ onDone }: Props) {
  const info = useAsync(() => api.starterInfo(), [])
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

  const confirm = (option: StarterOption) => {
    haptic.tap()
    if (chosen !== option.speciesId) { setChosen(option.speciesId); return }
    void action.run(() => api.chooseStarter(option.speciesId), () => { haptic.success(); onDone() })
  }

  return (
    <main className="content">
      <section className="intro">
        <h1>{t('starter.title')}</h1>
        <p className="intro__lead">{t('starter.body')}</p>
      </section>

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

import { useState } from 'react'
import type { ThemeView } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { haptic } from '../lib/telegram'
import { useTheme } from '../lib/theme'
import { useAction, useAsync } from '../lib/useAsync'
import { useGame } from '../store'
import { Icon } from '../ui/Icon'
import { Screen } from '../ui/Screen'
import { DataPanel } from '../progress/DataPanel'

/**
 * Der Design-Laden.
 *
 * Jede Kachel zeigt ihre eigene Palette — nicht den Namen einer Farbe, sondern
 * die Farbe. Ein Design, das man erst kaufen muss, um es zu sehen, verkauft
 * sich zu Recht nicht.
 */
const GROUPS = ['basis', 'typ', 'region', 'anime'] as const
const MODES = ['auto', 'day', 'night'] as const

const format = (n: number): string => new Intl.NumberFormat('de-DE').format(n)

export function ThemeScreen({ onBack }: { onBack: () => void }) {
  const themes = useAsync(() => api.themes(), [])
  const action = useAction()
  const applyTheme = useTheme((s) => s.apply)
  const clock = useGame((s) => s.boot?.clock.timeOfDay ?? 'day')
  /** Aussehen oder Konto — beides sind Einstellungen. */
  const [pane, setPane] = useState<'look' | 'data'>('look')
  const d = themes.data

  /** Nach jeder Änderung sofort anwenden — Vorschau ist die Anwendung. */
  const adopt = (next: typeof d) => {
    if (!next) return
    themes.set(next)
    applyTheme(next.activeId, next.mode, clock)
  }

  if (themes.loading && !d) {
    return <main className="content">{[0, 1].map((i) => <div key={i} className="skeleton skeleton--row" />)}</main>
  }

  return (
    <Screen eyebrow={t('themes.eyebrow')} title={t('themes.title')} onBack={onBack}>
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        <div className="segmented" role="tablist">
          {(['look', 'data'] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={pane === id}
              className="segmented__btn" onClick={() => { haptic.select(); setPane(id) }}>
              {t(`themes.pane.${id}`)}
            </button>
          ))}
        </div>

        {/* Export und Loeschen des Spielstands standen als neunter Reiter im
            Fortschritt — zwischen Erfolgen und Saison, wo sie niemand sucht.
            Aussehen und Konto sind beides Einstellungen. */}
        {pane === 'data' && <DataPanel />}

        {pane === 'look' && (<>
        <section className="section">
          <h2>{t('themes.mode')}</h2>
          <div className="segmented" role="tablist">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={d?.mode === m}
                className="segmented__btn"
                disabled={action.busy}
                onClick={() => {
                  haptic.select()
                  void action.run(() => api.setThemeMode(m), adopt)
                }}
              >
                {t(`themes.mode.${m}`)}
              </button>
            ))}
          </div>
          <p className="explain">
            {d?.mode === 'auto'
              ? t('themes.mode.autoHint', { mode: t(`themes.mode.${d.resolvedMode}`) })
              : t('themes.mode.fixedHint')}
          </p>
        </section>

        {GROUPS.map((group) => {
          const list = d?.themes.filter((x) => x.group === group) ?? []
          if (list.length === 0) return null
          return (
            <section key={group} className="section">
              <h2>{t(`themes.group.${group}`)}</h2>
              <div className="themeGrid">
                {list.map((theme) => (
                  <ThemeTile
                    key={theme.id}
                    theme={theme}
                    gold={d?.gold ?? 0}
                    busy={action.busy}
                    onBuy={() => {
                      haptic.tap()
                      void action.run(() => api.buyTheme(theme.id), (next) => { adopt(next); haptic.success() })
                    }}
                    onWear={() => {
                      haptic.tap()
                      void action.run(() => api.wearTheme(theme.id), adopt)
                    }}
                  />
                ))}
              </div>
            </section>
          )
        })}
        </>)}
      </main>
    </Screen>
  )
}

interface TileProps {
  theme: ThemeView
  gold: number
  busy: boolean
  onBuy: () => void
  onWear: () => void
}

function ThemeTile({ theme, gold, busy, onBuy, onWear }: TileProps) {
  const affordable = gold >= theme.price
  const style = {
    '--pv-ground': theme.preview.ground,
    '--pv-accent': theme.preview.accent,
    '--pv-spot': theme.preview.spot,
  } as React.CSSProperties

  return (
    <article className={`themeCard${theme.active ? ' themeCard--active' : ''}`} style={style}>
      <span className="themeCard__preview" aria-hidden="true">
        <span className="themeCard__bar themeCard__bar--accent" />
        <span className="themeCard__bar themeCard__bar--spot" />
        <span className="themeCard__dot" />
      </span>

      <span className="themeCard__text">
        <span className="themeCard__name">
          {t(theme.name)}
          {theme.active && <Icon name="check" size={15} />}
        </span>
        <span className="themeCard__hint">{t(theme.description)}</span>
      </span>

      {theme.owned ? (
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={busy || theme.active}
          onClick={onWear}
        >
          {theme.active ? t('themes.worn') : t('themes.wear')}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy || !affordable}
          onClick={onBuy}
        >
          {format(theme.price)}
        </button>
      )}
    </article>
  )
}

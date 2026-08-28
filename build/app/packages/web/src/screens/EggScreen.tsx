import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type CreatureLike } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { minutesLabel } from '../lib/format'
import { Screen } from '../ui/Screen'
import { CenterState } from '../ui/States'

export function EggScreen({ onBack }: { onBack: () => void }) {
  const overview = useAsync(() => api.eggs(), [])
  const action = useAction()
  const [parents, setParents] = useState<string[]>([])
  const [hatched, setHatched] = useState<CreatureLike | null>(null)

  const data = overview.data

  const toggle = (id: string) => {
    haptic.select()
    setParents((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id)
        : prev.length >= 2 ? [prev[1]!, id]   // Aeltester Eintrag weicht
        : [...prev, id])
  }

  const pair = () => {
    haptic.tap()
    void action.run(() => api.pairEggs(parents[0]!, parents[1]!), (res) => {
      overview.set(res.overview)
      setParents([])
      haptic.success()
    })
  }

  const hatch = (id: string) => {
    haptic.tap()
    void action.run(() => api.hatchEgg(id), (res) => {
      overview.set(res.overview)
      setHatched(res.creature)
      haptic.success()
    })
  }

  const canPair = parents.length === 2 && (data?.eggs.length ?? 0) < (data?.maxEggs ?? 3)

  return (
    <Screen
      eyebrow={t('egg.eyebrow')}
      title={t('egg.title')}
      onBack={onBack}
      aside={data && <span className="num">{t('egg.slots', { open: data.eggs.length, max: data.maxEggs })}</span>}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {hatched && (
          <section className="stage stage--win">
            <img className="stage__mon" src={hatched.sprite} alt="" width={96} height={96} />
            <h2>{t('egg.hatched', { name: hatched.displayName })}</h2>
          </section>
        )}

        {data && data.eggs.length === 0 && !hatched
          ? <CenterState glyph="🥚" title={t('egg.empty.title')} body={t('egg.empty.body', { n: data.minLevel })} />
          : <div className="eggs">
              {data?.eggs.map((egg) => (
                <article key={egg.id} className="egg">
                  <span className={`egg__shell${egg.ready ? ' egg__shell--ready' : ''}`} aria-hidden="true">
                    {egg.ready && egg.sprite
                      ? <img src={egg.sprite} alt="" width={56} height={56} className="egg__mon" />
                      : '🥚'}
                  </span>
                  <span className="egg__text">
                    <span className="egg__name">{egg.speciesName ?? t('egg.unknown')}</span>
                    <span className="egg__hint">{t(egg.ivPercentHint)}</span>
                    <span className="bar">
                      <span className="bar__fill bar__fill--egg" style={{ width: `${egg.progress * 100}%` }} />
                    </span>
                    <span className="egg__time num">
                      {egg.ready ? t('egg.ready') : t('egg.readyIn', { n: minutesLabel(egg.minutesLeft) })}
                    </span>
                  </span>
                  <button type="button" className="btn btn--primary btn--sm"
                    disabled={!egg.ready || action.busy} onClick={() => hatch(egg.id)}>
                    {t('egg.hatch')}
                  </button>
                </article>
              ))}
            </div>}

        <section className="section">
          <h2>{t('egg.chooseParents')}</h2>
          {data && data.candidates.length < 2
            ? <p className="center__body">{t('egg.notEnoughCandidates', { n: data.minLevel })}</p>
            : <>
                <div className="picks">
                  {data?.candidates.map((c) => {
                    const chosen = parents.includes(c.id)
                    return (
                      <button key={c.id} type="button" className={`pick${chosen ? ' pick--on' : ''}`}
                        aria-pressed={chosen} onClick={() => toggle(c.id)}>
                        <img src={c.sprite} alt="" width={40} height={40} className="pick__mon" />
                        <span className="pick__name">{c.name}</span>
                        <span className="pick__meta">{t('egg.groups', { groups: c.eggGroups.join(', ') })}</span>
                      </button>
                    )
                  })}
                </div>
                <button type="button" className="btn btn--primary btn--block"
                  disabled={!canPair || action.busy} onClick={pair}>
                  {t('egg.pair')}
                </button>
              </>}
        </section>
      </main>
    </Screen>
  )
}

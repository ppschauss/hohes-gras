import { useEffect, useState } from 'react'
import type { CareAction, CareResponse, GardenState } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'
import { CreatureCard } from '../ui/CreatureCard'
import { Icon, type IconName } from '../ui/Icon'
import { MovesPanel } from '../ui/MovesPanel'
import { Screen } from '../ui/Screen'

const CARE_ICONS: Record<CareAction, IconName> = {
  feed: 'feed', play: 'play', wash: 'wash', rest: 'rest',
}
const CARE_ORDER: CareAction[] = ['feed', 'play', 'wash', 'rest']

interface Props {
  onBack: () => void
  onOpenBox: () => void
  onOpenDex: () => void
}

export function GardenScreen({ onBack, onOpenBox, onOpenDex }: Props) {
  const garden = useAsync(() => api.garden(), [])
  const action = useAction()
  const [flash, setFlash] = useState<CareResponse['gained']>([])
  const [openMoves, setOpenMoves] = useState<string | null>(null)

  // The gain toast is informational, not a state the player has to dismiss.
  useEffect(() => {
    if (flash.length === 0) return
    const timer = setTimeout(() => setFlash([]), 2600)
    return () => clearTimeout(timer)
  }, [flash])

  if (garden.loading && !garden.data) {
    return <main className="content"><div className="skeleton skeleton--journey" /><div className="skeleton skeleton--row" /></main>
  }
  if (!garden.data) {
    return (
      <CenterState glyph="⚠️" title={t('error.network')}>
        <button type="button" className="btn btn--ghost" onClick={garden.reload}>{t('app.retry')}</button>
      </CenterState>
    )
  }

  const g: GardenState = garden.data
  const care = (a: CareAction) => {
    haptic.tap()
    void action.run(() => api.care(a), (res) => {
      garden.set(res.garden)
      setFlash(res.gained)
      if (res.gained.some((x) => x.leveledUp)) haptic.success()
    })
  }

  return (
    <Screen
      eyebrow={t('garden.eyebrow')}
      title={t('garden.title')}
      onBack={onBack}
    >
      <main className="content">
        <Meadow team={g.team} background={g.background.id} />

        <div className="careRow">
          {CARE_ORDER.map((a) => {
            const info = g.care.actions.find((x) => x.action === a)!
            return (
              <button
                key={a}
                type="button"
                className="careBtn"
                onClick={() => care(a)}
                disabled={!info.available || action.busy}
                title={info.blockedReason ? t(info.blockedReason) : undefined}
              >
                <Icon name={CARE_ICONS[a]} size={22} className="careBtn__glyph" />
                <span className="careBtn__label">{t(`care.${a}`)}</span>
                <span className="careBtn__hint">
                  {info.blockedReason ? t(info.blockedReason) : t(`care.${a}.hint`)}
                </span>
              </button>
            )
          })}
        </div>

        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {flash.length > 0 && (
          <ul className="gains" aria-live="polite">
            {flash.map((gain) => (
              <li key={gain.creatureId} className="gains__row">
                <span>{gain.displayName}</span>
                <span className="gains__xp num">{t('care.gain.xp', { n: gain.xpGained })}</span>
                {gain.leveledUp && <span className="tag tag--level">{t('care.gain.levelUp', { n: gain.newLevel })}</span>}
              </li>
            ))}
          </ul>
        )}

        <section className="explain">
          <h3>{t('garden.explainer.title')}</h3>
          <p>{t('garden.explainer.body', { n: g.care.energyCost })}</p>
        </section>

        <section className="section">
          <div className="section__head">
            <div>
              <span className="section__eyebrow">{t('garden.teamLimit', { n: g.teamCapacity })}</span>
              <h2>{t('garden.teamHeading')}</h2>
            </div>
            <div className="section__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenDex}>{t('garden.openDex')}</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenBox}>
                {t('garden.openBox')}{g.boxCount > 0 && <span className="tag tag--count">{g.boxCount}</span>}
              </button>
            </div>
          </div>

          {g.team.length === 0
            ? <CenterState glyph="🌱" title={t('garden.empty.title')} body={t('garden.empty.body')}>
                <button type="button" className="btn btn--primary" onClick={onOpenBox}>{t('garden.openBox')}</button>
              </CenterState>
            : <div className="stack">
                {g.team.map((c) => (
                  <div key={c.id}>
                    <CreatureCard
                      creature={c}
                      actions={[{
                        label: openMoves === c.id ? t('moves.close') : t('moves.edit'),
                        onClick: () => setOpenMoves(openMoves === c.id ? null : c.id),
                      }]}
                    />
                    {openMoves === c.id && <MovesPanel creatureId={c.id} />}
                  </div>
                ))}
              </div>}
        </section>
      </main>
    </Screen>
  )
}

/** The garden scene itself: sprites standing on a strip of grass, in team
 *  order. Purely decorative — every number lives in the cards below. */
function Meadow({ team, background }: { team: GardenState['team']; background: string }) {
  return (
    <section className={`meadow meadow--${background.replace(/^bg-/, '')}`} aria-hidden="true">
      <span className="meadow__sky" />
      <span className="meadow__sun" />
      <span className="meadow__ground" />
      <span className="meadow__cast">
        {team.map((c, i) => (
          <img
            key={c.id}
            className="meadow__mon"
            src={c.sprite}
            alt=""
            width={64}
            height={64}
            style={{ animationDelay: `${i * 0.35}s` }}
          />
        ))}
      </span>
    </section>
  )
}

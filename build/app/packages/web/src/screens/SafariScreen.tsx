import { useEffect, useRef, useState } from 'react'
import type { EncounterView, ThrowResult } from '../lib/api'
import { t } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { percent } from '../lib/format'
import { Screen } from '../ui/Screen'
import { ItemIcon } from '../ui/ItemIcon'

type Phase =
  | { kind: 'idle' }
  | { kind: 'event'; opponent: { name: string; title: string; sprite: string; intro: string } }
  | { kind: 'encounter'; encounter: EncounterView; legendary?: boolean }
  | { kind: 'throwing'; encounter: EncounterView; shakes: number }
  | { kind: 'caught'; result: ThrowResult }
  | { kind: 'fled'; name: string }
  | { kind: 'nothing' }

const SHAKE_MS = 520

export function SafariScreen({ onBack, onEventBattle }: { onBack: () => void; onEventBattle: () => void }) {
  const bag = useAsync(() => api.bag(), [])
  const [ballId, setBallId] = useState('poke-ball')
  const [berryId, setBerryId] = useState<string | null>(null)
  const safari = useAsync(() => api.safari(ballId, berryId), [ballId, berryId])
  const action = useAction()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const timers = useRef<number[]>([])

  // Resume an encounter that was left open — closing the Mini App must not
  // silently lose the creature the player was working on.
  useEffect(() => {
    if (safari.data?.encounter && phase.kind === 'idle') {
      setPhase({ kind: 'encounter', encounter: safari.data.encounter })
    }
  }, [safari.data, phase.kind])

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  const balls = (bag.data?.items ?? []).filter((i) => i.category === 'ball' && i.quantity > 0)
  const berries = (bag.data?.items ?? []).filter((i) => i.category === 'berry' && i.quantity > 0)
  const ballCount = balls.find((b) => b.id === ballId)?.quantity ?? 0

  const explore = () => {
    haptic.tap()
    void action.run(() => api.explore(ballId, berryId), (res) => {
      if (res.kind === 'encounter') {
        setPhase({ kind: 'encounter', encounter: res.encounter, legendary: res.legendary })
        if (res.legendary) haptic.success(); else haptic.select()
      } else if (res.kind === 'event') {
        setPhase({ kind: 'event', opponent: res.opponent })
        haptic.error()
      } else {
        setPhase({ kind: 'nothing' })
      }
      safari.reload()
    })
  }

  const soften = (kind: 'weaken' | 'calm') => {
    if (phase.kind !== 'encounter') return
    haptic.tap()
    void action.run(() => api.soften(kind, ballId, berryId), (e) => setPhase({ kind: 'encounter', encounter: e }))
  }

  const throwBall = () => {
    if (phase.kind !== 'encounter') return
    const encounter = phase.encounter
    haptic.tap()
    void action.run(() => api.throwBall(ballId, berryId), (res) => {
      // Play the wobbles before revealing the outcome. The shake count comes
      // from the server and already agrees with the result, so the animation
      // can never lie about what happened.
      setPhase({ kind: 'throwing', encounter, shakes: 0 })
      const total = Math.min(res.shakes, 3)
      for (let i = 1; i <= total; i++) {
        timers.current.push(window.setTimeout(() => {
          setPhase({ kind: 'throwing', encounter, shakes: i })
          haptic.tap()
        }, SHAKE_MS * i))
      }
      timers.current.push(window.setTimeout(() => {
        bag.reload()
        safari.reload()
        if (res.caught) { haptic.success(); setPhase({ kind: 'caught', result: res }) }
        else if (res.fled) { haptic.error(); setPhase({ kind: 'fled', name: encounter.speciesName }) }
        else setPhase({ kind: 'encounter', encounter: res.encounter ?? encounter })
      }, SHAKE_MS * (total + 1)))
    })
  }

  const flee = () => {
    haptic.tap()
    void action.run(() => api.flee(), () => { setPhase({ kind: 'idle' }); safari.reload() })
  }

  return (
    <Screen
      eyebrow={t('safari.eyebrow')}
      title={safari.data?.encounter?.areaName ?? t('safari.title')}
      onBack={onBack}
      aside={safari.data && (
        <span className="num">{t('safari.explores', { n: safari.data.exploresUsed })}</span>
      )}
    >
      <main className="content">
        <Stage
          phase={phase}
          busy={action.busy}
          onFight={() => {
            haptic.tap()
            void action.run(() => api.startEventBattle(), () => onEventBattle())
          }}
        />

        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {phase.kind === 'encounter' && phase.encounter.legendary && (
          <section className="legendary">
            <p className="legendary__lead">
              {t('safari.legendary.lead', {
                n: phase.encounter.legendaryBerries,
                max: phase.encounter.maxLegendaryBerries,
                chance: percent(phase.encounter.probability),
              })}
            </p>
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={action.busy
                || phase.encounter.legendaryBerries >= phase.encounter.maxLegendaryBerries
                || phase.encounter.berriesOwned < 1}
              onClick={() => {
                haptic.tap()
                void action.run(() => api.useLegendaryBerry(ballId, berryId),
                  (e) => setPhase({ kind: 'encounter', encounter: e, legendary: true }))
              }}
            >
              {phase.encounter.berriesOwned < 1
                ? t('safari.legendary.none')
                : t('safari.legendary.use', { n: phase.encounter.berriesOwned })}
            </button>
            <p className="legendary__hint">{t('safari.legendary.hint')}</p>
          </section>
        )}

        {phase.kind === 'encounter' && !phase.encounter.legendary && (
          <div className="softenRow">
            <button type="button" className="softenBtn" disabled={action.busy || phase.encounter.weakenStacks >= phase.encounter.maxWeaken}
              onClick={() => soften('weaken')}>
              <span>{t('safari.weaken')}</span>
              <span className="num">{t('safari.stacks', { have: phase.encounter.weakenStacks, max: phase.encounter.maxWeaken })}</span>
            </button>
            <button type="button" className="softenBtn" disabled={action.busy || phase.encounter.calmStacks >= phase.encounter.maxCalm}
              onClick={() => soften('calm')}>
              <span>{t('safari.calm')}</span>
              <span className="num">{t('safari.stacks', { have: phase.encounter.calmStacks, max: phase.encounter.maxCalm })}</span>
            </button>
          </div>
        )}

        <div className="pickers">
          <Picker
            label={t('safari.ball')}
            options={balls.map((b) => ({ id: b.id, name: b.name, icon: b.icon, category: b.category, quantity: b.quantity }))}
            value={ballId}
            onChange={setBallId}
          />
          <Picker
            label={t('safari.berry')}
            options={berries.map((b) => ({ id: b.id, name: b.name, icon: b.icon, category: b.category, quantity: b.quantity }))}
            value={berryId}
            onChange={setBerryId}
            emptyLabel={t('safari.noBerry')}
          />
        </div>

        <div className="actionRow">
          <button type="button" className="btn btn--ghost btn--block" onClick={explore}
            disabled={action.busy || phase.kind === 'throwing'
              || (safari.data ? safari.data.energy.current < safari.data.energyCost : false)}>
            {t('safari.explore')}
          </button>
          <button type="button" className="btn btn--primary btn--block" onClick={throwBall}
            disabled={action.busy || phase.kind !== 'encounter' || ballCount < 1}>
            {t('safari.catch')}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={flee}
            disabled={action.busy || phase.kind !== 'encounter'}>
            {t('safari.stop')}
          </button>
        </div>

        {safari.data && (
          <p className="center__body">
            {safari.data.energy.current < safari.data.energyCost
              ? t('safari.noEnergy')
              : t('safari.exploreCost', { n: safari.data.energyCost })}
          </p>
        )}
      </main>
    </Screen>
  )
}

function Stage({ phase, busy, onFight }: { phase: Phase; busy: boolean; onFight: () => void }) {
  switch (phase.kind) {
    case 'event':
      return (
        <section className="stage stage--event">
          <img className="stage__mon" src={phase.opponent.sprite} alt="" width={96} height={96} />
          <h2>{phase.opponent.name}</h2>
          <p className="center__body">{phase.opponent.intro}</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onFight}>
            {t('safari.event.fight')}
          </button>
        </section>
      )
    case 'idle':
      return (
        <section className="stage stage--idle">
          <span className="stage__grass" aria-hidden="true" />
          <h2>{t('safari.idle.title')}</h2>
          <p className="center__body">{t('safari.idle.body')}</p>
        </section>
      )
    case 'nothing':
      return <section className="stage stage--idle"><p className="center__body">{t('safari.nothing')}</p></section>
    case 'fled':
      return <section className="stage stage--sad"><p>{t('safari.fled', { name: phase.name })}</p></section>
    case 'caught': {
      const c = phase.result.creature!
      return (
        <section className="stage stage--win">
          <img className="stage__mon" src={c.sprite} alt="" width={96} height={96} />
          <h2>{t('safari.caught', { name: c.displayName })}</h2>
          <p className="stage__reward num">{t('safari.reward', { n: phase.result.reward?.gold ?? 0 })}</p>
          {phase.result.newDexEntry && <span className="tag tag--level">{t('safari.newDex')}</span>}
          {phase.result.chain > 1 && <span className="tag">{t('safari.chain', { n: phase.result.chain })}</span>}
          {phase.result.areaCompleted && (
            <p className="stage__reward num" role="status">
              {t('safari.areaCompleted', {
                area: phase.result.areaCompleted.areaName,
                n: phase.result.areaCompleted.energy,
              })}
            </p>
          )}
        </section>
      )
    }
    case 'throwing':
      return (
        <section className="stage stage--throw">
          <span className="stage__ball" aria-hidden="true" data-shakes={phase.shakes} />
          <p aria-live="polite">{t(`safari.shakes.${Math.min(phase.shakes, 3)}`)}</p>
        </section>
      )
    case 'encounter': {
      const e = phase.encounter
      return (
        <section className="stage stage--wild">
          <img className="stage__mon" src={e.sprite} alt="" width={96} height={96} />
          <h2>{t('safari.appears', { name: e.speciesName })}</h2>
          <div className="stage__meta">
            <span className="num">{t('creature.level', { n: e.level })}</span>
            {e.types.map((ty) => (
              <span key={ty.id} className="chip" style={{ '--chip': ty.color } as React.CSSProperties}>{ty.name}</span>
            ))}
            {e.shiny && <span className="tag tag--level">✨</span>}
            <span className="tag">{t(`rarity.${e.rarity}`)}</span>
          </div>
          <div className="chanceBar">
            <span className="chanceBar__label">{t('safari.chance')}</span>
            <span className="bar bar--lg">
              <span className="bar__fill bar__fill--chance" style={{ width: `${e.probability * 100}%` }} />
            </span>
            <span className="chanceBar__value num">{percent(e.probability)}</span>
          </div>
          {e.chain > 1 && <p className="center__body num">{t('safari.chain', { n: e.chain })}</p>}
        </section>
      )
    }
  }
}

interface PickerOption { id: string; name: string; icon: string; category: string; quantity: number }

function Picker({ label, options, value, onChange, emptyLabel }: {
  label: string
  options: PickerOption[]
  value: string | null
  onChange: (id: any) => void
  emptyLabel?: string
}) {
  const selected = options.find((o) => o.id === value)
  return (
    <label className="picker">
      <span className="picker__label">{label}</span>
      <span className="picker__body">
        {selected && <ItemIcon src={selected.icon} category={selected.category} size={22} />}
        <select
          className="picker__select"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          {emptyLabel && <option value="">{emptyLabel}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name} ({o.quantity})</option>
          ))}
        </select>
      </span>
    </label>
  )
}

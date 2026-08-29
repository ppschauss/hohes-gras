import { useEffect, useRef, useState } from 'react'
import type { EncounterView, FindResult, ThrowResult } from '../lib/api'
import { t } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number, percent } from '../lib/format'
import { Screen } from '../ui/Screen'
import { Icon } from '../ui/Icon'
import { TrainerAvatar } from '../ui/TrainerAvatar'
import { ItemIcon } from '../ui/ItemIcon'

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'event'
      opponent: { name: string; title: string; kind: string; sprite: string; intro: string }
      wanderer: boolean
    }
  | { kind: 'find'; find: FindResult }
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
  // Der Lockduft gilt genau fuer die naechste Erkundung und wird dabei
  // verbraucht — deshalb steht er neben Ball und Beere, nicht in der Tasche.
  const [lureId, setLureId] = useState<string | null>(null)
  const [lureNote, setLureNote] = useState<string | null>(null)
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
  const lures = (bag.data?.items ?? []).filter((i) => i.category === 'lure' && i.quantity > 0)
  const jammers = (bag.data?.items ?? []).find((i) => i.id === 'rocket-bait')?.quantity ?? 0
  const charges = safari.data?.jammerCharges ?? 0
  const detectors = (bag.data?.items ?? []).find((i) => i.id === 'metal-detector')?.quantity ?? 0
  const detectorCharges = safari.data?.detectorCharges ?? 0
  const ballCount = balls.find((b) => b.id === ballId)?.quantity ?? 0

  const explore = () => {
    haptic.tap()
    void action.run(() => api.explore(ballId, berryId, lureId), (res) => {
      // Ohne Rueckmeldung sieht ein verbrauchter Lockduft aus wie einer, der
      // nichts getan hat — genau so ist es gemeldet worden.
      setLureNote(res.lure
        ? t('safari.lure.used', { name: res.lure.name, n: res.lure.left })
        : null)
      if (res.lure && res.lure.left === 0) setLureId(null)
      if (res.kind === 'encounter') {
        setPhase({ kind: 'encounter', encounter: res.encounter, legendary: res.legendary })
        if (res.legendary) haptic.success(); else haptic.select()
      } else if (res.kind === 'event') {
        setPhase({ kind: 'event', opponent: res.opponent, wanderer: res.wanderer })
        haptic.error()
      } else if (res.kind === 'find') {
        setPhase({ kind: 'find', find: res.find })
        // Der Fund liegt schon im Beutel; die Anzeige muss nachziehen.
        bag.reload()
        haptic.success()
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
          {lures.length > 0 && (
            <Picker
              className="picker--wide"
              label={t('safari.lure')}
              options={lures.map((b) => ({ id: b.id, name: b.name, icon: b.icon, category: b.category, quantity: b.quantity }))}
              value={lureId}
              onChange={setLureId}
              emptyLabel={t('safari.noLure')}
            />
          )}
        </div>

        {lureNote && <p className="notice notice--ok" role="status">{lureNote}</p>}
        {lureId && !lureNote && <p className="chain__hint">{t('safari.lure.armed')}</p>}

        {safari.data?.chain && (
          <section className="chain">
            <img className="chain__mon" src={safari.data.chain.sprite} alt="" width={40} height={40} />
            <span className="chain__text">
              <span className="chain__title">
                {t('safari.chain.title', {
                  name: safari.data.chain.speciesName,
                  n: safari.data.chain.streak,
                })}
              </span>
              <span className="chain__odds num">
                {/* Nur vergleichen, wenn es etwas zu vergleichen gibt: bei
                    Serie 1 stand hier "0,20 % statt 0,20 %" — eine Aussage
                    ohne Inhalt. */}
                {safari.data.chain.odds >= safari.data.chain.baseOdds * 1.5
                  ? t('safari.chain.odds', {
                      odds: oddsPercent(safari.data.chain.odds),
                      base: oddsPercent(safari.data.chain.baseOdds),
                    })
                  : t('safari.chain.oddsPlain', { odds: oddsPercent(safari.data.chain.odds) })}
              </span>
              <span className="bar">
                <span className="bar__fill bar__fill--xp"
                  style={{ width: `${Math.min(100, (safari.data.chain.streak / safari.data.chain.cap) * 100)}%` }} />
              </span>
              <span className="chain__hint">
                {/* Am Anfang ist die Zusage weit weg; dann hilft der naechste
                    Meilenstein mehr als die Endzahl. */}
                {safari.data.chain.streak >= safari.data.chain.cap
                  ? t('safari.chain.maxed')
                  : safari.data.chain.streak < safari.data.chain.plateau
                    ? t('safari.chain.milestone', {
                        n: safari.data.chain.plateau - safari.data.chain.streak,
                        odds: Math.round(safari.data.chain.plateauOdds * 100),
                      })
                    : t('safari.chain.toGo', { n: safari.data.chain.cap - safari.data.chain.streak })}
              </span>
            </span>
          </section>
        )}

        {(charges > 0 || jammers > 0) && (
          <div className="jammer">
            <span className="jammer__text">
              {charges > 0 ? t('safari.jammer.active', { n: charges }) : t('safari.jammer.idle')}
            </span>
            {jammers > 0 && (
              <button
                type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                onClick={() => { haptic.tap(); void action.run(() => api.useJammer(), () => { safari.reload(); haptic.success() }) }}
              >
                {t('safari.jammer.use', { n: jammers })}
              </button>
            )}
          </div>
        )}

        {/* Derselbe Streifen wie beim Stoersender: beide sind Geraete, die
            die naechsten Erkundungen vorherbestimmen. */}
        {(detectorCharges > 0 || detectors > 0) && (
          <div className="jammer">
            <span className="jammer__text">
              {detectorCharges > 0
                ? t('safari.detector.active', { n: detectorCharges })
                : t('safari.detector.idle')}
            </span>
            {detectors > 0 && (
              <button
                type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                onClick={() => { haptic.tap(); void action.run(() => api.useDetector(), () => { safari.reload(); haptic.success() }) }}
              >
                {t('safari.detector.use', { n: detectors })}
              </button>
            )}
          </div>
        )}

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
          <TrainerAvatar
            className="stage__mon" src={phase.opponent.sprite}
            name={phase.opponent.name} kind={phase.opponent.kind} size={96}
          />
          <h2>{phase.opponent.name}</h2>
          {/* Ein Streuner ist kein Ueberfall: die Zeile sagt, was einen
              erwartet, bevor man auf "Kampf" tippt. */}
          <p className="center__body">
            {phase.wanderer ? t('safari.wanderer.lead', { title: phase.opponent.title }) : null}
          </p>
          <p className="center__body">{phase.opponent.intro}</p>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onFight}>
            {t('safari.event.fight')}
          </button>
        </section>
      )
    case 'find': {
      const f = phase.find
      return (
        <section className="stage stage--win">
          {f.icon
            ? <img className="stage__mon" src={f.icon} alt="" width={72} height={72} />
            : <span className="stage__find" aria-hidden="true">💰</span>}
          <h2>{t('safari.find.title')}</h2>
          <p className="stage__reward num">
            {f.what === 'coins'
              ? t('safari.find.coins', { n: number(f.gold) })
              : t('safari.find.item', { n: f.quantity, name: f.name })}
          </p>
          {f.detectorLeft !== null && (
            <p className="center__body">{t('safari.detector.left', { n: f.detectorLeft })}</p>
          )}
        </section>
      )
    }
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
            {/* Ball vor dem Level: schon gefangen, der naechste ist ein
                Doppelter. Steht bewusst links davon — die Frage "brauche ich
                das noch" kommt vor der Frage "wie stark ist es". */}
            {e.caught && (
              <span className="stage__caught" title={t('safari.alreadyCaught')}>
                <Icon name="caught" size={15} />
                <span className="sr-only">{t('safari.alreadyCaught')}</span>
              </span>
            )}
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

function Picker({ label, options, value, onChange, emptyLabel, className }: {
  label: string
  options: PickerOption[]
  value: string | null
  onChange: (id: any) => void
  emptyLabel?: string
  className?: string
}) {
  const selected = options.find((o) => o.id === value)
  return (
    <div className={`picker${className ? ` ${className}` : ''}`}>
      <span className="picker__label" id={`picker-${label}`}>{label}</span>
      <span className="picker__body">
        {selected && <ItemIcon src={selected.icon} category={selected.category} size={22} />}
        <select
          className="picker__select"
          aria-labelledby={`picker-${label}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
          {emptyLabel && <option value="">{emptyLabel}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.name} ({o.quantity})</option>
          ))}
        </select>
      </span>
    </div>
  )
}

/**
 * Prozent mit so vielen Stellen, wie die Zahl braucht.
 *
 * 0,20 % und 0,21 % unterscheiden sich erst in der zweiten Stelle, 59 % und
 * 60 % gar nicht mehr sinnvoll. Eine feste Nachkommazahl macht die Anzeige
 * entweder unlesbar oder nichtssagend.
 */
function oddsPercent(value: number): string {
  const pct = value * 100
  const digits = pct < 1 ? 2 : pct < 10 ? 1 : 0
  return `${pct.toFixed(digits).replace('.', ',')} %`
}

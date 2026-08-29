import { useEffect, useRef, useState } from 'react'
import type { ArenaContext, BattleFighterView, BattleMoveView, BattleView, OpponentEntry } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { ItemIcon } from '../ui/ItemIcon'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { describeTurn, effectivenessLabel } from '../lib/battleLog'
import { Screen } from '../ui/Screen'
import { CenterState } from '../ui/States'

type Panel = 'main' | 'moves' | 'switch' | 'items'

export function BattleScreen({ onBack, onArena }: { onBack: () => void; onArena: () => void }) {
  const existing = useAsync(() => api.currentBattle(), [])
  const opponents = useAsync(() => api.opponents(), [])
  // Nur Medizin: Baelle fangen keine Trainerpokemon.
  const bag = useAsync(() => api.bag(), [])
  const action = useAction()
  const [battle, setBattle] = useState<BattleView | null>(null)
  /*
   * Der Arenastand, solange ein Durchlauf laeuft.
   *
   * Ohne ihn blieb der Bildschirm nach dem Sieg auf dem beendeten Kampf
   * stehen, zeigte die alten Gegner — und ein Angriff darauf lief in "es
   * laeuft gerade kein Kampf". Gemeldet, und zu Recht.
   */
  const [arena, setArena] = useState<ArenaContext | null>(null)
  const [panel, setPanel] = useState<Panel>('main')
  const [log, setLog] = useState<string[]>([])
  const logEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (existing.data?.battle && !battle) setBattle(existing.data.battle)
    if (existing.data) setArena(existing.data.arena)
  }, [existing.data, battle])

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }) }, [log])

  const medicine = (bag.data?.items ?? []).filter((i) => i.category === 'medicine' && i.quantity > 0)

  const apply = (view: BattleView & {
    arena?: ArenaContext | null
    arenaAdvance?: { healed: number; round: number | null }
    arenaDone?: { payout: { gold: number } | null }
  }) => {
    setBattle(view)
    if (view.arena !== undefined) setArena(view.arena)
    // Der Server hat schon weitergeschaltet — das Protokoll sagt es, damit der
    // Wechsel nicht wie ein Sprung wirkt.
    if (view.arenaAdvance) {
      setLog((prev) => [...prev, t('arena.advanced', { round: view.arenaAdvance!.round ?? 0 })])
    }
    if (view.arenaDone) setArena(null)
    setPanel('main')
    if (view.lastEvents.length) setLog((prev) => [...prev, ...describeTurn(view.lastEvents, view)].slice(-40))
    if (view.finished) haptic[view.winner === 0 ? 'success' : 'error']()
  }

  const challenge = (opponent: OpponentEntry) => {
    haptic.tap()
    setLog([])
    void action.run(() => api.startBattle(opponent.id), apply)
  }

  const act = (a: Parameters<typeof api.battleAction>[0]) => {
    haptic.tap()
    void action.run(() => api.battleAction(a), apply)
  }

  /** Weiter im Durchlauf: heilen, naechsten Gegner holen, Anzeige tauschen. */
  const nextRound = () => {
    haptic.tap()
    setLog([])
    void action.run(() => api.arenaNext(), (res) => {
      // Meldet der Server "fertig", ist der Durchlauf vorbei — dann raeumt
      // der Bildschirm seinen Stand auf, statt einen toten Knopf zu behalten.
      if (res.battle) {
        setBattle(res.battle as BattleView)
        setArena(res.arena.run
          ? { tier: res.arena.run.tier, round: res.arena.run.round, rounds: res.arena.rounds, wins: res.arena.run.wins }
          : null)
        setPanel('main')
      } else {
        setArena(null)
        onBack()
      }
    })
  }

  /*
   * Zurueck fuehrt dahin, wo man hergekommen ist.
   *
   * Aus einem Arenakampf war das bisher die Gebietsansicht — man stand auf der
   * Karte statt in der Arena und musste sich zurueckklicken. Gemeldet, und in
   * einem Durchlauf mit vier Kaempfen viermal aergerlich.
   */
  const leave = () => {
    setBattle(null); setLog([]); existing.reload(); opponents.reload()
    if (arena) onArena()
  }

  if (!battle) {
    return (
      <Screen eyebrow={opponents.data?.areaName ?? ''} title={t('area.trainers')} onBack={onBack}>
        <main className="content">
          {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
          {opponents.data?.gym && (
            <section className="section">
              <h2>{t('area.gym')}</h2>
              <OpponentCard entry={opponents.data.gym} busy={action.busy} onChallenge={challenge} />
            </section>
          )}
          <section className="section">
            <h2>{t('area.trainers')}</h2>
            {opponents.data?.trainers.length === 0
              ? <CenterState glyph="🕊️" title={t('soon.title')} body={t('area.trainers.hint')} />
              : <div className="stack">
                  {opponents.data?.trainers.map((o) => (
                    <OpponentCard key={o.id} entry={o} busy={action.busy} onChallenge={challenge} />
                  ))}
                </div>}
          </section>
        </main>
      </Screen>
    )
  }

  return (
    <Screen
      eyebrow={t('battle.vs', { name: battle.opponentName })}
      title={t('battle.title')}
      onBack={battle.finished ? leave : onBack}
      aside={<span className="num">{t('battle.turn', { n: battle.turn })}</span>}
    >
      <main className="content content--battle">
        <section className="arena">
          <FighterPanel fighter={battle.foe.active} party={battle.foe.party} foe />
          <FighterPanel fighter={battle.player.active} party={battle.player.party} />
        </section>

        <div className="battlelog" role="log" aria-live="polite">
          {log.length === 0
            ? <p className="battlelog__line battlelog__line--dim">{t('battle.turn', { n: battle.turn })}</p>
            : log.map((line, i) => <p key={i} className="battlelog__line">{line}</p>)}
          <div ref={logEnd} />
        </div>

        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {battle.finished
          ? <Result battle={battle} arena={arena} busy={action.busy} onNext={nextRound} onLeave={leave} />
          : panel === 'main'
            ? <div className="battleActions">
                <button type="button" className="btn btn--primary" disabled={action.busy}
                  onClick={() => { haptic.tap(); setPanel('moves') }}>{t('battle.fight')}</button>
                <button type="button" className="btn btn--ghost" disabled={action.busy}
                  onClick={() => { haptic.tap(); setPanel('switch') }}>{t('battle.switch')}</button>
                <button type="button" className="btn btn--ghost" disabled={action.busy || medicine.length === 0}
                  onClick={() => { haptic.tap(); setPanel('items') }}>{t('battle.item')}</button>
                <button type="button" className="btn btn--ghost" disabled={action.busy}
                  onClick={() => act({ kind: 'forfeit' })}>{t('battle.run')}</button>
              </div>
            : panel === 'moves'
              ? <MovePanel moves={battle.player.moves} busy={action.busy}
                  onPick={(i) => act({ kind: 'move', moveIndex: i })}
                  onCancel={() => setPanel('main')} />
              : panel === 'switch'
                ? <SwitchPanel party={battle.player.party} activeId={battle.player.active.id} busy={action.busy}
                    onPick={(i) => act({ kind: 'switch', partyIndex: i })}
                    onCancel={() => setPanel('main')} />
                : <ItemPanel
                    items={medicine} party={battle.player.party}
                    activeIndex={battle.player.party.findIndex((p) => p.id === battle.player.active.id)}
                    busy={action.busy}
                    onUse={(itemId, targetIndex) => { bag.reload(); act({ kind: 'item', itemId, targetIndex }) }}
                    onCancel={() => setPanel('main')} />}
      </main>
    </Screen>
  )
}

function OpponentCard({ entry, busy, onChallenge }: {
  entry: OpponentEntry; busy: boolean; onChallenge: (o: OpponentEntry) => void
}) {
  return (
    <article className={`opponent${entry.isGym ? ' opponent--gym' : ''}`}>
      <span className="opponent__text">
        <span className="opponent__head">
          <span className="opponent__name">{entry.name}</span>
          {entry.badgeEarned && <span className="tag tag--done">{t('battle.badgeEarned')}</span>}
          {!entry.isGym && entry.wins > 0 && <span className="tag">{t('battle.wins', { n: entry.wins })}</span>}
        </span>
        <span className="opponent__title">{entry.title}</span>
        <span className="opponent__meta num">{t('battle.team', { n: entry.teamSize, level: entry.maxLevel })}</span>
        <span className="opponent__intro">„{entry.intro}"</span>
      </span>
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onChallenge(entry)}>
        {entry.defeated ? t('battle.rematch') : t('battle.challenge')}
      </button>
    </article>
  )
}

function FighterPanel({ fighter, party, foe = false }: {
  fighter: BattleFighterView; party: BattleFighterView[]; foe?: boolean
}) {
  const hpPercent = fighter.hpMax > 0 ? (fighter.hp / fighter.hpMax) * 100 : 0
  const tone = hpPercent > 50 ? 'ok' : hpPercent > 20 ? 'warn' : 'danger'

  return (
    <div className={`fighter${foe ? ' fighter--foe' : ''}`}>
      <div className="fighter__info">
        <span className="fighter__head">
          <span className="fighter__name">{fighter.name}</span>
          <span className="fighter__level num">{t('creature.level', { n: fighter.level })}</span>
        </span>
        <span className="bar bar--lg">
          <span className={`bar__fill bar__fill--${tone}`} style={{ width: `${hpPercent}%` }} />
        </span>
        <span className="fighter__stats num">
          {!foe && `${fighter.hp}/${fighter.hpMax}`}
          {fighter.status !== 'none' && <span className="tag tag--status">{t(`status.${fighter.status}`)}</span>}
          {fighter.confused && <span className="tag tag--status">{t('log.confused', { name: '' }).trim()}</span>}
        </span>
        <span className="fighter__dots">
          {party.map((p) => (
            <span key={p.id} className={`dot${p.fainted ? ' dot--out' : ''}${p.id === fighter.id ? ' dot--active' : ''}`} />
          ))}
        </span>
      </div>
      <img className="fighter__sprite" src={fighter.sprite} alt="" width={80} height={80} />
    </div>
  )
}

function MovePanel({ moves, busy, onPick, onCancel }: {
  moves: BattleMoveView[]; busy: boolean; onPick: (i: number) => void; onCancel: () => void
}) {
  return (
    <div className="movePanel">
      <div className="moveGrid">
        {moves.map((m) => {
          const eff = effectivenessLabel(m.effectiveness)
          return (
            <button key={m.index} type="button" className="moveBtn"
              disabled={busy || m.pp <= 0} onClick={() => onPick(m.index)}
              style={{ '--chip': m.typeColor } as React.CSSProperties}>
              <span className="moveBtn__name">{m.name}</span>
              <span className="moveBtn__meta num">{t('battle.pp', { pp: m.pp, max: m.ppMax })}</span>
              {eff && <span className={`moveBtn__eff moveBtn__eff--${m.effectiveness > 1 ? 'good' : 'bad'}`}>{eff}</span>}
            </button>
          )
        })}
      </div>
      <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>{t('battle.back')}</button>
    </div>
  )
}

function SwitchPanel({ party, activeId, busy, onPick, onCancel }: {
  party: BattleFighterView[]; activeId: string; busy: boolean; onPick: (i: number) => void; onCancel: () => void
}) {
  return (
    <div className="movePanel">
      <span className="section__eyebrow">{t('battle.chooseSwitch')}</span>
      <div className="picks">
        {party.map((p, index) => (
          <button key={p.id} type="button" className="pick"
            disabled={busy || p.fainted || p.id === activeId} onClick={() => onPick(index)}>
            <img src={p.sprite} alt="" width={40} height={40} className="pick__mon" />
            <span className="pick__name">{p.name}</span>
            <span className="pick__meta num">{p.fainted ? t('battle.fainted') : `${p.hp}/${p.hpMax}`}</span>
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>{t('battle.back')}</button>
    </div>
  )
}

function Result({ battle, arena, busy, onNext, onLeave }: {
  battle: BattleView
  arena: ArenaContext | null
  busy: boolean
  onNext: () => void
  onLeave: () => void
}) {
  const won = battle.winner === 0
  const r = battle.reward
  return (
    <section className={`result${won ? ' result--win' : ''}`}>
      <h2>{battle.winner === null ? t('battle.draw') : won ? t('battle.won') : t('battle.lost')}</h2>
      {r?.dialogue && <p className="result__dialogue">„{r.dialogue}"</p>}
      {r?.badge && <p className="result__badge">{t('battle.reward.badge', { name: r.badge.name })}</p>}
      {r && r.gold > 0 && <p className="num">{t('battle.reward.gold', { n: r.gold })}</p>}
      {/* Die Energie stand in der Antwort, aber nie auf dem Bildschirm: nach
          dem ersten Orden kamen 60 Punkte an, und gemeldet wurde, es seien
          keine gekommen. */}
      {r && r.energy > 0 && <p className="num">{t('battle.reward.energy', { n: r.energy })}</p>}
      {r && r.xpPerMember > 0 && <p className="num">{t('battle.reward.xp', { n: r.xpPerMember })}</p>}
      {r?.levelUps.map((l) => (
        <span key={l.creatureId} className="tag tag--level">{l.name} → {t('creature.level', { n: l.newLevel })}</span>
      ))}
      {/* Im Durchlauf geht es hier weiter — sonst steht man vor einem
          beendeten Kampf und dem Nichts. */}
      {arena && won && (
        <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={onNext}>
          {arena.wins + 1 >= arena.rounds
            ? t('arena.finish')
            : t('arena.nextFoe', { round: arena.round + 1, max: arena.rounds })}
        </button>
      )}
      <button
        type="button"
        className={`btn btn--block ${arena && won ? 'btn--ghost' : 'btn--primary'}`}
        onClick={onLeave}
      >
        {t('battle.back')}
      </button>
    </section>
  )
}

/**
 * Gegenstände mitten im Kampf.
 *
 * Erst das Mittel, dann das Ziel — auch ein besiegtes Mitglied lässt sich
 * wählen, dafür gibt es Beleber. Der Einsatz kostet den Zug; das steht
 * darunter, damit niemand ihn für geschenkt hält.
 */
function ItemPanel({ items, party, activeIndex, busy, onUse, onCancel }: {
  items: Array<{ id: string; name: string; icon: string; category: string; quantity: number }>
  party: BattleFighterView[]
  activeIndex: number
  busy: boolean
  onUse: (itemId: string, targetIndex: number) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)

  if (picked) {
    return (
      <div className="panel">
        <span className="panel__head">{t('battle.item.target')}</span>
        <div className="switchList">
          {party.map((p, index) => (
            <button key={p.id} type="button" className="switchRow" disabled={busy}
              onClick={() => onUse(picked, index)}>
              <img src={p.sprite} alt="" width={40} height={40} />
              <span className="switchRow__text">
                <span className="switchRow__name">
                  {p.name}
                  {index === activeIndex && <span className="tag tag--active">{t('battle.active')}</span>}
                </span>
                <span className="switchRow__hp num">{p.hp}/{p.hpMax} KP</span>
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--block" onClick={() => setPicked(null)}>
          {t('app.back')}
        </button>
      </div>
    )
  }

  return (
    <div className="panel">
      <span className="panel__head">{t('battle.item')}</span>
      <div className="switchList">
        {items.map((i) => (
          <button key={i.id} type="button" className="switchRow" disabled={busy}
            onClick={() => { haptic.tap(); setPicked(i.id) }}>
            <ItemIcon src={i.icon} category={i.category} size={32} />
            <span className="switchRow__text">
              <span className="switchRow__name">{i.name}</span>
              <span className="switchRow__hp num">×{i.quantity}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="panel__hint">{t('battle.item.costsTurn')}</p>
      <button type="button" className="btn btn--ghost btn--block" onClick={onCancel}>{t('app.back')}</button>
    </div>
  )
}

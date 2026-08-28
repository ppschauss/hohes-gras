import { useEffect, useState } from 'react'
import type { PlotView, PlotsState } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'

/**
 * Poké-Beet.
 *
 * Vier Beete nebeneinander, jedes in genau einem von drei Zuständen: leer,
 * am Wachsen, erntereif. Der Zustand bestimmt, was die Karte zeigt — es gibt
 * keinen Bildschirm, auf dem man erst suchen müsste, was zu tun ist.
 */
const format = (n: number): string => new Intl.NumberFormat('de-DE').format(n)

export function PlotsScreen({ onBack }: { onBack: () => void }) {
  const plots = useAsync(() => api.plots(), [])
  const action = useAction()
  const [harvest, setHarvest] = useState<{ name: string; staked: number; received: number; bonus: number } | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const d = plots.data
  if (plots.loading && !d) {
    return <main className="content">{[0, 1].map((i) => <div key={i} className="skeleton skeleton--row" />)}</main>
  }

  return (
    <Screen
      eyebrow={t('plots.eyebrow')}
      title={t('plots.title')}
      onBack={onBack}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {harvest && (
          <p className="notice notice--ok" role="status">
            {t('plots.harvested', {
              name: harvest.name, staked: format(harvest.staked),
              received: format(harvest.received), bonus: harvest.bonus,
            })}
          </p>
        )}

        <section className="explain">
          <h3>{t('plots.explain.title')}</h3>
          <p>{t('plots.explain.body', { time: duration(d?.growthMinutes ?? 0) })}</p>
        </section>

        <div className="stack">
          {d?.plots.map((plot) => (
            <PlotCard
              key={plot.slot}
              plot={plot}
              data={d}
              busy={action.busy}
              onPlant={(body) => {
                haptic.tap()
                void action.run(() => api.plant(body), (next) => { plots.set(next); setHarvest(null) })
              }}
              onTend={() => {
                haptic.tap()
                void action.run(() => api.tendPlot(plot.slot), (res) => { plots.set(res.state); haptic.success() })
              }}
              onHarvest={() => {
                haptic.tap()
                void action.run(() => api.harvestPlot(plot.slot), (res) => {
                  plots.set(res.state)
                  setHarvest({ name: res.name, staked: res.staked, received: res.received, bonus: res.bonusPercent })
                  haptic.success()
                })
              }}
              onTender={(tenderId) => {
                haptic.select()
                void action.run(() => api.setPlotTender(plot.slot, tenderId), (next) => plots.set(next))
              }}
            />
          ))}
        </div>
      </main>
    </Screen>
  )
}

interface CardProps {
  plot: PlotView
  data: PlotsState
  busy: boolean
  onPlant: (body: { slot: number; kind: 'item' | 'gold'; itemId?: string; amount: number; tenderId?: string | null }) => void
  onTend: () => void
  onHarvest: () => void
  onTender: (tenderId: string | null) => void
}

function PlotCard({ plot, data, busy, onPlant, onTend, onHarvest, onTender }: CardProps) {
  if (!plot.stake) return <EmptyPlot plot={plot} data={data} busy={busy} onPlant={onPlant} />

  const remaining = Math.max(0, (plot.readyAt ?? 0) - Date.now())
  const grown = plot.plantedAt && plot.readyAt
    ? Math.min(100, Math.round(((Date.now() - plot.plantedAt) / (plot.readyAt - plot.plantedAt)) * 100))
    : 0

  return (
    <article className={`plot${plot.ready ? ' plot--ready' : ''}`}>
      <header className="plot__head">
        <span className="plot__stake">
          {plot.stake.kind === 'gold'
            ? <span aria-hidden="true">🪙</span>
            : plot.stake.icon && <img src={plot.stake.icon} alt="" width={24} height={24} />}
          <span className="plot__name">{format(plot.stake.amount)}× {plot.stake.name}</span>
        </span>
        <span className="tag tag--count">+{plot.bonusPercent} %</span>
      </header>

      <div className="plot__bar" aria-hidden="true">
        <span className="plot__fill" style={{ width: `${grown}%` }} />
      </div>

      <p className="plot__meta num">
        {plot.ready
          ? t('plots.ready', { n: format(plot.payout) })
          : t('plots.growing', { time: clock(remaining), n: format(plot.payout) })}
      </p>

      {plot.tender ? (
        <div className="plot__tender">
          <img src={plot.tender.sprite} alt="" width={32} height={32} />
          <span className="plot__tenderText">
            {t('plots.tendedBy', { name: plot.tender.displayName, level: plot.tender.level })}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onTender(null)}>
            {t('plots.tender.remove')}
          </button>
        </div>
      ) : (
        <TenderPicker data={data} busy={busy} onPick={onTender} />
      )}

      <div className="rowActions">
        {plot.ready ? (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onHarvest}>
            {t('plots.harvest')}
          </button>
        ) : plot.tender ? (
          <p className="plot__hint">{t('plots.autoHint')}</p>
        ) : plot.phasesPending > 0 ? (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={onTend}>
            {t(`plots.action.${plot.nextPhaseKind ?? 'weed'}`)} · {t('plots.cost', { n: data.tendCost })}
          </button>
        ) : (
          <p className="plot__hint">
            {plot.phasesDone >= plot.phasesTotal
              ? t('plots.allTended')
              : t('plots.nextIn', { time: clock(Math.max(0, (plot.nextPhaseAt ?? 0) - Date.now())) })}
          </p>
        )}
        <span className="plot__phases num">{plot.phasesDone}/{plot.phasesTotal}</span>
      </div>
    </article>
  )
}

/**
 * Ein leeres Beet.
 *
 * Eingeklappt, bis man es antippt: vier gleichzeitig geoeffnete Formulare
 * waeren eine Wand aus Auswahlfeldern, durch die man erst scrollen muesste, um
 * das eine Beet zu finden, das gerade erntereif ist.
 */
function EmptyPlot({ plot, data, busy, onPlant }: Omit<CardProps, 'onTend' | 'onHarvest' | 'onTender'>) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'item' | 'gold'>('item')
  const [itemId, setItemId] = useState(data.plantable[0]?.itemId ?? '')

  const chosen = data.plantable.find((p) => p.itemId === itemId)
  const max = kind === 'gold' ? Math.min(data.maxGold, data.gold) : Math.min(data.maxItems, chosen?.have ?? 0)

  // Die Vorgabe darf nie ueber dem Maximum liegen: sonst steht da eine Zahl,
  // die der Knopf stumm ablehnt.
  const [amount, setAmount] = useState(Math.min(5, max))
  useEffect(() => { setAmount((a) => Math.min(Math.max(1, a), Math.max(1, max))) }, [max])

  const valid = amount >= 1 && amount <= max
    && (kind === 'gold' ? data.goldReady : Boolean(itemId))

  if (!open) {
    return (
      <article className="plot plot--empty plot--collapsed">
        <span className="plot__hint">{t('plots.empty', { n: plot.slot + 1 })}</span>
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => { haptic.tap(); setOpen(true) }}>
          {t('plots.open')}
        </button>
      </article>
    )
  }

  return (
    <article className="plot plot--empty">
      <header className="plot__head">
        <span className="plot__hint">{t('plots.empty', { n: plot.slot + 1 })}</span>
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => { haptic.tap(); setOpen(false) }}>
          {t('plots.cancel')}
        </button>
      </header>

      <div className="segmented" role="tablist">
        {(['item', 'gold'] as const).map((id) => {
          const locked = id === 'gold' && !data.goldReady
          return (
            <button key={id} type="button" role="tab" aria-selected={kind === id}
              className="segmented__btn"
              disabled={locked}
              title={locked ? t('plots.gold.locked', { time: clock(Math.max(0, (data.goldReadyAt ?? 0) - Date.now())) }) : undefined}
              onClick={() => { haptic.select(); setKind(id) }}>
              {t(`plots.kind.${id}`)}
            </button>
          )
        })}
      </div>

      {kind === 'gold' && (
        <p className="plot__hint">
          {data.goldReady
            ? t('plots.gold.hint', { max: format(data.maxGold), hours: data.goldCooldownHours })
            : t('plots.gold.locked', { time: clock(Math.max(0, (data.goldReadyAt ?? 0) - Date.now())) })}
        </p>
      )}

      {kind === 'item' && (
        data.plantable.length === 0
          ? <p className="plot__hint">{t('plots.nothingPlantable')}</p>
          : (
            <select
              className="field field--inline field--text"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              aria-label={t('plots.chooseItem')}
            >
              {data.plantable.map((p) => (
                <option key={p.itemId} value={p.itemId}>{p.name} ({p.have})</option>
              ))}
            </select>
          )
      )}

      <label className="plot__amount">
        <span className="plot__hint">{t('plots.amount', { max: format(max) })}</span>
        <input
          className="field field--inline"
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </label>

      <button
        type="button"
        className="btn btn--primary btn--block"
        disabled={busy || !valid || max < 1}
        onClick={() => {
          onPlant({ slot: plot.slot, kind, itemId: kind === 'item' ? itemId : undefined, amount })
          setOpen(false)
        }}
      >
        {max < 1 ? t('plots.nothingToPlant') : t('plots.plant')}
      </button>
    </article>
  )
}

function TenderPicker({ data, busy, onPick }: { data: PlotsState; busy: boolean; onPick: (id: string) => void }) {
  const free = data.tenders.filter((x) => !x.busy)
  if (free.length === 0) {
    return <p className="plot__hint">{t('plots.noTenders')}</p>
  }
  return (
    <div className="plot__tenderPick">
      <span className="plot__hint">{t('plots.tender.assign')}</span>
      <select
        className="field field--inline field--text"
        defaultValue=""
        disabled={busy}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        aria-label={t('plots.tender.assign')}
      >
        <option value="">—</option>
        {free.map((x) => (
          <option key={x.id} value={x.id}>
            {x.displayName} · Lv {x.level} · +{x.bonusPercent} %
          </option>
        ))}
      </select>
    </div>
  )
}

/** "4 Stunden" statt "240 Minuten" — dieselbe Zahl, halb so viel Rechnen. */
function duration(minutes: number): string {
  if (minutes < 60) return t('plots.minutes', { n: minutes })
  const hours = minutes / 60
  return t('plots.hours', { n: Number.isInteger(hours) ? hours : hours.toFixed(1) })
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')} h` : `${m}:${String(s).padStart(2, '0')}`
}

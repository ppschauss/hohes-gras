import { useState } from 'react'
import type { CollectResult } from '../lib/api'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { untilLabel, number } from '../lib/format'
import { Screen } from '../ui/Screen'
import { CenterState } from '../ui/States'
import { ItemIcon } from '../ui/ItemIcon'

export function ExpeditionScreen({ onBack }: { onBack: () => void }) {
  const overview = useAsync(() => api.expeditions(), [])
  const action = useAction()
  const [kind, setKind] = useState('forage')
  const [duration, setDuration] = useState('short')
  const [party, setParty] = useState<string[]>([])
  const [harvest, setHarvest] = useState<CollectResult | null>(null)

  const data = overview.data
  const maxParty = data?.partyRange.max ?? 3
  const selected = data?.durations.find((d) => d.id === duration)
  const cost = selected?.energyCost ?? 0
  const trainerCost = selected?.trainerEnergyCost ?? 0

  const toggle = (id: string) => {
    haptic.select()
    setParty((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id)
        : prev.length >= maxParty ? prev
        : [...prev, id])
  }

  const start = () => {
    haptic.tap()
    void action.run(() => api.startExpedition(kind, duration, party), (res) => {
      overview.set(res.overview)
      setParty([])
      haptic.success()
    })
  }

  const rush = (id: string) => {
    haptic.tap()
    void action.run(() => api.rushExpedition(id), (res) => { data.set(res.overview); haptic.success() })
  }

  const collect = (id: string) => {
    haptic.tap()
    void action.run(() => api.collectExpedition(id), (res) => {
      overview.set(res.overview)
      setHarvest(res.result)
      haptic.success()
    })
  }

  // Gleichzeitige Expeditionen sind unbegrenzt; was bremst, ist Energie und
  // dass jedes Pokemon nur an einer Stelle gleichzeitig sein kann.
  const canStart = party.length >= (data?.partyRange.min ?? 1)
    && (data ? data.energy.current >= trainerCost : false)

  return (
    <Screen
      eyebrow={t('expedition.eyebrow')}
      title={t('expedition.title')}
      onBack={onBack}
      aside={data && <span className="num">{t('expedition.slots', { n: data.open.length })}</span>}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {harvest && (
          <section className="harvest">
            <h3>{t('expedition.collected')}</h3>
            <ul className="harvest__loot">
              {harvest.loot.map((l) => (
                <li key={l.itemId}>
                  <ItemIcon src={l.icon} category={l.category} size={24} />
                  <span>{l.name}</span>
                  <span className="num">×{l.quantity}</span>
                </li>
              ))}
            </ul>
            <p className="harvest__gold num">+{number(harvest.gold)} Gold · +{number(harvest.xpPerMember)} EP</p>
            {harvest.levelUps.map((l) => (
              <span key={l.creatureId} className="tag tag--level">{l.name} → {t('creature.level', { n: l.newLevel })}</span>
            ))}
          </section>
        )}

        {data && data.open.length > 0 && (
          <section className="section">
            <h2>{t('expedition.running')}</h2>
            <div className="stack">
              {data.open.map((e) => (
                <article key={e.id} className="expo">
                  <span className="expo__party">
                    {e.members.map((m) => (
                      <img key={m.id} src={m.sprite} alt="" width={34} height={34} className="expo__mon" />
                    ))}
                  </span>
                  <span className="expo__text">
                    <span className="expo__name">{t(e.kindName)}</span>
                    <span className="expo__meta">
                      {e.ready ? t('expedition.collect') : t('expedition.readyIn', { n: untilLabel(e.endsAt) })}
                    </span>
                  </span>
                  {/* Wer nicht warten will, zahlt mit Energie: zehn Minuten
                      je Punkt. Kein Verkauf von Fortschritt — die Energie
                      fuellt sich von selbst, sie fehlt nur beim Erkunden. */}
                  {e.ready
                    ? (
                      <button type="button" className="btn btn--primary btn--sm"
                        disabled={action.busy} onClick={() => collect(e.id)}>
                        {t('expedition.collect')}
                      </button>
                    )
                    : (
                      <button type="button" className="btn btn--ghost btn--sm"
                        disabled={action.busy} onClick={() => rush(e.id)}>
                        {t('expedition.rush', { n: e.rushCost })}
                      </button>
                    )}
                </article>
              ))}
            </div>
          </section>
        )}

        {data && data.open.length === 0 && !harvest && (
          <CenterState glyph="🧭" title={t('expedition.empty.title')} body={t('expedition.empty.body')} />
        )}

        <section className="section">
          <h2>{t('expedition.title')}</h2>

          <div className="segmented">
            {data?.kinds.map((k) => (
              <button key={k.id} type="button" className="segmented__btn"
                aria-pressed={kind === k.id} onClick={() => { haptic.select(); setKind(k.id) }}>
                {t(k.name)}
              </button>
            ))}
          </div>

          <div className="favoured">
            <span className="section__eyebrow">{t('expedition.favoured')}</span>
            <span className="favoured__chips">
              {data?.kinds.find((k) => k.id === kind)?.favouredTypes.map((ty) => (
                <span key={ty.id} className="chip" style={{ '--chip': ty.color } as React.CSSProperties}>{ty.name}</span>
              ))}
            </span>
          </div>

          <div className="segmented">
            {data?.durations.map((d) => (
              <button key={d.id} type="button" className="segmented__btn"
                aria-pressed={duration === d.id} onClick={() => { haptic.select(); setDuration(d.id) }}>
                {t(`expedition.duration.${d.id}`)}
              </button>
            ))}
          </div>
          <p className="center__body">
            {t('expedition.energyCost', { n: cost })} · {t('expedition.trainerCost', { n: trainerCost })}
          </p>

          <div>
            <span className="section__eyebrow">{t('expedition.chooseParty', { max: maxParty })}</span>
            {data && data.available.length === 0
              ? <p className="center__body">{t('expedition.noneAvailable')}</p>
              : <div className="picks">
                  {data?.available.map((c) => {
                    const chosen = party.includes(c.id)
                    const tooTired = c.energy < cost
                    return (
                      <button key={c.id} type="button"
                        className={`pick${chosen ? ' pick--on' : ''}`}
                        aria-pressed={chosen}
                        disabled={tooTired && !chosen}
                        onClick={() => toggle(c.id)}>
                        <img src={c.sprite} alt="" width={40} height={40} className="pick__mon" />
                        <span className="pick__name">{c.name}</span>
                        <span className="pick__meta num">
                          {t('creature.level', { n: c.level })} · ⚡{c.energy}
                        </span>
                      </button>
                    )
                  })}
                </div>}
          </div>

          <button type="button" className="btn btn--primary btn--block"
            disabled={!canStart || action.busy} onClick={start}>
            {t('expedition.start')}
          </button>
        </section>
      </main>
    </Screen>
  )
}

import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type BulkSalvageResult, type CreatureLike, type SalvageResult } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'
import { CreatureCard } from '../ui/CreatureCard'
import { MovesPanel } from '../ui/MovesPanel'
import { Screen } from '../ui/Screen'

export function BoxScreen({ onBack }: { onBack: () => void }) {
  const box = useAsync(() => api.box(), [])
  const garden = useAsync(() => api.garden(), [])
  const action = useAction()
  const [pending, setPending] = useState<string | null>(null)
  const [openMoves, setOpenMoves] = useState<string | null>(null)
  // Verwerten ist endgueltig — deshalb erst fragen, dann handeln.
  const [salvaging, setSalvaging] = useState<string | null>(null)
  const [salvaged, setSalvaged] = useState<SalvageResult | null>(null)
  /*
   * Sammelverwerten.
   *
   * `picking` schaltet die Auswahl frei, `picked` haelt sie. Getrennt, damit
   * die Box im Normalfall aussieht wie vorher — Haekchen an jeder Zeile waeren
   * fuer den haeufigen Fall (ein Pokemon ansehen) nur Rauschen.
   */
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [bulkAsk, setBulkAsk] = useState(false)
  const [bulkDone, setBulkDone] = useState<BulkSalvageResult | null>(null)
  const BULK_MAX = 50

  const salvage = (id: string) => {
    haptic.tap()
    void action.run(() => api.salvage(id), (res) => {
      setSalvaging(null)
      setSalvaged(res.result)
      reloadBoth()
      haptic.success()
    })
  }

  const movesAction = (id: string) => ({
    label: openMoves === id ? t('moves.close') : t('moves.edit'),
    onClick: () => setOpenMoves(openMoves === id ? null : id),
  })

  const team = garden.data?.team ?? []
  const capacity = garden.data?.teamCapacity ?? 5
  const teamFull = team.length >= capacity

  const reloadBoth = () => { box.reload(); garden.reload() }

  const toggle = (id: string) => {
    haptic.tap()
    setPicked((prev) => prev.includes(id)
      ? prev.filter((x) => x !== id)
      : prev.length >= BULK_MAX ? prev : [...prev, id])
  }

  const endPicking = () => { setPicking(false); setPicked([]); setBulkAsk(false) }

  const salvagePicked = () => {
    haptic.tap()
    void action.run(() => api.salvageMany(picked), (res) => {
      setBulkDone(res.bulk)
      setSalvaged(null)
      endPicking()
      reloadBoth()
      haptic.success()
    })
  }

  const move = (id: string, into: boolean) => {
    haptic.tap()
    setPending(id)
    const next = into
      ? [...team.map((c) => c.id), id]
      : team.map((c) => c.id).filter((x) => x !== id)
    void action.run(() => api.setTeam(next), () => { reloadBoth(); setPending(null) })
      .finally(() => setPending(null))
  }

  if ((box.loading && !box.data) || (garden.loading && !garden.data)) {
    return <main className="content">{[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)}</main>
  }

  const boxed = box.data?.creatures ?? []

  return (
    <Screen
      eyebrow={t('box.eyebrow')}
      title={t('box.title')}
      onBack={onBack}
      aside={
        <span className="num">
          {t('box.capacity', { n: box.data?.boxUsed ?? 0, max: box.data?.boxCapacity ?? 0 })}
        </span>
      }
    >
      <main className="content">
        {salvaged && (
          <p className="notice notice--ok" role="status">
            {t('souls.done', {
              name: salvaged.creatureName,
              list: salvaged.fragments.map((f) => `${f.name} (${f.quantity})`).join(', '),
            })}
          </p>
        )}
        {bulkDone && (
          <p className="notice notice--ok" role="status">
            {t('souls.doneBulk', {
              n: bulkDone.count,
              list: bulkDone.fragments.map((f) => `${f.name} (${f.quantity})`).join(', '),
            })}
          </p>
        )}
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        <section className="section">
          <h2>{t('box.inTeam')}</h2>
          <div className="stack">
            {team.map((c: CreatureLike) => (
              <div key={c.id}>
                <CreatureCard
                  creature={c}
                  onChanged={reloadBoth}
                  actions={[
                    movesAction(c.id),
                    {
                      label: t('box.removeFromTeam'),
                      onClick: () => move(c.id, false),
                      disabled: action.busy && pending === c.id,
                    },
                  ]}
                />
                {openMoves === c.id && <MovesPanel creatureId={c.id} />}
              </div>
            ))}
            {team.length === 0 && <p className="center__body">{t('garden.empty.body')}</p>}
          </div>
        </section>

        <section className="section">
          <div className="sectionHead">
            <h2>{t('box.title')}</h2>
            {boxed.length > 0 && (
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => (picking ? endPicking() : setPicking(true))}>
                {picking ? t('box.pick.cancel') : t('box.pick.start')}
              </button>
            )}
          </div>
          {boxed.length === 0
            ? <CenterState glyph="📦" title={t('box.empty.title')} body={t('box.empty.body')} />
            : <div className="stack">
                {boxed.map((c) => (
                  <div key={c.id}>
                    <div className={picking ? 'pickRow' : undefined}>
                    {picking && (
                      <button type="button" className="pickRow__box" role="checkbox"
                        aria-checked={picked.includes(c.id)}
                        aria-label={c.displayName}
                        disabled={!picked.includes(c.id) && picked.length >= BULK_MAX}
                        onClick={() => toggle(c.id)}>
                        {picked.includes(c.id) ? '✓' : ''}
                      </button>
                    )}
                    <CreatureCard
                      creature={c}
                      onChanged={reloadBoth}
                      actions={[
                        movesAction(c.id),
                        {
                          label: teamFull ? t('box.teamFull') : t('box.addToTeam'),
                          onClick: () => move(c.id, true),
                          disabled: teamFull || (action.busy && pending === c.id),
                        },
                        {
                          label: t('souls.salvage'),
                          onClick: () => setSalvaging(salvaging === c.id ? null : c.id),
                          disabled: action.busy,
                        },
                      ]}
                    />
                    </div>
                    {!picking && salvaging === c.id && (
                      <div className="evoAsk">
                        <span className="evoAsk__text">{t('souls.confirm', { name: c.displayName })}</span>
                        <span className="chain__hint">{t('souls.hint')}</span>
                        <span className="evoAsk__buttons">
                          <button type="button" className="btn btn--danger btn--sm" disabled={action.busy}
                            onClick={() => salvage(c.id)}>{t('app.yes')}</button>
                          <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                            onClick={() => setSalvaging(null)}>{t('app.no')}</button>
                        </span>
                      </div>
                    )}
                    {openMoves === c.id && <MovesPanel creatureId={c.id} />}
                  </div>
                ))}
              </div>}
          {picking && (
            <div className="pickBar">
              <span className="pickBar__count num">
                {t('box.pick.count', { n: picked.length, max: BULK_MAX })}
              </span>
              <span className="pickBar__actions">
                <button type="button" className="btn btn--ghost btn--sm"
                  disabled={boxed.length === 0}
                  onClick={() => setPicked(boxed.slice(0, BULK_MAX).map((c) => c.id))}>
                  {t('box.pick.all')}
                </button>
                <button type="button" className="btn btn--danger btn--sm"
                  disabled={picked.length === 0 || action.busy}
                  onClick={() => setBulkAsk(true)}>
                  {t('souls.salvage')}
                </button>
              </span>
            </div>
          )}

          {bulkAsk && (
            <div className="evoAsk">
              <span className="evoAsk__text">{t('souls.confirmBulk', { n: picked.length })}</span>
              <span className="chain__hint">{t('souls.hint')}</span>
              <span className="evoAsk__buttons">
                <button type="button" className="btn btn--danger btn--sm" disabled={action.busy}
                  onClick={salvagePicked}>{t('app.yes')}</button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                  onClick={() => setBulkAsk(false)}>{t('app.no')}</button>
              </span>
            </div>
          )}
        </section>
      </main>
    </Screen>
  )
}

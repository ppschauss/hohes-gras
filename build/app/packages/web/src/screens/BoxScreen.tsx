import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type CreatureLike, type SalvageResult } from '../lib/api'
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
      aside={<span className="num">{t('garden.inGarden', { n: team.length, max: capacity })}</span>}
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
          <h2>{t('box.title')}</h2>
          {boxed.length === 0
            ? <CenterState glyph="📦" title={t('box.empty.title')} body={t('box.empty.body')} />
            : <div className="stack">
                {boxed.map((c) => (
                  <div key={c.id}>
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
                    {salvaging === c.id && (
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
        </section>
      </main>
    </Screen>
  )
}

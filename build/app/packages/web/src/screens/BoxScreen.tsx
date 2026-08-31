import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type BulkSalvageResult, type CreatureLike, type SalvageResult } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { CenterState } from '../ui/States'
import { CreatureCard } from '../ui/CreatureCard'
import { SORT_KEYS, sortCreatures, type SortKey } from '../lib/sortCreatures'
import { MovesPanel } from '../ui/MovesPanel'
import { Screen } from '../ui/Screen'

/** Wo die zuletzt gewaehlte Sortierung liegt. */
const SORT_STORAGE = 'box.sort'

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
  /*
   * Die Sortierung ueberlebt den Besuch.
   *
   * Wer nach Level sortiert, um schwache Faenge zu verwerten, tut das nicht
   * einmal — und muesste die Auswahl sonst bei jedem Oeffnen neu treffen.
   */
  const [sort, setSort] = useState<{ key: SortKey; reversed: boolean }>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SORT_STORAGE) ?? 'null')
      if (raw && SORT_KEYS.includes(raw.key)) return { key: raw.key, reversed: Boolean(raw.reversed) }
    } catch { /* kaputter Eintrag ist kein Grund, die Box nicht zu zeigen */ }
    return { key: 'dex', reversed: false }
  })
  /*
   * Suchen statt scrollen.
   *
   * Eine ausgebaute Box fasst ueber zweitausend Pokemon; sortieren allein
   * findet darin kein bestimmtes. Gesucht wird ueber Spitznamen *und*
   * Artnamen — wer sein Pokemon umbenannt hat, sucht mal nach dem einen und
   * mal nach dem anderen.
   */
  const [query, setQuery] = useState('')
  const applySort = (next: { key: SortKey; reversed: boolean }) => {
    setSort(next)
    try { localStorage.setItem(SORT_STORAGE, JSON.stringify(next)) } catch { /* privater Modus */ }
  }

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

  const needle = query.trim().toLowerCase()
  const boxed = sortCreatures(box.data?.creatures ?? [], sort.key, sort.reversed)
    .filter((c) => needle === ''
      || c.displayName.toLowerCase().includes(needle)
      || c.speciesName.toLowerCase().includes(needle)
      || c.types.some((t) => t.name.toLowerCase().includes(needle)))

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
        {/* Der Vorteil der Box steht sonst nirgends: eingelagert erholen sie
            sich dreimal so schnell wie im Dienst. */}
        <p className="explain">{t('box.rest')}</p>

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

          {/* Das <select> steht bewusst nicht in einem <label>: in der
              Telegram-WebView zaehlt der Tipp dann doppelt und die Liste
              schliesst sich sofort wieder. */}
          {(box.data?.creatures.length ?? 0) > 1 && (
            <label className="picker__search">
              <span className="sr-only">{t('box.search')}</span>
              <input
                className="field field--inline field--text"
                type="search"
                placeholder={t('box.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          )}

          {boxed.length > 1 && (
            <div className="picker picker--wide">
              <span className="picker__label" id="box-sort">{t('box.sort')}</span>
              <span className="picker__body">
                <select
                  className="picker__select"
                  aria-labelledby="box-sort"
                  value={sort.key}
                  onChange={(e) => { haptic.select(); applySort({ key: e.target.value as SortKey, reversed: false }) }}
                >
                  {SORT_KEYS.map((k) => <option key={k} value={k}>{t(`box.sort.${k}`)}</option>)}
                </select>
                {/* Im Rahmen des Waehlers statt daneben: die Richtung gehoert
                    zur Sortierung, nicht zur Seite. */}
                <button
                  type="button"
                  className="picker__flip"
                  aria-label={t('box.sort.flip')}
                  title={t('box.sort.flip')}
                  onClick={() => { haptic.tap(); applySort({ ...sort, reversed: !sort.reversed }) }}
                >
                  {sort.reversed ? '↑' : '↓'}
                </button>
              </span>
            </div>
          )}
          {boxed.length === 0
            ? needle
              ? <CenterState glyph="🔍" title={t('box.noMatch.title')} body={t('box.noMatch.body', { q: query })} />
              : <CenterState glyph="📦" title={t('box.empty.title')} body={t('box.empty.body')} />
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
                      actions={picking ? [] : [
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
                {bulkAsk
                  ? t('souls.confirmBulk', { n: picked.length })
                  : t('box.pick.count', { n: picked.length, max: BULK_MAX })}
              </span>
              <span className="pickBar__actions">
                {bulkAsk ? (
                  <>
                    <button type="button" className="btn btn--danger btn--sm" disabled={action.busy}
                      onClick={salvagePicked}>{t('app.yes')}</button>
                    <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                      onClick={() => setBulkAsk(false)}>{t('app.no')}</button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </span>
            </div>
          )}
          {picking && bulkAsk && <p className="chain__hint">{t('souls.hint')}</p>}
        </section>
      </main>
    </Screen>
  )
}

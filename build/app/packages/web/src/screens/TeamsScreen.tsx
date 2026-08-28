import { useMemo, useState } from 'react'
import type { CreatureView, TeamView } from '@game/shared'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'
import { CenterState } from '../ui/States'

/**
 * Teamverwaltung.
 *
 * Ein Team ist eine gespeicherte Aufstellung; genau eines ist aktiv und steht
 * im Garten. Das Bearbeiten passiert direkt in der Karte statt in einem Dialog:
 * man sieht dabei die Aufstellung, die man gerade veraendert — der halbe Zweck
 * des Bildschirms.
 */
export function TeamsScreen({ onBack, onOpenBox }: { onBack: () => void; onOpenBox: () => void }) {
  const teams = useAsync(() => api.teams(), [])
  const action = useAction()
  const [editing, setEditing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [filter, setFilter] = useState('')

  const data = teams.data
  const busy = useMemo(() => new Set(data?.busyCreatureIds ?? []), [data])

  /** Alles, was dem Trainer gehoert: das aktive Team plus die Box. */
  const owned = useMemo<CreatureView[]>(() => {
    if (!data) return []
    const active = data.teams.find((x) => x.active)?.members ?? []
    const seen = new Set(active.map((c) => c.id))
    return [...active, ...data.box.filter((c) => !seen.has(c.id))]
  }, [data])

  const run = (fn: () => Promise<typeof data>) =>
    void action.run(fn, (next) => { if (next) teams.set(next) })

  if (teams.loading && !data) {
    return (
      <main className="content">{[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)}</main>
    )
  }

  if (!data) {
    return (
      <Screen eyebrow={t('teams.eyebrow')} title={t('teams.title')} onBack={onBack}>
        <CenterState glyph="⚠️" title={t('error.generic')} body={t('app.retryHint')}>
          <button type="button" className="btn btn--ghost" onClick={teams.reload}>{t('app.retry')}</button>
        </CenterState>
      </Screen>
    )
  }

  const canAddTeam = data.teams.length < data.maxTeams

  return (
    <Screen
      eyebrow={t('teams.eyebrow')}
      title={t('teams.title')}
      onBack={onBack}
      aside={<span className="num">{data.teams.length}/{data.maxTeams}</span>}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
        <p className="explain">{t('teams.explain')}</p>

        <div className="stack">
          {data.teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              capacity={data.capacity}
              busy={busy}
              owned={owned}
              editing={editing === team.id}
              renaming={renaming === team.id}
              draftName={draftName}
              filter={filter}
              actionBusy={action.busy}
              canDelete={data.teams.length > 1}
              onFilter={setFilter}
              onToggleEdit={() => {
                haptic.tap()
                setEditing(editing === team.id ? null : team.id)
                setFilter('')
              }}
              onStartRename={() => { setRenaming(team.id); setDraftName(team.name) }}
              onDraftName={setDraftName}
              onCancelRename={() => setRenaming(null)}
              onCommitRename={() => {
                const name = draftName.trim()
                setRenaming(null)
                if (name && name !== team.name) run(() => api.renameTeam(team.id, name))
              }}
              onActivate={() => { haptic.success(); run(() => api.activateTeam(team.id)) }}
              onDelete={() => { haptic.tap(); setEditing(null); run(() => api.deleteTeam(team.id)) }}
              onSetMembers={(ids) => run(() => api.setTeamMembers(team.id, ids))}
            />
          ))}
        </div>

        <div className="rowActions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canAddTeam || action.busy}
            onClick={() => {
              haptic.tap()
              run(() => api.createTeam(t('teams.defaultName', { n: data.teams.length + 1 })))
            }}
          >
            {canAddTeam ? t('teams.create') : t('teams.maxReached')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => { haptic.tap(); onOpenBox() }}>
            {t('teams.openBox')}
          </button>
        </div>
      </main>
    </Screen>
  )
}

interface CardProps {
  team: TeamView
  capacity: number
  busy: Set<string>
  owned: CreatureView[]
  editing: boolean
  renaming: boolean
  draftName: string
  filter: string
  actionBusy: boolean
  canDelete: boolean
  onFilter: (value: string) => void
  onToggleEdit: () => void
  onStartRename: () => void
  onDraftName: (value: string) => void
  onCancelRename: () => void
  onCommitRename: () => void
  onActivate: () => void
  onDelete: () => void
  onSetMembers: (ids: string[]) => void
}

function TeamCard(p: CardProps) {
  const memberIds = p.team.members.map((m) => m.id)
  const free = p.capacity - memberIds.length
  const available = p.owned.filter((c) => !memberIds.includes(c.id))
  const needle = p.filter.trim().toLowerCase()
  const shown = needle
    ? available.filter((c) => c.displayName.toLowerCase().includes(needle) || c.speciesName.toLowerCase().includes(needle))
    : available

  return (
    <article className={`teamcard${p.team.active ? ' teamcard--active' : ''}`}>
      <header className="teamcard__head">
        {p.renaming ? (
          <form
            className="teamcard__rename"
            onSubmit={(e) => { e.preventDefault(); p.onCommitRename() }}
          >
            <input
              className="field field--inline field--text"
              value={p.draftName}
              maxLength={24}
              autoFocus
              aria-label={t('teams.name')}
              onChange={(e) => p.onDraftName(e.target.value)}
              onBlur={p.onCommitRename}
            />
            <button type="submit" className="btn btn--sm btn--primary">{t('teams.save')}</button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={p.onCancelRename}>{t('teams.cancel')}</button>
          </form>
        ) : (
          <button type="button" className="teamcard__name" onClick={p.onStartRename}>
            {p.team.name}
            <span className="teamcard__pencil" aria-hidden="true">✎</span>
          </button>
        )}

        {p.team.active
          ? <span className="tag tag--active">{t('teams.active')}</span>
          : (
            <button type="button" className="btn btn--sm btn--primary" disabled={p.actionBusy} onClick={p.onActivate}>
              {t('teams.activate')}
            </button>
          )}
      </header>

      <ol className="slots" aria-label={t('teams.lineup')}>
        {Array.from({ length: p.capacity }, (_, i) => {
          const member = p.team.members[i]
          if (!member) {
            return <li key={`empty-${i}`} className="slot slot--empty" aria-label={t('teams.emptySlot')}>+</li>
          }
          return (
            <li key={member.id} className="slot">
              <button
                type="button"
                className="slot__btn"
                disabled={!p.editing || p.actionBusy}
                title={p.editing ? t('teams.removeMember', { name: member.displayName }) : member.displayName}
                onClick={() => p.onSetMembers(memberIds.filter((id) => id !== member.id))}
              >
                <img src={member.sprite} alt={member.displayName} width={44} height={44} loading="lazy" />
                <span className="slot__level num">{member.level}</span>
                {p.busy.has(member.id) && <span className="slot__away" title={t('teams.away')}>🧭</span>}
                {p.editing && <span className="slot__remove" aria-hidden="true">×</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <footer className="teamcard__foot">
        <button type="button" className="btn btn--sm btn--ghost" onClick={p.onToggleEdit}>
          {p.editing ? t('teams.done') : t('teams.edit')}
        </button>
        {p.editing && (
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={!p.canDelete || p.actionBusy}
            onClick={p.onDelete}
          >
            {t('teams.delete')}
          </button>
        )}
      </footer>

      {p.editing && (
        <section className="picker">
          <label className="picker__search">
            <span className="sr-only">{t('teams.search')}</span>
            <input
              className="field field--inline field--text"
              type="search"
              placeholder={t('teams.search')}
              value={p.filter}
              onChange={(e) => p.onFilter(e.target.value)}
            />
          </label>

          {shown.length === 0
            ? <p className="center__body">{t('teams.noneAvailable')}</p>
            : (
              <ul className="picker__list">
                {shown.slice(0, 60).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="picker__row"
                      disabled={free <= 0 || p.actionBusy}
                      onClick={() => p.onSetMembers([...memberIds, c.id])}
                    >
                      <img src={c.sprite} alt="" width={36} height={36} loading="lazy" />
                      <span className="picker__text">
                        <span className="picker__name">{c.displayName}</span>
                        <span className="picker__meta num">
                          {t('creature.level', { n: c.level })} · {t('creature.power')} {c.power}
                          {p.busy.has(c.id) ? ` · ${t('teams.away')}` : ''}
                        </span>
                      </span>
                      <span className="picker__add" aria-hidden="true">{free > 0 ? '+' : '–'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          {free <= 0 && <p className="explain">{t('teams.full')}</p>}
        </section>
      )}
    </article>
  )
}

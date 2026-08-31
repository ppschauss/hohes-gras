import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { SessionsPanel } from './SessionsPanel'

/** Data rights and, for admins, the operator view. Both live here because both
 *  are about the account rather than the game. */
export function DataPanel() {
  const state = useAsync(() => api.state(), [])
  const action = useAction()
  const [confirm, setConfirm] = useState('')
  const [deleted, setDeleted] = useState(false)

  const isAdmin = state.data?.trainer.isAdmin === true

  const download = () => {
    haptic.tap()
    // A real navigation rather than fetch: the server sets a filename and the
    // browser handles the save dialog.
    const token = sessionStorage.getItem('poke.session')
    if (!token) return
    void fetch(api.exportUrl(), { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'spielstand.json'
        a.click()
        URL.revokeObjectURL(url)
        haptic.success()
      })
      .catch(() => haptic.error())
  }

  const remove = () => {
    haptic.tap()
    void action.run(() => api.deleteAccount(confirm), () => { setDeleted(true); haptic.success() })
  }

  if (deleted) {
    return <p className="notice notice--ok">{t('data.deleted')}</p>
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

      <SessionsPanel />

      <section className="section">
        <h2>{t('data.title')}</h2>
        <p className="center__body">{t('data.exportHint')}</p>
        <button type="button" className="btn btn--ghost btn--block" onClick={download}>
          {t('data.export')}
        </button>
      </section>

      <section className="section dangerZone">
        <h2>{t('data.delete')}</h2>
        <p className="center__body">{t('data.deleteHint')}</p>
        <input className="field field--inline" value={confirm} maxLength={16}
          placeholder={t('data.deleteConfirm')}
          onChange={(e) => setConfirm(e.target.value)} />
        <button type="button" className="btn btn--danger btn--block"
          disabled={confirm.trim().toUpperCase() !== 'LÖSCHEN' || action.busy} onClick={remove}>
          {t('data.deleteButton')}
        </button>
      </section>

      {isAdmin && <AdminSection />}
    </>
  )
}

function AdminSection() {
  const admin = useAsync(() => api.admin(), [])
  const release = useAsync(() => api.release(), [])
  const action = useAction()

  const ban = (id: string, value: boolean) => {
    haptic.tap()
    void action.run(() => api.setBan(id, value), (next) => admin.set(next))
  }

  const d = admin.data
  if (!d) return null

  return (
    <>
      {/*
        * Der Stand dieser Installation.
        *
        * Der Knopf baut nichts: er legt eine Marke ab, die `./manage.sh watch`
        * auf dem Wirt aufgreift. Ein Container, der sich selbst neu bauen darf,
        * braeuchte den Docker-Socket — also Zugriff auf alles, was auf der
        * Maschine laeuft.
        */}
      {release.data && (
        <section className="section">
          <h2>{t('admin.release')}</h2>
          {release.data.latest === null
            ? (
              <p className="center__body num">
                {t('admin.release.current.only', { sha: release.data.current })}
                <br /><span className="recipe__req">{t('admin.release.unknown')}</span>
              </p>
            )
            : (
              <>
                <p className="center__body num">
                  {t('admin.release.current', { sha: release.data.current })}
                  {' · '}{t('admin.release.latest', { sha: release.data.latest })}
                </p>
                {release.data.notes && <p className="explain">{release.data.notes}</p>}
                {release.data.pending
                  ? <p className="notice notice--ok" role="status">{t('admin.release.pending')}</p>
                  : release.data.outdated
                    ? (
                      <>
                        <button type="button" className="btn btn--primary btn--block"
                          disabled={action.busy}
                          onClick={() => {
                            haptic.tap()
                            void action.run(() => api.requestUpdate(), (r) => { release.set(r); haptic.success() })
                          }}>
                          {t('admin.release.update')}
                        </button>
                        <p className="recipe__req">{t('admin.release.hint')}</p>
                      </>
                    )
                    : null}
              </>
            )}
        </section>
      )}

      <section className="section">
        <h2>{t('admin.title')}</h2>
        <p className="center__body num">
          {t('admin.pack', { name: d.content.pack, version: d.content.version, species: d.content.species })}
        </p>

        <div className="statGrid">
          <Stat label={t('admin.total')} value={d.trainers.total} />
          <Stat label={t('admin.activeToday')} value={d.trainers.activeToday} />
          <Stat label={t('admin.activeWeek')} value={d.trainers.activeWeek} />
          <Stat label={t('admin.banned')} value={d.trainers.banned} />
        </div>

        <span className="section__eyebrow">{t('admin.activity')}</span>
        <div className="statGrid">
          <Stat label={t('admin.creatures')} value={d.activity.creatures} />
          <Stat label={t('admin.shinies')} value={d.activity.shinies} />
          <Stat label={t('admin.battles')} value={d.activity.battles} />
          <Stat label={t('admin.duels')} value={d.activity.duels} />
          <Stat label={t('admin.raids')} value={d.activity.raids} />
          <Stat label={t('admin.guilds')} value={d.activity.guilds} />
          <Stat label={t('admin.sales')} value={d.activity.marketSales} />
          <Stat label={t('admin.gold')} value={d.activity.goldInCirculation} />
        </div>
      </section>

      <section className="section">
        <h2>{t('admin.recent')}</h2>
        <div className="stack">
          {d.recentTrainers.map((tr) => (
            <article key={tr.id} className="friend">
              <span className="friend__text">
                <span className="friend__name">
                  {tr.displayName}
                  {tr.isAdmin === 1 && <span className="tag tag--active">Admin</span>}
                  {tr.isBanned === 1 && <span className="tag tag--count">Gesperrt</span>}
                </span>
                <span className="friend__meta num">{tr.trainerCode} · 🪙 {number(tr.gold)}</span>
              </span>
              {tr.isAdmin !== 1 && (
                <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                  onClick={() => ban(tr.id, tr.isBanned !== 1)}>
                  {tr.isBanned === 1 ? t('admin.unban') : t('admin.ban')}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="statTile">
      <span className="statTile__value num">{number(value)}</span>
      <span className="statTile__label">{label}</span>
    </div>
  )
}

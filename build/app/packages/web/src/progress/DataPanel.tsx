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
  const action = useAction()

  const create = () => {
    haptic.tap()
    void action.run(() => api.createInvite(1, 30, ''), (res) => { admin.set(res.dashboard); haptic.success() })
  }
  const revoke = (code: string) => {
    haptic.tap()
    void action.run(() => api.revokeInvite(code), (next) => admin.set(next))
  }
  const ban = (id: string, value: boolean) => {
    haptic.tap()
    void action.run(() => api.setBan(id, value), (next) => admin.set(next))
  }

  const d = admin.data
  if (!d) return null

  return (
    <>
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
        <h2>{t('admin.invites')}</h2>
        <button type="button" className="btn btn--primary btn--block" disabled={action.busy} onClick={create}>
          {t('admin.newInvite')}
        </button>
        <div className="stack">
          {d.invites.filter((i) => !i.exhausted).map((i) => (
            <article key={i.code} className="friend">
              <span className="friend__text">
                <code className="codeCard__code">{i.code}</code>
                <span className="friend__meta num">{t('admin.uses', { used: i.uses, max: i.maxUses })}</span>
              </span>
              <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                onClick={() => revoke(i.code)}>{t('admin.revoke')}</button>
            </article>
          ))}
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

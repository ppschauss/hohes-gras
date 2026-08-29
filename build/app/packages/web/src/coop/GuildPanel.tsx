import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { CenterState } from '../ui/States'

export function GuildPanel() {
  const guild = useAsync(() => api.guild(), [])
  const action = useAction()
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [motto, setMotto] = useState('')
  const [claimed, setClaimed] = useState<number | null>(null)

  const d = guild.data

  const found = () => {
    haptic.tap()
    void action.run(() => api.foundGuild(name, tag, motto), (next) => { guild.set(next); haptic.success() })
  }
  const join = (id: string) => {
    haptic.tap()
    void action.run(() => api.joinGuild(id), (next) => { guild.set(next); haptic.success() })
  }
  const leave = () => {
    haptic.tap()
    void action.run(() => api.leaveGuild(), (next) => guild.set(next))
  }
  const claim = () => {
    haptic.tap()
    void action.run(() => api.claimGuildGoal(), (res) => {
      guild.set(res.guild); setClaimed(res.gold); haptic.success()
    })
  }

  if (action.error) {
    // Fehler wird unten neben dem jeweiligen Bereich gezeigt, nicht hier oben.
  }

  if (guild.loading && !d) return <div className="skeleton skeleton--journey" />

  if (!d?.guild) {
    return (
      <>
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
        <CenterState glyph="🛡️" title={t('guild.none.title')} body={t('guild.none.body')} />

        <section className="section">
          <h2>{t('guild.found')}</h2>
          <p className="center__body">{t('guild.foundCost', { n: d?.foundingCost ?? 0 })} · 🪙 {number(d?.gold ?? 0)}</p>
          <input className="field field--inline field--text" placeholder={t('guild.name')} maxLength={24}
            value={name} onChange={(e) => setName(e.target.value)} />
          <input className="field field--inline" placeholder={t('guild.tag')} maxLength={5}
            value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} />
          <input className="field field--inline field--text" placeholder={t('guild.motto')} maxLength={120}
            value={motto} onChange={(e) => setMotto(e.target.value)} />
          <button type="button" className="btn btn--primary btn--block"
            disabled={name.trim().length < 3 || tag.trim().length < 2 || action.busy || (d?.gold ?? 0) < (d?.foundingCost ?? 0)}
            onClick={found}>
            {t('guild.found')}
          </button>
        </section>

        {d && d.open.length > 0 && (
          <section className="section">
            <h2>{t('guild.open')}</h2>
            <div className="stack">
              {d.open.map((g) => (
                <article key={g.id} className="friend">
                  <span className="friend__text">
                    <span className="friend__name">[{g.tag}] {g.name}</span>
                    <span className="friend__meta">{g.motto || '—'}</span>
                    <span className="friend__meta num">{t('guild.members', { n: g.memberCount, max: d.maxMembers })}</span>
                  </span>
                  <button type="button" className="btn btn--primary btn--sm" disabled={action.busy}
                    onClick={() => join(g.id)}>{t('guild.join')}</button>
                </article>
              ))}
            </div>
          </section>
        )}
      </>
    )
  }

  const g = d.guild
  const goalPercent = g.goal.target > 0 ? Math.min(100, (g.goal.progress / g.goal.target) * 100) : 0

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {claimed !== null && <p className="notice notice--ok">{t('guild.goal.reward', { n: claimed })}</p>}

      <section className="guildHeader">
        <div>
          <span className="section__eyebrow">[{g.tag}] · {t(`guild.role.${g.role}`)}</span>
          <h2>{g.name}</h2>
          {g.motto && <p className="center__body">{g.motto}</p>}
        </div>
        <span className="num">🪙 {number(g.treasury)}</span>
      </section>

      <section className="goalCard">
        <span className="section__eyebrow">{t('guild.goal')}</span>
        <h3>{t(g.goal.labelKey, { target: number(g.goal.target) })}</h3>
        <div className="bar bar--lg">
          <span className="bar__fill bar__fill--dex" style={{ width: `${goalPercent}%` }} />
        </div>
        <p className="num">{number(g.goal.progress)} / {number(g.goal.target)}</p>
        {/* Ohne diese Zeile sieht das Soll aus wie eine feste Zahl — und war
            es frueher auch: 800 Pflegeaktionen fuer eine Gilde aus zwei. */}
        <p className="center__body">{t('guild.goal.scaled', { perMember: number(g.goal.perMember) })}</p>
        <p className="center__body">{t('guild.goal.reward', { n: g.goal.rewardPerMember })}</p>
        <button type="button" className="btn btn--primary btn--block"
          disabled={!g.goal.complete || g.goal.claimed || action.busy} onClick={claim}>
          {g.goal.claimed ? t('guild.claimed') : t('guild.claim')}
        </button>
      </section>

      {!g.chatBound && <p className="explain">{t('guild.chatHint')}</p>}

      <section className="section">
        <h2>{t('guild.members', { n: g.memberCount, max: g.maxMembers })}</h2>
        <div className="stack">
          {g.members.map((m) => (
            <article key={m.trainerId} className="friend">
              <span className="friend__text">
                <span className="friend__name">{m.displayName}</span>
                <span className="friend__meta num">
                  {t(`guild.role.${m.role}`)} · {t('guild.contribution', { n: number(m.contribution) })}
                </span>
              </span>
            </article>
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--block" disabled={action.busy} onClick={leave}>
          {t('guild.leave')}
        </button>
      </section>
    </>
  )
}

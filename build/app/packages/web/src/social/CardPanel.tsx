import { useState } from 'react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'

export function CardPanel() {
  const card = useAsync(() => api.myCard(), [])
  const state = useAsync(() => api.state(), [])
  const action = useAction()
  const [copied, setCopied] = useState(false)

  const d = card.data
  const privacy = state.data?.trainer.privacy

  const asText = (): string => {
    if (!d) return ''
    return [
      d.displayName,
      `Trainer-Code: ${d.trainerCode}`,
      `Orden: ${d.badges.map((b) => b.name).join(', ') || '—'}`,
      `Pokédex: ${d.dexCaught}/${d.dexTotal}`,
      `Siege: ${d.battlesWon} · Schillernde: ${d.shinies} · Höchstes Level: ${d.highestLevel}`,
      `Team: ${d.teamPreview.map((m) => `${m.name} Lv${m.level}`).join(', ') || '—'}`,
    ].join('\n')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText())
      setCopied(true); haptic.success()
      setTimeout(() => setCopied(false), 1800)
    } catch { setCopied(false) }
  }

  const toggle = (key: string, value: boolean) => {
    haptic.select()
    void action.run(() => api.setPrivacy({ [key]: value }), () => state.reload())
  }

  return (
    <>
      {d && (
        <section className="trainerCard">
          <div className="trainerCard__head">
            <div>
              <h2>{d.displayName}</h2>
              <span className="section__eyebrow num">
                {d.rank ? t('card.rank', { n: d.rank }) : t('card.noRank')} · {number(d.score)}
              </span>
            </div>
            <code className="codeCard__code">{d.trainerCode}</code>
          </div>

          <div className="statGrid">
            <Stat label={t('card.stats.dex')} value={`${d.dexCaught}/${d.dexTotal}`} />
            <Stat label={t('card.stats.wins')} value={String(d.battlesWon)} />
            <Stat label={t('card.stats.shinies')} value={String(d.shinies)} />
            <Stat label={t('card.stats.top')} value={String(d.highestLevel)} />
          </div>

          <div>
            <span className="section__eyebrow">{t('card.badges')}</span>
            {d.badges.length === 0
              ? <p className="center__body">{t('card.noBadges')}</p>
              : <div className="badgeRow">
                  {d.badges.map((b) => <span key={b.id} className="badge">{b.name}</span>)}
                </div>}
          </div>

          <div>
            <span className="section__eyebrow">{t('card.team')}</span>
            <div className="teamStrip">
              {d.teamPreview.map((m) => (
                <span key={m.speciesId + m.level} className="teamStrip__mon">
                  <img src={m.sprite} alt="" width={44} height={44} />
                  <span className="num">{m.level}</span>
                </span>
              ))}
            </div>
          </div>

          <button type="button" className="btn btn--ghost btn--block" onClick={copy}>
            {copied ? t('friends.copied') : t('card.share')}
          </button>
        </section>
      )}

      <section className="section">
        <h2>{t('privacy.title')}</h2>
        {privacy && (
          <div className="switches">
            {([
              ['hideFromLeaderboard', privacy.hideFromLeaderboard],
              ['friendsOnlyInteractions', privacy.friendsOnlyInteractions],
              ['allowFriendRequests', privacy.allowFriendRequests],
              ['reminders', privacy.reminders],
            ] as const).map(([key, value]) => (
              <label key={key} className="switch">
                <span className="switch__text">
                  <span>{t(`privacy.${key}`)}</span>
                  {key === 'reminders' && <span className="switch__hint">{t('privacy.remindersHint')}</span>}
                </span>
                <input type="checkbox" checked={value} disabled={action.busy}
                  onChange={(e) => toggle(key, e.target.checked)} />
                <span className="switch__track" aria-hidden="true" />
              </label>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="statTile">
      <span className="statTile__value num">{value}</span>
      <span className="statTile__label">{label}</span>
    </div>
  )
}

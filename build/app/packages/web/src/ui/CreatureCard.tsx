import type { CreatureView } from '@game/shared'
import { t } from '../i18n'
import { EvolveChip } from './EvolveChip'

export interface CardAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

interface Props {
  creature: CreatureView
  onClick?: () => void
  /** Wird nach einer Entwicklung gerufen, damit der Bildschirm neu laedt. */
  onChanged?: () => void
  /** Knoepfe am unteren Rand der Karte. Mehrere stehen nebeneinander. */
  actions?: CardAction[]
}

/** Percentage of a bar, guarded against a zero denominator (max level has no
 *  next level, so the XP bar would divide by zero). */
const ratio = (value: number, max: number): number => (max <= 0 ? 100 : Math.round((value / max) * 100))

export function CreatureCard({ creature: c, onClick, onChanged, actions }: Props) {
  const hpPercent = ratio(c.hpCurrent, c.hpMax)

  return (
    <article className="ccard">
      <button
        type="button"
        className="ccard__main"
        onClick={onClick}
        disabled={!onClick}
        aria-label={c.displayName}
      >
        <span className="ccard__portrait">
          <img src={c.sprite} alt="" width={72} height={72} loading="lazy" decoding="async" />
          {c.shiny && <span className="ccard__shiny" title={t('creature.shiny')}>✨</span>}
        </span>

        <span className="ccard__body">
          <span className="ccard__head">
            <span className="ccard__name">{c.displayName}</span>
            <span className="ccard__level num">{t('creature.level', { n: c.level })}</span>
          </span>

          <span className="ccard__types">
            {c.types.map((type) => (
              <span key={type.id} className="chip" style={{ '--chip': type.color } as React.CSSProperties}>
                {type.name}
              </span>
            ))}
            {/* Gebunden heisst: es steht im Team, kaempft aber nicht mit.
                Ohne diesen Hinweis sieht ein Kampf mit zwei statt fuenf
                Pokemon aus wie ein Fehler — genau so gemeldet. */}
            {c.busyReason && (
              <span className="chip chip--busy" title={t(`busy.${c.busyReason}.hint`)}>
                {t(`busy.${c.busyReason}`)}
              </span>
            )}
            {c.canEvolveTo.length > 0 && <EvolveChip creature={c} onDone={onChanged} />}
          </span>

          <span className="bars">
            <span className="bar" title={`${c.hpCurrent}/${c.hpMax} KP`}>
              <span className="bar__fill bar__fill--hp" style={{ width: `${hpPercent}%` }} />
            </span>
            <span className="bar" title={c.isMaxLevel
              ? t('creature.maxLevel')
              : t('creature.xpToNext', { into: c.xpIntoLevel, needed: c.xpForNextLevel })}>
              <span className="bar__fill bar__fill--xp"
                style={{ width: `${c.isMaxLevel ? 100 : ratio(c.xpIntoLevel, c.xpForNextLevel)}%` }} />
            </span>
          </span>

          <span className="ccard__meta">
            <span>{t(`friendship.${c.friendshipTier}`)}</span>
            <span aria-hidden="true">·</span>
            <span className="num">{t('creature.power')} {c.power}</span>
          </span>
        </span>
      </button>

      {actions && actions.length > 0 && (
        <div className="ccard__actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className="btn btn--ghost ccard__action"
              onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

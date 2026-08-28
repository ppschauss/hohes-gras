import type { Bootstrap } from '@game/shared'
import { t } from '../i18n'
import { isAvailable } from '../lib/telegram'
import { useGame, type Screen } from '../store'
import { DESTINATIONS, NAV_GROUPS } from './destinations'
import { Icon } from './Icon'
import { Resources } from './Resources'
import { sectionOf } from './NavBar'

interface Props {
  active: Screen
  boot: Bootstrap
  onChange: (screen: Screen) => void
}

/**
 * Die Navigation am Rechner.
 *
 * Auf dem Telefon führen fünf Knöpfe in fünf Richtungen, alles Weitere hängt
 * am Startbildschirm — mehr bleibt in einer Leiste am unteren Rand nicht
 * lesbar. Am Rechner ist Höhe kein knappes Gut, also stehen alle Ziele
 * gleichzeitig da, gegliedert statt aufgezählt. Das ist der eigentliche
 * Unterschied zwischen den beiden Fassungen: nicht mehr Platz für dasselbe,
 * sondern ein Weg weniger zu allem.
 */
export function Sidebar({ active, boot, onChange }: Props) {
  const signOut = useGame((s) => s.signOut)
  const section = sectionOf(active)
  const byScreen = new Map(DESTINATIONS.map((d) => [d.screen, d]))

  return (
    <nav className="rail" aria-label={t('app.title')}>
      <button type="button" className="rail__brand" onClick={() => onChange('home')}>
        <span className="rail__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="26" height="26" role="presentation">
            <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <path d="M2 16h28" stroke="currentColor" strokeWidth="2.5" />
            <circle cx="16" cy="16" r="4.5" fill="var(--surface-sunken)" stroke="currentColor" strokeWidth="2.5" />
          </svg>
        </span>
        <span className="rail__wordmark">{t('app.title')}</span>
      </button>

      <div className="rail__scroll">
        <RailItem
          screen="home" icon="home" label={t('nav.home')}
          current={section === 'home' && active === 'home'} onChange={onChange}
        />

        {NAV_GROUPS.map((group) => {
          const items = group.screens
            .map((s) => byScreen.get(s))
            .filter((d): d is NonNullable<typeof d> => Boolean(d) && boot.features[d!.feature] === true)
          if (items.length === 0) return null
          return (
            <div key={group.labelKey} className="rail__group">
              <span className="rail__groupLabel">{t(group.labelKey)}</span>
              {items.map((d) => (
                <RailItem
                  key={d.screen} screen={d.screen} icon={d.icon} label={t(d.labelKey)}
                  current={active === d.screen || sectionOf(active) === d.screen}
                  onChange={onChange}
                />
              ))}
            </div>
          )
        })}
      </div>

      <div className="rail__foot">
        <Resources />
        <span className="rail__who">
          <span className="rail__name">{boot.trainer.displayName}</span>
          <span className="rail__code num">{boot.trainer.trainerCode}</span>
        </span>
        {/* Abmelden gibt es nur im Browser. In Telegram waere der Knopf eine
            Falle: die App meldet sich beim naechsten Oeffnen sofort wieder an. */}
        {!isAvailable() && (
          <button type="button" className="btn btn--ghost btn--sm btn--block" onClick={signOut}>
            {t('nav.signOut')}
          </button>
        )}
      </div>
    </nav>
  )
}

function RailItem(
  { screen, icon, label, current, onChange }:
  { screen: Screen; icon: Parameters<typeof Icon>[0]['name']; label: string; current: boolean; onChange: (s: Screen) => void },
) {
  return (
    <button
      type="button"
      className="rail__item"
      aria-current={current ? 'page' : undefined}
      onClick={() => onChange(screen)}
    >
      <Icon name={icon} size={19} />
      <span>{label}</span>
    </button>
  )
}

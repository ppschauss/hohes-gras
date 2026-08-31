import { useEffect } from 'react'
import { t } from './i18n'
import { useGame } from './store'
import { NavBar } from './ui/NavBar'
import { CenterState, PartnerSkeleton } from './ui/States'
import { LinkGate } from './ui/LinkGate'
import { GameRouter } from './tabs/GameRouter'
import { Sidebar } from './ui/Sidebar'
import { useWide } from './lib/useWide'
import './app.css'

export function App() {
  const wide = useWide()
  const {
    auth, boot, screen, history, submitting,
    start, submitLinkCode, setScreen, syncScreenFromLocation, refresh,
  } = useGame()

  useEffect(() => { void start() }, [start])

  // Zurueck-Taste des Browsers und Telegram-Deeplinks aendern nur den Hash.
  useEffect(() => {
    window.addEventListener('hashchange', syncScreenFromLocation)
    return () => window.removeEventListener('hashchange', syncScreenFromLocation)
  }, [syncScreenFromLocation])

  if (auth.status === 'needs_link') {
    return (
      <Shell>
        <LinkGate message={auth.message} submitting={submitting} onSubmit={submitLinkCode} />
      </Shell>
    )
  }

  if (auth.status === 'failed') {
    const body = auth.code === 'banned' ? t('auth.banned') : t('error.generic')
    return (
      <Shell>
        <CenterState glyph="⚠️" title={t('auth.failed')} body={body}>
          {auth.code !== 'banned' && (
            <button type="button" className="btn btn--ghost" onClick={() => void start()}>
              {t('app.retry')}
            </button>
          )}
        </CenterState>
      </Shell>
    )
  }

  if (auth.status === 'booting' || !boot) {
    return (
      <Shell>
        <main className="content" aria-busy="true">
          <PartnerSkeleton />
        </main>
      </Shell>
    )
  }

  const game = <GameRouter boot={boot} onTrainerChanged={() => void refresh()} />

  // Zwei Huellen, ein Spiel. Am Rechner traegt eine Seitenleiste die
  // Navigation und der Inhalt bekommt die Breite; auf dem Telefon bleibt es
  // bei der Leiste unten. Die Bildschirme selbst wissen davon nichts.
  if (wide) {
    return (
      <div className="deck">
        <Sidebar active={screen} history={history} boot={boot} onChange={setScreen} />
        <div className="deck__main">
          <div className="viewport">{game}</div>
        </div>
      </div>
    )
  }

  // Die Kopfzeile gehoert zum Bildschirm, nicht zur Huelle: jeder Bildschirm
  // kennt seinen Titel selbst, und zwei Leisten uebereinander waren auf einem
  // Telefon eine Verschwendung.
  return (
    <Shell footer={<NavBar active={screen} history={history} onChange={setScreen} />}>
      <div className="viewport">{game}</div>
    </Shell>
  )
}

function Shell({ footer, children }: { footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="shell">
      {children}
      {footer ?? <div />}
    </div>
  )
}

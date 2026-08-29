import { useState } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Screen } from '../ui/Screen'
import { StoryPanel } from '../progress/StoryPanel'
import { EvolutionPanel } from '../progress/EvolutionPanel'
import { BoardingPanel } from '../progress/BoardingPanel'

/*
 * Drei Reiter statt neun.
 *
 * Hier stand einmal alles: Reise, Entwicklung, Ausbau, Forschung, Pension,
 * Handwerk, Saison, Erfolge und Daten — ein Streifen, den man seitlich
 * schieben musste, um sein Ende zu sehen, und in dem nichts mit nichts zu tun
 * hatte. Uebrig bleibt, was wirklich der Fortschritt der eigenen Reise ist:
 * wo sie weitergeht, was sich entwickeln kann, und wer gerade trainiert.
 *
 * Ausbau, Forschung und Handwerk sind zur Basis gewandert, Saison, Erfolge und
 * Rangliste zu den Erfolgen, die Daten zu den Einstellungen.
 */
type Tab = 'story' | 'evolution' | 'boarding'
const TABS: Tab[] = ['story', 'evolution', 'boarding']

export function ProgressScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('story')

  return (
    <Screen eyebrow={t('progress.eyebrow')} title={t('progress.title')} onBack={onBack}>
      <main className="content">
        <div className="segmented" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className="segmented__btn" onClick={() => { haptic.select(); setTab(id) }}>
              {t(`progress.tab.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'story' && <StoryPanel />}
        {tab === 'evolution' && <EvolutionPanel />}
        {tab === 'boarding' && <BoardingPanel />}
      </main>
    </Screen>
  )
}

import { useState } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Screen } from '../ui/Screen'
import { QuestPanel } from '../progress/QuestPanel'
import { AchievementPanel } from '../progress/AchievementPanel'
import { SeasonPanel } from '../progress/SeasonPanel'
import { RankingPanel } from '../social/RankingPanel'

/**
 * Erfolge, Saison und Rangliste.
 *
 * Drei Antworten auf dieselbe Frage — „wie weit bin ich, und wie steh ich da?"
 * —, die vorher an zwei Orten lagen: Erfolge und Saison als Reiter acht und
 * neun im Fortschritt, die Rangliste bei den Freunden zwischen Marktplatz und
 * Trainerkarte. Zusammen sind sie ein eigener Ort mit eigenem Symbol.
 */
/* Aufgaben zuerst: sie sind das, was heute ansteht. Erfolge und Rangliste
 * sind Rueckblick. */
type Tab = 'quests' | 'achievements' | 'season' | 'ranking'
const TABS: Tab[] = ['quests', 'achievements', 'season', 'ranking']

export function RecordsScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('quests')

  return (
    <Screen eyebrow={t('records.eyebrow')} title={t('records.title')} onBack={onBack}>
      <main className="content">
        <div className="segmented" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className="segmented__btn" onClick={() => { haptic.select(); setTab(id) }}>
              {t(`records.tab.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'quests' && <QuestPanel />}
        {tab === 'achievements' && <AchievementPanel />}
        {tab === 'season' && <SeasonPanel />}
        {tab === 'ranking' && <RankingPanel />}
      </main>
    </Screen>
  )
}

import { useState } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Screen } from '../ui/Screen'
import { StoryPanel } from '../progress/StoryPanel'
import { EvolutionPanel } from '../progress/EvolutionPanel'
import { BuildingPanel } from '../progress/BuildingPanel'
import { CraftingPanel } from '../progress/CraftingPanel'
import { SeasonPanel } from '../progress/SeasonPanel'
import { AchievementPanel } from '../progress/AchievementPanel'
import { DataPanel } from '../progress/DataPanel'

type Tab = 'story' | 'evolution' | 'buildings' | 'crafting' | 'season' | 'achievements' | 'data'
const TABS: Tab[] = ['story', 'evolution', 'buildings', 'crafting', 'season', 'achievements', 'data']

export function ProgressScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('story')

  return (
    <Screen eyebrow={t('progress.eyebrow')} title={t('progress.title')} onBack={onBack}>
      <main className="content">
        <div className="segmented segmented--scroll" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className="segmented__btn" onClick={() => { haptic.select(); setTab(id) }}>
              {t(`progress.tab.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'story' && <StoryPanel />}
        {tab === 'evolution' && <EvolutionPanel />}
        {tab === 'buildings' && <BuildingPanel />}
        {tab === 'crafting' && <CraftingPanel />}
        {tab === 'season' && <SeasonPanel />}
        {tab === 'achievements' && <AchievementPanel />}
        {tab === 'data' && <DataPanel />}
      </main>
    </Screen>
  )
}

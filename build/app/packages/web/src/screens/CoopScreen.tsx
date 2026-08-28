import { useState } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Screen } from '../ui/Screen'
import { GuildPanel } from '../coop/GuildPanel'
import { RaidPanel } from '../coop/RaidPanel'
import { PvpPanel } from '../coop/PvpPanel'
import { TournamentPanel } from '../coop/TournamentPanel'

type Tab = 'guild' | 'raids' | 'pvp' | 'tournament'
const TABS: Tab[] = ['guild', 'raids', 'pvp', 'tournament']

export function CoopScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('guild')

  return (
    <Screen eyebrow={t('coop.eyebrow')} title={t('coop.title')} onBack={onBack}>
      <main className="content">
        <div className="segmented segmented--scroll" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className="segmented__btn" onClick={() => { haptic.select(); setTab(id) }}>
              {t(`coop.tab.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'guild' && <GuildPanel />}
        {tab === 'raids' && <RaidPanel />}
        {tab === 'pvp' && <PvpPanel />}
        {tab === 'tournament' && <TournamentPanel />}
      </main>
    </Screen>
  )
}

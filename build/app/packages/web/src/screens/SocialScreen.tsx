import { useState } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Screen } from '../ui/Screen'
import { FriendsPanel } from '../social/FriendsPanel'
import { MarketPanel } from '../social/MarketPanel'
import { TradePanel } from '../social/TradePanel'
import { CardPanel } from '../social/CardPanel'
import { ChatPanel } from '../social/ChatPanel'
import { GlobalFriendsPanel } from '../social/GlobalFriendsPanel'

/* Die Rangliste steht jetzt bei den Erfolgen: sie beantwortet "wie steh ich
 * da" und nicht "mit wem tausche ich". */
type Tab = 'friends' | 'global' | 'chat' | 'market' | 'trades' | 'card'
const TABS: Tab[] = ['friends', 'global', 'chat', 'market', 'trades', 'card']

/** One screen with five panels rather than five menu entries: they share a
 *  header and the player moves between them constantly while trading. */
export function SocialScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('friends')

  return (
    <Screen eyebrow={t('social.eyebrow')} title={t('social.title')} onBack={onBack}>
      <main className="content">
        <div className="segmented segmented--scroll" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className="segmented__btn" onClick={() => { haptic.select(); setTab(id) }}>
              {t(`social.tab.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'friends' && <FriendsPanel />}
        {tab === 'global' && <GlobalFriendsPanel />}
        {tab === 'chat' && <ChatPanel />}
        {tab === 'market' && <MarketPanel />}
        {tab === 'trades' && <TradePanel />}
        {tab === 'card' && <CardPanel />}
      </main>
    </Screen>
  )
}

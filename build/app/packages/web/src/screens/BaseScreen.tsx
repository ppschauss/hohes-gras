import { useState } from 'react'
import { t } from '../i18n'
import { haptic } from '../lib/telegram'
import { Screen } from '../ui/Screen'
import { BuildingPanel } from '../progress/BuildingPanel'
import { ResearchPanel } from '../progress/ResearchPanel'
import { CraftingPanel } from '../progress/CraftingPanel'
import { TradeStationPanel } from '../progress/TradeStationPanel'

/**
 * Die Basis: Ausbau, Labor, Werkstatt, Tausch-Station.
 *
 * Alles drei stand vorher als Reiter im „Fortschritt", zwischen der Reise, den
 * Entwicklungen und den Erfolgen — neun Reiter in einem Streifen, den man
 * seitlich schieben musste, um das Ende zu sehen. Was hier steht, gehört
 * zusammen: es sind die Dinge, die man *baut und betreibt*, und sie hängen
 * aneinander. Der Ausbau schaltet Forschung frei, die Forschung schaltet
 * Rezepte frei, die Werkstatt stellt sie her. Die Tausch-Station ist das Ende
 * derselben Kette: sie verbraucht, was die Werkstatt baut.
 */
type Tab = 'buildings' | 'research' | 'crafting' | 'station'
const TABS: Tab[] = ['buildings', 'research', 'crafting', 'station']

export function BaseScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('buildings')

  return (
    <Screen eyebrow={t('base.eyebrow')} title={t('base.title')} onBack={onBack}>
      <main className="content">
        <div className="segmented" role="tablist">
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className="segmented__btn" onClick={() => { haptic.select(); setTab(id) }}>
              {t(`base.tab.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'buildings' && <BuildingPanel />}
        {tab === 'research' && <ResearchPanel />}
        {tab === 'crafting' && <CraftingPanel />}
        {tab === 'station' && <TradeStationPanel />}
      </main>
    </Screen>
  )
}

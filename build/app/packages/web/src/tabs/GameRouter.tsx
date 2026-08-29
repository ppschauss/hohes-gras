import { useEffect, useState } from 'react'
import type { Bootstrap } from '@game/shared'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAsync } from '../lib/useAsync'
import { useGame, type Screen } from '../store'
import { HomeScreen } from '../screens/HomeScreen'
import { StarterPicker } from '../screens/StarterPicker'
import { GardenScreen } from '../screens/GardenScreen'
import { BoxScreen } from '../screens/BoxScreen'
import { TeamsScreen } from '../screens/TeamsScreen'
import { DexScreen } from '../screens/DexScreen'
import { ShopScreen } from '../screens/ShopScreen'
import { BagScreen } from '../screens/BagScreen'
import { EnergyScreen } from '../screens/EnergyScreen'
import { CenterScreen } from '../screens/CenterScreen'
import { PlotsScreen } from '../screens/PlotsScreen'
import { ThemeScreen } from '../screens/ThemeScreen'
import { WorldMapScreen } from '../screens/WorldMapScreen'
import { SafariScreen } from '../screens/SafariScreen'
import { ExpeditionScreen } from '../screens/ExpeditionScreen'
import { EggScreen } from '../screens/EggScreen'
import { AreaScreen } from '../screens/AreaScreen'
import { BattleScreen } from '../screens/BattleScreen'
import { SocialScreen } from '../screens/SocialScreen'
import { CoopScreen } from '../screens/CoopScreen'
import { ProgressScreen } from '../screens/ProgressScreen'
import { ArenaScreen } from '../screens/ArenaScreen'

interface Props {
  boot: Bootstrap
  onTrainerChanged: () => void
}

export function GameRouter({ boot, onTrainerChanged }: Props) {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)
  const goBack = useGame((s) => s.goBack)

  const starter = useAsync(() => api.starterInfo(), [])
  const [background, setBackground] = useState(boot.trainer.gardenBackground)

  useEffect(() => { setBackground(boot.trainer.gardenBackground) }, [boot.trainer.gardenBackground])

  // Ohne Partner ist im Menue dahinter nichts zu tun: die Auswahl uebernimmt
  // den ganzen Bildschirm.
  if (starter.data?.needsStarter) {
    return <StarterPicker onDone={() => { starter.reload(); onTrainerChanged() }} />
  }

  /*
   * Zurueck heisst: einen Schritt zurueck, nicht "irgendwohin".
   *
   * Vorher trug jeder Fall sein Ziel fest: die Box fuehrte immer zu den Teams,
   * die Expeditionen immer zur Karte — obwohl beide vom Startbildschirm aus
   * geoeffnet werden. Man landete, wo man nie war.
   */
  const back = () => { haptic.tap(); goBack(); onTrainerChanged() }

  switch (screen) {
    case 'garden':
      return <GardenScreen onBack={back} onOpenBox={() => setScreen('box')} onOpenDex={() => setScreen('dex')} />
    case 'teams':
      return <TeamsScreen onBack={back} onOpenBox={() => setScreen('box')} />
    case 'box':
      return <BoxScreen onBack={back} />
    case 'dex':
      return <DexScreen onBack={back} />
    case 'shop':
      return (
        <ShopScreen
          onBack={back}
          activeBackground={background}
          onBackgroundChanged={() => { onTrainerChanged(); setScreen('garden') }}
        />
      )
    case 'bag':
      return <BagScreen onBack={back} />
    case 'energy':
      return <EnergyScreen onBack={back} />
    case 'center':
      return <CenterScreen onBack={back} />
    case 'plots':
      return <PlotsScreen onBack={back} />
    case 'themes':
      return <ThemeScreen onBack={back} />
    case 'map':
      return <WorldMapScreen onBack={back} onEnterArea={() => setScreen('area')} />
    case 'area':
      return (
        <AreaScreen
          onBack={back}
          onSafari={() => setScreen('safari')}
          onBattle={() => setScreen('battle')}
        />
      )
    case 'safari':
      return <SafariScreen onBack={back} onEventBattle={() => setScreen('battle')} />
    case 'battle':
      return <BattleScreen onBack={back} onArena={() => setScreen('arena')} />
    case 'expeditions':
      return <ExpeditionScreen onBack={back} />
    case 'eggs':
      return <EggScreen onBack={back} />
    case 'friends':
      return <SocialScreen onBack={back} />
    case 'coop':
      return <CoopScreen onBack={back} />
    case 'progress':
      return <ProgressScreen onBack={back} />
    case 'arena':
      return <ArenaScreen onBack={back} onBattle={() => setScreen('battle')} />
    default:
      break
  }

  return <HomeScreen boot={boot} />
}

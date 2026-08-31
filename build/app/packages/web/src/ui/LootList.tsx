import { t } from '../i18n'
import { ItemIcon } from './ItemIcon'

export interface LootItem {
  itemId: string
  name: string
  icon: string
  quantity: number
  category?: string
}

/**
 * Was man bekommen hat — als Liste, nicht als Zahl.
 *
 * Vorher standen bei jeder Belohnung nur Gold und EP. Gegenstände wurden
 * stumm in den Beutel gelegt: nach einem Überfall lagen dort plötzlich zwei
 * Lockdüfte und eine Sagenbeere, ohne dass es irgendwo gestanden hätte. Man
 * hätte den Beutel auswendig kennen und nach jedem Kampf nachsehen müssen —
 * genau so gemeldet.
 *
 * Deshalb an einer Stelle und überall gleich: Kampf, Arena, Überfall, Raid.
 */
export function LootList({ items, label }: { items: LootItem[]; label?: string }) {
  if (items.length === 0) return null
  return (
    <div className="loot">
      <span className="section__eyebrow">{label ?? t('reward.items')}</span>
      <ul className="loot__list">
        {items.map((i) => (
          <li key={i.itemId} className="loot__row">
            <ItemIcon src={i.icon} category={i.category ?? 'material'} size={22} />
            <span className="loot__name">{i.name}</span>
            <span className="loot__num num">×{i.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

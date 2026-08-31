import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type CraftingView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { ItemIcon } from '../ui/ItemIcon'

type Recipe = CraftingView['recipes'][number]

/**
 * Werkstatt.
 *
 * Bälle lassen sich in zehn, fünfundzwanzig oder fünfzig Stück bauen; alles
 * andere hat genau eine Menge. Deshalb steht der Mengenschalter nur dort, wo
 * es etwas zu wählen gibt — ein Schalter mit einer Wahl ist keine Wahl.
 */
export function CraftingPanel() {
  const crafting = useAsync(() => api.crafting(), [])
  const action = useAction()
  const [made, setMade] = useState<string | null>(null)
  /** Je Rezept die gewählte Menge. Ohne Eintrag gilt die kleinste. */
  const [picked, setPicked] = useState<Record<string, number>>({})

  const batchOf = (r: Recipe) =>
    r.batches.find((b) => b.count === picked[r.id]) ?? r.batches[0]!

  const craft = (r: Recipe) => {
    const batch = batchOf(r)
    haptic.tap()
    void action.run(() => api.craft(r.id, batch.count), (res) => {
      crafting.set(res.crafting)
      setMade(t('craft.crafted', { n: batch.count, name: r.output.name }))
      haptic.success()
    })
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {made && <p className="notice notice--ok">{made}</p>}
      <p className="num">🪙 {number(crafting.data?.gold ?? 0)}</p>

      <div className="stack">
        {crafting.data?.recipes.map((r) => {
          const batch = batchOf(r)
          return (
            <article key={r.id} className="recipe">
              <div className="recipe__out">
                <ItemIcon src={r.output.icon} category={r.output.category} size={32} />
                <span className="recipe__name">{batch.count}× {r.output.name}</span>
              </div>

              {r.batches.length > 1 && (
                <div className="segmented segmented--tight" role="group" aria-label={t('craft.amount')}>
                  {r.batches.map((b) => (
                    <button key={b.count} type="button" className="segmented__btn"
                      aria-pressed={b.count === batch.count}
                      onClick={() => { haptic.select(); setPicked((p) => ({ ...p, [r.id]: b.count })) }}>
                      {b.count}×
                    </button>
                  ))}
                </div>
              )}

              <ul className="recipe__in">
                {batch.inputs.map((i) => (
                  <li key={i.itemId} className={i.have >= i.quantity ? 'recipe__have' : 'recipe__missing'}>
                    <ItemIcon src={i.icon} category={i.category} size={20} />
                    <span>{i.name}</span>
                    <span className="num">{i.have}/{i.quantity}</span>
                  </li>
                ))}
                <li className={batch.goldCost <= (crafting.data?.gold ?? 0) ? 'recipe__have' : 'recipe__missing'}>
                  <span aria-hidden="true">🪙</span>
                  <span>Gold</span>
                  <span className="num">{number(batch.goldCost)}</span>
                </li>
              </ul>

              {r.requiresBuilding && (
                <p className="recipe__req">
                  {t('craft.requiresBuilding', {
                    name: t(`build.name.${r.requiresBuilding.buildingId}`),
                    level: r.requiresBuilding.level,
                  })}
                </p>
              )}

              <button type="button" className="btn btn--primary btn--sm"
                disabled={!batch.craftable || action.busy}
                onClick={() => craft(r)}>
                {batch.craftable ? t('craft.make') : t(`craft.blocked.${batch.blockedReason}`)}
              </button>
            </article>
          )
        })}
      </div>
    </>
  )
}

import { useState } from 'react'
import { t } from '../i18n'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { ItemIcon } from '../ui/ItemIcon'

export function CraftingPanel() {
  const crafting = useAsync(() => api.crafting(), [])
  const action = useAction()
  const [made, setMade] = useState<string | null>(null)

  const craft = (recipeId: string, label: string, quantity: number) => {
    haptic.tap()
    void action.run(() => api.craft(recipeId), (res) => {
      crafting.set(res.crafting)
      setMade(t('craft.crafted', { n: quantity, name: label }))
      haptic.success()
    })
  }

  return (
    <>
      {action.error && <p className="notice" role="alert">{t(`error.${action.error}`)}</p>}
      {made && <p className="notice notice--ok">{made}</p>}
      <p className="num">🪙 {number(crafting.data?.gold ?? 0)}</p>

      <div className="stack">
        {crafting.data?.recipes.map((r) => (
          <article key={r.id} className="recipe">
            <div className="recipe__out">
              <ItemIcon src={r.output.icon} category={r.output.category} size={32} />
              <span className="recipe__name">{r.output.quantity}× {r.output.name}</span>
            </div>

            <ul className="recipe__in">
              {r.inputs.map((i) => (
                <li key={i.itemId} className={i.have >= i.quantity ? 'recipe__have' : 'recipe__missing'}>
                  <ItemIcon src={i.icon} category={i.category} size={20} />
                  <span>{i.name}</span>
                  <span className="num">{i.have}/{i.quantity}</span>
                </li>
              ))}
              <li className={r.goldCost <= (crafting.data?.gold ?? 0) ? 'recipe__have' : 'recipe__missing'}>
                <span aria-hidden="true">🪙</span>
                <span>Gold</span>
                <span className="num">{number(r.goldCost)}</span>
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
              disabled={!r.craftable || action.busy}
              onClick={() => craft(r.id, r.output.name, r.output.quantity)}>
              {r.craftable ? t('craft.make') : t(`craft.blocked.${r.blockedReason}`)}
            </button>
          </article>
        ))}
      </div>
    </>
  )
}

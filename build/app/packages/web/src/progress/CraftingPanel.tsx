import { useState } from 'react'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api, type CraftingView } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { number } from '../lib/format'
import { ItemIcon } from '../ui/ItemIcon'
import { Fold } from '../ui/Fold'
import { CRAFT_ORDER, SECTION_KEY } from '../lib/groups'

type Recipe = CraftingView['recipes'][number]

/**
 * Was gerade angezeigt wird.
 *
 * "Jetzt möglich" ist die Ansicht, mit der man ankommt: sechsundzwanzig
 * Rezepte, von denen die Hälfte an fehlenden Zutaten scheitert, beantworten
 * die Frage nicht, die man beim Öffnen hat.
 */
const FILTERS = ['ready', 'all', 'blocked'] as const
type Filter = (typeof FILTERS)[number]

/**
 * Werkstatt.
 *
 * Bälle lassen sich in zehn, fünfundzwanzig oder fünfzig Stück bauen; alles
 * andere hat genau eine Menge. Deshalb steht der Mengenschalter nur dort, wo
 * es etwas zu wählen gibt — ein Schalter mit einer Wahl ist keine Wahl.
 *
 * Die Rezepte stehen in aufklappbaren Gruppen statt untereinander. Sechs-
 * undzwanzig in einer Rolle heißt: scrollen, bis man findet: gemeldet als
 * "gerne alles etwas aufgeräumter". Zugeklappt sind es acht Zeilen.
 */
export function CraftingPanel() {
  const crafting = useAsync(() => api.crafting(), [])
  const action = useAction()
  const [made, setMade] = useState<string | null>(null)
  /** Je Rezept die gewählte Menge. Ohne Eintrag gilt die kleinste. */
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [filter, setFilter] = useState<Filter>('ready')

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

  const alle = crafting.data?.recipes ?? []
  const sichtbar = alle.filter((r) => passt(r, filter, batchOf))
  const gruppen = CRAFT_ORDER
    .map((category) => ({ category, recipes: sichtbar.filter((r) => r.output.category === category) }))
    .filter((g) => g.recipes.length > 0)

  return (
    <>
      {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}
      {made && <p className="notice notice--ok">{made}</p>}
      <p className="num">🪙 {number(crafting.data?.gold ?? 0)}</p>

      <div className="filterRow">
        <label className="filterRow__label" htmlFor="craft-filter">{t('craft.filter')}</label>
        <select id="craft-filter" className="picker__select" value={filter}
          onChange={(e) => { haptic.select(); setFilter(e.target.value as Filter) }}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`craft.filter.${f}`)} ({alle.filter((r) => passt(r, f, batchOf)).length})
            </option>
          ))}
        </select>
      </div>

      {gruppen.length === 0 && <p className="center__body">{t('craft.filterEmpty')}</p>}

      {gruppen.map((g) => (
        <Fold key={g.category}
          title={t(`shop.section.${SECTION_KEY[g.category] ?? g.category}`)}
          count={g.recipes.length}
          /* Bei "Jetzt moeglich" ist jedes gezeigte Rezept moeglich — dann
             stuende hier zweimal dieselbe Zahl. */
          note={filter === 'ready'
            ? undefined
            : t('craft.readyOf', { n: g.recipes.filter((r) => batchOf(r).craftable).length })}
          /* Zugeklappt, sobald es mehr als eine Gruppe gibt. Bei genau einer
             waere der Klick zum Aufklappen reine Schikane. */
          open={gruppen.length === 1}
        >
      <div className="stack">
        {g.recipes.map((r) => {
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
        </Fold>
      ))}
    </>
  )
}

/** Passt ein Rezept zum gewaehlten Zustand? */
function passt(r: Recipe, f: Filter, batchOf: (r: Recipe) => Recipe['batches'][number]): boolean {
  if (f === 'all') return true
  return batchOf(r).craftable === (f === 'ready')
}

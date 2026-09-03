import { useState } from 'react'
import type { ShopItem } from '@game/shared'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { api } from '../lib/api'
import { haptic } from '../lib/telegram'
import { useAction, useAsync } from '../lib/useAsync'
import { Screen } from '../ui/Screen'
import { ItemIcon } from '../ui/ItemIcon'

const QUANTITIES = [1, 5, 10]

interface Props {
  onBack: () => void
  activeBackground: string
  onBackgroundChanged: () => void
}

export function ShopScreen({ onBack, activeBackground, onBackgroundChanged }: Props) {
  const shop = useAsync(() => api.shop(), [])
  const action = useAction()
  const [quantity, setQuantity] = useState(1)
  const [tab, setTab] = useState<string>('ball')

  const buy = (item: ShopItem) => {
    haptic.tap()
    const amount = item.oneTime ? 1 : quantity
    void action.run(() => api.buy(item.id, amount), (state) => { shop.set(state); haptic.success() })
  }

  /*
   * Ein Reiter je Art statt aller Arten untereinander.
   *
   * Derselbe Griff wie im Beutel und aus demselben Grund: der Laden fuehrt
   * neun Abschnitte, und wer einen Stein sucht, rollt an Baellen, Beeren,
   * Medizin und Bonbons vorbei. Die Reiter kommen aus dem, was der Laden
   * wirklich fuehrt — ein leerer Abschnitt bekommt keinen.
   */
  const abschnitte = shop.data?.sections ?? []
  const aktiv = abschnitte.some((a) => a.category === tab) ? tab : abschnitte[0]?.category ?? null
  const sichtbar = abschnitte.filter((a) => a.category === aktiv)

  const equip = (item: ShopItem) => {
    haptic.tap()
    void action.run(() => api.setBackground(item.id), () => { onBackgroundChanged(); haptic.success() })
  }

  return (
    <Screen
      eyebrow={t('shop.eyebrow')}
      title={t('shop.title')}
      onBack={onBack}
    >
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {abschnitte.length > 1 && (
          <div className="tabsScroll" role="tablist" aria-label={t('shop.title')}>
            {abschnitte.map((a) => (
              <button key={a.category} type="button" role="tab" aria-selected={a.category === aktiv}
                className="tabsScroll__btn"
                onClick={() => { haptic.select(); setTab(a.category) }}>
                {t(a.title)}
                <span className="tabsScroll__count num">{a.items.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className="segmented" role="group" aria-label={t('shop.quantity')}>
          {QUANTITIES.map((q) => (
            <button
              key={q}
              type="button"
              className="segmented__btn"
              aria-pressed={quantity === q}
              onClick={() => setQuantity(q)}
            >
              {q}×
            </button>
          ))}
        </div>

        {shop.loading && !shop.data
          ? [0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)
          : sichtbar.map((section) => (
              <section key={section.category} className="section">
                <h2>{t(section.title)}</h2>
                <div className="stack">
                  {section.items.map((item) => {
                    const isBackground = item.category === 'background'
                    const isActive = isBackground && activeBackground === item.id
                    const canAfford = (shop.data?.gold ?? 0) >= item.price * (item.oneTime ? 1 : quantity)

                    return (
                      <article key={item.id} className="shopRow">
                        <ItemIcon src={item.icon} category={item.category} />
                        <div className="shopRow__text">
                          <span className="shopRow__name">{item.name}</span>
                          <span className="shopRow__desc">{item.description}</span>
                          {!isBackground && <span className="shopRow__owned">{t('shop.owned', { n: item.owned })}</span>}
                        </div>
                        <div className="shopRow__buy">
                          {isActive
                            ? <span className="tag tag--active">{t('shop.equipped')}</span>
                            : item.alreadyOwned
                              ? <button type="button" className="btn btn--ghost btn--sm" disabled={action.busy}
                                  onClick={() => equip(item)}>{t('shop.equip')}</button>
                              : <button type="button" className="btn btn--buy btn--sm"
                                  disabled={action.busy || !canAfford}
                                  onClick={() => buy(item)}>
                                  {t('shop.price', { n: item.price * (item.oneTime ? 1 : quantity) })}
                                </button>}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
      </main>
    </Screen>
  )
}

import { t } from '../i18n'
import { api, type BagItem } from '../lib/api'
import { haptic } from '../lib/telegram'
import { errorText } from '../lib/errors'
import { useAction, useAsync } from '../lib/useAsync'
import { ItemIcon } from '../ui/ItemIcon'
import { Screen } from '../ui/Screen'
import { CenterState } from '../ui/States'

/**
 * Der Beutel.
 *
 * Es gab ihn nicht: Gegenstände lagen im Spiel, aber nirgends auf einem
 * Bildschirm — man sah sie nur dort, wo man sie gerade brauchte (Safari, Kampf,
 * Laden). Ein Mitspieler hat es so gesagt: „ich find das Inventar nicht."
 *
 * Sortiert nach Kategorien statt alphabetisch: wer nachsieht, sucht meist eine
 * Art von Gegenstand — Heilung, Bälle, Beeren — und nicht einen bestimmten.
 */
const ORDER = ['ball', 'berry', 'medicine', 'lure', 'xp', 'stone', 'material', 'key', 'gear', 'background']

export function BagScreen({ onBack }: { onBack: () => void }) {
  const bag = useAsync(() => api.bag(), [])
  const souls = useAsync(() => api.souls(), [])
  const action = useAction()

  const redeem = (typeId: string) => {
    haptic.tap()
    void action.run(() => api.redeemSouls(typeId), (res) => {
      souls.set({ souls: res.souls })
      bag.reload()
      haptic.success()
    })
  }

  // Fragmente stehen oben in ihrem eigenen Abschnitt — in der Materialliste
  // waeren sie ein zweites Mal dieselbe Sache.
  const items = (bag.data?.items ?? []).filter((i) => i.quantity > 0 && !i.id.startsWith('soul-'))
  const groups = ORDER
    .map((category) => ({ category, items: items.filter((i) => i.category === category) }))
    .filter((g) => g.items.length > 0)

  return (
    <Screen eyebrow={t('bag.eyebrow')} title={t('bag.title')} onBack={onBack}>
      <main className="content">
        {action.error && <p className="notice" role="alert">{errorText(action.error, action.detail)}</p>}

        {/* Fragmente stehen oben und nicht zwischen den Materialien: sie sind
            kein Gegenstand, den man benutzt, sondern ein Zaehler, auf den man
            hinarbeitet. */}
        {(souls.data?.souls.length ?? 0) > 0 && (
          <section className="section">
            <h2>{t('souls.title')}</h2>
            <p className="center__body">{t('souls.subtitle')}</p>
            <div className="stack">
              {souls.data!.souls.map((s) => (
                <article key={s.itemId} className="soulRow">
                  <span className="soulRow__dot" style={{ '--chip': s.color } as React.CSSProperties} />
                  <span className="soulRow__text">
                    <span className="soulRow__name">{s.typeName}</span>
                    <span className="bar">
                      <span className="bar__fill bar__fill--xp"
                        style={{ width: `${Math.min(100, (s.have / s.need) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="soulRow__count num">{t('souls.progress', { have: s.have, need: s.need })}</span>
                  {s.ready && (
                    <button type="button" className="btn btn--primary btn--sm" disabled={action.busy}
                      onClick={() => redeem(s.typeId)}>{t('souls.eggReady')}</button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {bag.loading && !bag.data
          ? [0, 1].map((i) => <div key={i} className="skeleton skeleton--row" />)
          : groups.length === 0
            ? <CenterState glyph="🎒" title={t('bag.empty')} body={t('bag.emptyHint')} />
            : groups.map((group) => (
                <section key={group.category} className="section">
                  <h2>{t(`shop.section.${SECTION_KEY[group.category] ?? group.category}`)}</h2>
                  <div className="stack">
                    {group.items.map((item) => <BagRow key={item.id} item={item} />)}
                  </div>
                </section>
              ))}
      </main>
    </Screen>
  )
}

/** Die Abschnittsnamen des Ladens passen — bis auf die, die es dort nicht gibt. */
const SECTION_KEY: Record<string, string> = {
  ball: 'balls', berry: 'berries', medicine: 'medicine', lure: 'lures',
  xp: 'xp', stone: 'stones', background: 'backgrounds', key: 'key',
}

function BagRow({ item }: { item: BagItem }) {
  return (
    <article className="bagRow">
      <ItemIcon src={item.icon} category={item.category} size={36} />
      <span className="bagRow__text">
        <span className="bagRow__name">{item.name}</span>
        <span className="bagRow__desc">{item.description}</span>
      </span>
      <span className="bagRow__count num">{item.quantity}×</span>
    </article>
  )
}

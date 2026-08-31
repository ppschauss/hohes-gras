import { STATS, type CreatureView, type Nature, type StatBlock, type StatKey } from '@game/shared'
import { IV_MAX, natureMultiplier } from '@game/engine'
import { t } from '../i18n'

/**
 * Die Werte hinter einem Pokemon.
 *
 * Wesen und Veranlagung entscheiden mit, ob ein Pokemon einen Kampf traegt
 * oder nur mitlaeuft — sichtbar waren sie bisher nirgends. Genau danach wurde
 * gefragt: zwei Rizeros auf demselben Level koennen fuenfzig Werte
 * auseinanderliegen, und ohne diese Ansicht sieht man den Unterschied erst,
 * wenn einer davon umfaellt.
 *
 * Es wird nichts nachgeladen. Alles, was hier steht, liegt bereits in der
 * Kreaturenansicht, mit der die Karte darueber gezeichnet wurde — das Feld
 * klappt deshalb ohne Wartezeit auf.
 */
export function DetailsPanel({ creature: c }: { creature: CreatureView }) {
  return (
    <section className="detail">
      <StatTable werte={c} />

      <ul className="detail__facts">
        <Fact label={t('creature.energy')} value={`${c.energy}/100`} />
        <Fact label={t('creature.condition')} value={`${c.condition}/100`} />
        <Fact label={t('creature.friendship')} value={`${c.friendship}/255`} />
        <Fact label={t('detail.caught')} value={datum(c.caughtAt)} />
      </ul>
    </section>
  )
}

/**
 * Alles, was an einem Pokemon rechnerisch feststeht.
 *
 * Eigenes Bauteil, weil es an zwei Stellen gebraucht wird: unter der
 * Kreaturenkarte in Garten und Box, und im Fenster bei der Zucht. Zweimal
 * dieselbe Tabelle zu schreiben hiesse, sie beim naechsten Mal an einer Stelle
 * zu aendern — und genau darum ging die Bitte, es solle dort aussehen wie hier.
 *
 * Der Zuschnitt ist bewusst schmal: Wesen, Anlagen, Werte. Alles, was nur ein
 * *besessenes* Pokemon hat — Ausdauer, Verfassung, Fangdatum —, bleibt
 * draussen, damit auch ein Zuchtkandidat hineinpasst.
 */
export interface Werte {
  nature: Nature
  ivs: StatBlock
  stats: StatBlock
  ivPercent: number
  evs?: StatBlock
}

export function StatTable({ werte: c }: { werte: Werte }) {
  const hebt = STATS.find((s) => natureMultiplier(c.nature, s) > 1) ?? null
  const senkt = STATS.find((s) => natureMultiplier(c.nature, s) < 1) ?? null
  const ivSumme = STATS.reduce((sum, s) => sum + c.ivs[s], 0)
  // Die Spalte erscheint nur, wenn es etwas zu zeigen gibt: sechs Nullen
  // saehen aus wie ein Fehler, nicht wie ein unbenutztes System.
  const hatEvs = STATS.some((s) => (c.evs?.[s] ?? 0) > 0)

  return (
    <>
      <p className="detail__nature">
        <span className="detail__natureName">{t(`nature.${c.nature}`)}</span>
        <span className="detail__natureEffect">
          {hebt && senkt
            ? t('detail.natureEffect', { up: t(`stat.${hebt}`), down: t(`stat.${senkt}`) })
            : t('detail.natureNeutral')}
        </span>
      </p>

      <table className="detail__table">
        <caption className="detail__caption">
          {t('detail.ivTotal', { sum: ivSumme, max: STATS.length * IV_MAX, percent: c.ivPercent })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('detail.stat')}</th>
            <th scope="col" className="num">{t('detail.value')}</th>
            <th scope="col" colSpan={2}>{t('creature.ivs')}</th>
            {hatEvs && <th scope="col" className="num">{t('detail.evs')}</th>}
          </tr>
        </thead>
        <tbody>
          {STATS.map((stat) => (
            <Row key={stat} werte={c} stat={stat} hebt={hebt} senkt={senkt} evs={hatEvs} />
          ))}
        </tbody>
      </table>
    </>
  )
}

/**
 * Eine Wertezeile.
 *
 * Der Balken ist wichtiger als die Zahl daneben: 29 von 31 liest sich wie 12
 * von 31, ein fast voller Balken neben einem halben nicht. Die Zahl bleibt
 * trotzdem stehen, weil man beim Zuechten damit rechnet.
 */
function Row(
  { werte: c, stat, hebt, senkt, evs }:
  { werte: Werte; stat: StatKey; hebt: StatKey | null; senkt: StatKey | null; evs: boolean },
) {
  const iv = c.ivs[stat]
  const perfekt = iv >= IV_MAX

  return (
    <tr>
      <th scope="row" className="detail__stat">
        {t(`stat.${stat}`)}
        {/* Das Wesen steht schon oben im Klartext. Hier markiert es die Zeile,
            die es betrifft — sonst muesste man beim Lesen hin und her springen. */}
        {stat === hebt && <span className="detail__mod detail__mod--up" title={t('detail.raised')}>▲</span>}
        {stat === senkt && <span className="detail__mod detail__mod--down" title={t('detail.lowered')}>▼</span>}
      </th>
      <td className="num detail__value">{c.stats[stat]}</td>
      <td className="detail__barCell">
        <span className="bar" role="img" aria-label={t('detail.ivOf', { n: iv, max: IV_MAX })}>
          <span className="bar__fill bar__fill--iv" style={{ width: `${(iv / IV_MAX) * 100}%` }} />
        </span>
      </td>
      <td className={`num detail__iv${perfekt ? ' detail__iv--perfect' : ''}`}>{iv}</td>
      {evs && <td className="num detail__ev">{(c.evs?.[stat] ?? 0) > 0 ? c.evs![stat] : '—'}</td>}
    </tr>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <li className="detail__fact">
      <span className="detail__factLabel">{label}</span>
      <span className="detail__factValue num">{value}</span>
    </li>
  )
}

const datum = (ms: number): string =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(ms))

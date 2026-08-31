import { t } from '../i18n'
import { Screen } from '../ui/Screen'
import { CHANGELOG } from '../data/changelog'

/**
 * Was sich getan hat.
 *
 * Das Spiel aendert sich taeglich, und bisher merkte man das nur daran, dass
 * etwas anders war als gestern. Wer eine Aenderung gemeldet hat, will
 * ausserdem sehen, ob sie angekommen ist — genau darum wurde gebeten.
 *
 * Neueste zuerst, ein Abschnitt je Tag. Der Inhalt liegt in
 * `data/changelog.ts` und wird nicht nachgeladen: er aendert sich nur mit
 * einer neuen Fassung der App, also gehoert er auch hinein.
 */
export function ChangelogScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen eyebrow={t('changelog.eyebrow')} title={t('changelog.title')} onBack={onBack}>
      <main className="content">
        <p className="explain">{t('changelog.intro', { n: CHANGELOG.length })}</p>

        {CHANGELOG.map((eintrag) => (
          <section key={eintrag.date} className="section">
            <div className="log__head">
              <h2 className="log__title">{eintrag.title}</h2>
              <span className="log__date num">{datum(eintrag.date)}</span>
            </div>
            <ul className="log__list">
              {eintrag.items.map((zeile) => (
                <li key={zeile} className="log__item">{zeile}</li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </Screen>
  )
}

/** Ein ISO-Datum, wie man es hier schreibt. Mittags gelesen, damit keine
 *  Zeitzone den Tag um einen verschiebt. */
const datum = (iso: string): string =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(new Date(`${iso}T12:00:00`))

import { t } from '../i18n'

/**
 * Fehlermeldung aus Code und Detail.
 *
 * Die meisten Fehler brauchen nur ihren Code. Zwei Faelle nicht: die
 * Taktkontrolle nennt einen Grund, und fast jede Meldung will Zahlen aus dem
 * Detail einsetzen — "in 42 Sekunden" statt "in {retryAfter} Sekunden".
 */
export function errorText(code: string | null, detail: Record<string, unknown> = {}): string {
  if (!code) return ''
  const vars = Object.fromEntries(
    Object.entries(detail).filter(([, v]) => typeof v === 'string' || typeof v === 'number'),
  ) as Record<string, string | number>

  /*
   * Ein Grund im Detail schlaegt die allgemeine Meldung.
   *
   * "Das geht gerade nicht" ist keine Auskunft. Ein Mitspieler stand vor
   * genau diesem Satz, als ein vergessener Kampf das Heilen und den Ueberfall
   * blockierte — und konnte daraus nicht ableiten, was zu tun ist.
   */
  if ((code === 'rate_limited' || code === 'invalid_state') && typeof detail.reason === 'string') {
    /*
     * Zwei Stufen, nicht eine.
     *
     * Der Katalog kennt die meisten Gruende laengst unter ihrem blossen Namen
     * — `error.box_full` stand da, seit es Boxen gibt. Gesucht wurde aber nur
     * `error.invalid_state.box_full`, und weil es den nicht gab, bekam ein
     * Spieler mit voller Box "Das geht gerade nicht" zu lesen statt "Deine Box
     * ist voll". Von 95 Gruenden im Server traf das auf 74 zu.
     *
     * Deshalb erst der genaue Schluessel (dort steht der Text, der den Code
     * *und* den Grund kennt), dann der Grund allein, dann die allgemeine
     * Meldung.
     */
    for (const key of [`error.${code}.${detail.reason}`, `error.${detail.reason}`]) {
      const text = t(key, vars)
      // t() gibt bei fehlendem Schluessel den Schluessel zurueck.
      if (text !== key) return text
    }
  }
  return t(`error.${code}`, vars)
}

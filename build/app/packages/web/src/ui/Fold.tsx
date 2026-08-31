import type { ReactNode } from 'react'

/**
 * Eine Gruppe, die man auf- und zuklappen kann.
 *
 * Sechsundzwanzig Rezepte und sechzehn Projekte untereinander sind eine Liste,
 * durch die man scrollt, bis man findet, was man sucht. Aufgeteilt und
 * zugeklappt sind es acht Zeilen, von denen man eine oeffnet.
 *
 * Bewusst `<details>` statt eigener Zustand: die Auf-und-zu-Logik, die
 * Tastaturbedienung und die Ansage fuer Vorleseprogramme bringt der Browser
 * mit. Ein nachgebauter Knopf mit `useState` kann davon nichts.
 */
export function Fold(
  { title, count, note, open, children }:
  {
    title: string
    /** Wie viele Eintraege drin sind — sonst muss man aufklappen, um das zu sehen. */
    count: number
    /** Eine Zeile Zusatz, etwa wie viele davon gerade gehen. */
    note?: string
    open?: boolean
    children: ReactNode
  },
) {
  return (
    <details className="fold" open={open}>
      <summary className="fold__head">
        <span className="fold__title">{title}</span>
        {note && <span className="fold__note num">{note}</span>}
        <span className="fold__count num">{count}</span>
        <span className="fold__mark" aria-hidden="true">▾</span>
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  )
}

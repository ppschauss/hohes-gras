import type { ReactNode } from 'react'

interface CenterProps {
  glyph?: string
  title: string
  body?: string
  children?: ReactNode
}

/** One component for every "nothing to show right now" moment — loading,
 *  empty, blocked, broken. Using the same shell everywhere means these screens
 *  feel like part of the app rather than four different dead ends. */
export function CenterState({ glyph, title, body, children }: CenterProps) {
  return (
    <div className="center">
      <div className="center__inner">
        {glyph && <div className="center__glyph" aria-hidden="true">{glyph}</div>}
        <h2>{title}</h2>
        {body && <p className="center__body">{body}</p>}
        {children}
      </div>
    </div>
  )
}

/** Skeletons rather than a spinner: the layout does not jump when data lands,
 *  and the shape tells you what is coming. */
export function PartnerSkeleton() {
  return (
    <>
      <div className="skeleton skeleton--journey" />
      <div className="menu">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton skeleton--row" />)}
      </div>
    </>
  )
}

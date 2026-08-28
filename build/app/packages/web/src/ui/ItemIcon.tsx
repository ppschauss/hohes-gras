import { useState } from 'react'

/** Fallback glyph per category. Backgrounds and crafting materials have no
 *  upstream sprite, and an empty 36px hole reads as a broken image. */
const GLYPHS: Record<string, string> = {
  ball: '⚪', berry: '🍒', medicine: '💊', xp: '🍬', stone: '💎',
  material: '🧩', background: '🖼️', gear: '🎽', key: '🔑',
}

interface Props {
  src: string
  category: string
  size?: number
}

export function ItemIcon({ src, category, size = 36 }: Props) {
  const [failed, setFailed] = useState(false)

  if (failed || !src) {
    return (
      <span className="itemIcon itemIcon--glyph" style={{ width: size, height: size }} aria-hidden="true">
        {GLYPHS[category] ?? '📦'}
      </span>
    )
  }
  return (
    <img
      className="itemIcon"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

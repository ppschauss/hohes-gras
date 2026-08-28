import { useState } from 'react'

interface Props {
  src: string
  name: string
  kind?: string
  size?: number
  className?: string
}

/**
 * Das Bild eines Trainers — oder ein Ersatz, der aussieht, als wäre er so
 * gemeint.
 *
 * Das Content-Pack verweist für jeden Trainer auf `/media/trainers/<id>.png`.
 * Diese Dateien gibt es nicht: die PokéAPI liefert Pokémon-Sprites, aber keine
 * Trainerbilder. Bis dahin stand im Spiel ein kaputtes Bild — und ein kaputtes
 * Bild sieht nicht nach „fehlt noch" aus, sondern nach „kaputt".
 *
 * Der Ersatz ist deshalb kein grauer Kasten, sondern ein Emblem: Initiale,
 * Farbe nach Art des Gegners. Wer einen Rocket-Rüpel trifft, sieht Rot; ein
 * Arenaleiter ist gold, die Top Vier violett. Das trägt sogar Information, die
 * das Foto nicht hätte.
 */
const TINT: Record<string, string> = {
  gym: 'var(--gold)',
  elite: 'oklch(0.62 0.18 300)',
  champion: 'oklch(0.68 0.17 85)',
  rival: 'var(--accent)',
  trainer: 'var(--ink-muted)',
}

/** Ereignis-Gegner tragen ihre Zugehörigkeit im Namen, nicht in der Art. */
function tintOf(kind: string | undefined, name: string): string {
  if (/rocket|magma|aqua|rüpel|ruepel/i.test(name)) return 'var(--danger)'
  return TINT[kind ?? 'trainer'] ?? TINT.trainer!
}

export function TrainerAvatar({ src, name, kind, size = 96, className }: Props) {
  const [broken, setBroken] = useState(false)

  if (broken || !src) {
    const initial = [...name.trim()][0]?.toUpperCase() ?? '?'
    return (
      <span
        className={`avatar${className ? ` ${className}` : ''}`}
        style={{ width: size, height: size, '--avatar-tint': tintOf(kind, name) } as React.CSSProperties}
        role="img"
        aria-label={name}
      >
        <span className="avatar__initial" style={{ fontSize: Math.round(size * 0.42) }}>{initial}</span>
      </span>
    )
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
    />
  )
}

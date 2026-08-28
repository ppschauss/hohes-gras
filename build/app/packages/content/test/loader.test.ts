import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PackLoadError, loadPack } from '../src/loader.js'
import { Registry } from '../src/registry.js'

/** A minimal but complete pack. Tests mutate one thing at a time from here, so
 *  a failure names exactly which rule caught it. */
function basePack(): Record<string, unknown> {
  return {
    'types.json': [
      { id: 'fire', name: { de: 'Feuer' }, color: '#e62829' },
      { id: 'grass', name: { de: 'Pflanze' }, color: '#3fa129' },
    ],
    'type-chart.json': { fire: { grass: 2 }, grass: { fire: 0.5 } },
    'moves.json': [
      { id: 'ember', name: { de: 'Glut' }, type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25 },
      { id: 'vine-whip', name: { de: 'Rankenhieb' }, type: 'grass', category: 'physical', power: 45, accuracy: 100, pp: 25 },
    ],
    'species.json': [
      {
        id: 'flamon', dexNumber: 1, name: { de: 'Flamon' }, types: ['fire'],
        baseStats: { hp: 45, atk: 60, def: 40, spa: 70, spd: 50, spe: 65 },
        growthRate: 'medium_fast', catchRate: 45, baseXpYield: 64, hatchCycles: 20,
        eggGroups: ['field'], learnset: [{ moveId: 'ember', level: 1 }], evolutions: [],
        sprite: '/media/f.png', spriteShiny: '/media/f-s.png',
      },
      {
        id: 'leafon', dexNumber: 2, name: { de: 'Leafon' }, types: ['grass'],
        baseStats: { hp: 50, atk: 50, def: 55, spa: 60, spd: 60, spe: 45 },
        growthRate: 'medium_slow', catchRate: 45, baseXpYield: 64, hatchCycles: 20,
        eggGroups: ['plant'], learnset: [{ moveId: 'vine-whip', level: 1 }], evolutions: [],
        sprite: '/media/l.png', spriteShiny: '/media/l-s.png',
      },
    ],
    'items.json': [
      { id: 'poke-ball', name: { de: 'Ball' }, description: { de: 'Fängt.' }, category: 'ball', price: 30, sellPrice: 15, icon: '/media/b.png' },
    ],
    'regions.json': [{ id: 'testland', order: 1, name: { de: 'Testland' }, tagline: { de: 'Test' } }],
    'areas.json': [
      {
        id: 'route-1', regionId: 'testland', order: 1,
        name: { de: 'Route 1' }, description: { de: 'Weg.' },
        icon: '/media/a.png', background: '/media/ab.png',
        unlock: { previousAreaId: null, minCreaturesAtLevel: null },
        spawns: [{ speciesId: 'flamon', weight: 100, minLevel: 2, maxLevel: 5 }],
      },
    ],
    'trainers.json': [
      {
        id: 'rival', name: { de: 'Rivale' }, title: { de: 'Nervensäge' }, kind: 'rival',
        sprite: '/media/t.png', team: [{ speciesId: 'leafon', level: 5 }],
        rewardGold: 100, dialogue: { intro: { de: 'Hey' }, win: { de: 'Ha' }, lose: { de: 'Puh' } },
      },
    ],
    'badges.json': [
      { id: 'first-badge', name: { de: 'Erster Orden' }, description: { de: 'Test' }, icon: '/media/x.png', obedienceLevel: 20 },
    ],
    'pack.json': {
      id: 'test', name: 'Test', version: '1.0.0',
      starterSpeciesIds: ['flamon'], startingArea: 'route-1',
    },
  }
}

function writePack(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'))
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(value))
  }
  return dir
}

describe('loadPack', () => {
  it('laedt ein vollstaendiges Pack', async () => {
    const pack = await loadPack(writePack(basePack()))
    expect(pack.species.size).toBe(2)
    expect(pack.moves.size).toBe(2)
    expect(pack.trainers.size).toBe(1)
    expect(pack.badges.size).toBe(1)
    expect(pack.manifest.id).toBe('test')
  })

  it('setzt Vorgabewerte fuer optionale Felder', async () => {
    const pack = await loadPack(writePack(basePack()))
    const move = pack.moves.get('ember')!
    expect(move.priority).toBe(0)
    expect(move.critRate).toBe(0)
    expect(move.target).toBe('foe')
    expect(move.effect).toEqual({ kind: 'none' })
    expect(pack.species.get('flamon')!.rarity).toBe('common')
    expect(pack.areas.get('route-1')!.unlock.requiredBadgeIds).toEqual([])
  })

  it('meldet eine fehlende Datei statt halb zu laden', async () => {
    const files = basePack()
    delete files['moves.json']
    await expect(loadPack(writePack(files))).rejects.toThrow(PackLoadError)
  })

  it('faengt eine unbekannte Attacke im Lernset', async () => {
    const files = basePack()
    ;(files['species.json'] as any[])[0].learnset = [{ moveId: 'gibtsnicht', level: 1 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/unbekannte Attacke "gibtsnicht"/)
  })

  it('faengt eine Art ohne Attacke ab Level 1', async () => {
    const files = basePack()
    ;(files['species.json'] as any[])[0].learnset = [{ moveId: 'ember', level: 5 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/keine Attacke ab Level 1/)
  })

  it('faengt eine Entwicklung zu einer unbekannten Art', async () => {
    const files = basePack()
    ;(files['species.json'] as any[])[0].evolutions = [{ trigger: 'level', to: 'phantom', level: 16 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/Entwicklung zu unbekannter Art "phantom"/)
  })

  it('faengt einen fehlenden Entwicklungsstein', async () => {
    const files = basePack()
    ;(files['species.json'] as any[])[0].evolutions = [{ trigger: 'stone', to: 'leafon', itemId: 'feuerstein' }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/Entwicklungsstein "feuerstein" fehlt/)
  })

  it('faengt ein unbekanntes Spawn-Pokemon', async () => {
    const files = basePack()
    ;(files['areas.json'] as any[])[0].spawns = [{ speciesId: 'phantom', weight: 10, minLevel: 1, maxLevel: 3 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/unbekannte Art "phantom"/)
  })

  it('faengt vertauschte Levelgrenzen im Spawn', async () => {
    const files = basePack()
    ;(files['areas.json'] as any[])[0].spawns = [{ speciesId: 'flamon', weight: 10, minLevel: 9, maxLevel: 3 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/minLevel > maxLevel/)
  })

  it('faengt eine Spawn-Tabelle mit Gesamtgewicht 0', async () => {
    const files = basePack()
    ;(files['areas.json'] as any[])[0].spawns = [{ speciesId: 'flamon', weight: 0, minLevel: 1, maxLevel: 3 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/Gewichte summieren sich zu 0/)
  })

  it('faengt ein Trainerteam mit unbekannter Art', async () => {
    const files = basePack()
    ;(files['trainers.json'] as any[])[0].team = [{ speciesId: 'phantom', level: 5 }]
    await expect(loadPack(writePack(files))).rejects.toThrow(/unbekannte Art "phantom"/)
  })

  it('faengt einen Trainer mit unbekanntem Orden', async () => {
    const files = basePack()
    ;(files['trainers.json'] as any[])[0].badgeId = 'phantom-badge'
    await expect(loadPack(writePack(files))).rejects.toThrow(/unbekannter Orden "phantom-badge"/)
  })

  it('faengt ein Gebiet mit unbekannter Arena', async () => {
    const files = basePack()
    ;(files['areas.json'] as any[])[0].gymId = 'phantom-gym'
    await expect(loadPack(writePack(files))).rejects.toThrow(/unbekannte Arena "phantom-gym"/)
  })

  it('faengt einen Starter, den es nicht gibt', async () => {
    const files = basePack()
    ;(files['pack.json'] as any).starterSpeciesIds = ['phantom']
    await expect(loadPack(writePack(files))).rejects.toThrow(/Starter "phantom" existiert nicht/)
  })

  it('faengt ein Startgebiet, das es nicht gibt', async () => {
    const files = basePack()
    ;(files['pack.json'] as any).startingArea = 'nirgendwo'
    await expect(loadPack(writePack(files))).rejects.toThrow(/Startgebiet "nirgendwo" existiert nicht/)
  })

  it('verlangt einen deutschen Text in lokalisierten Feldern', async () => {
    const files = basePack()
    ;(files['species.json'] as any[])[0].name = { en: 'Flamon' }
    await expect(loadPack(writePack(files))).rejects.toThrow(/de/)
  })
})

describe('Registry', () => {
  it('rechnet Typeneffektivitaet multiplikativ', async () => {
    const r = new Registry(await loadPack(writePack(basePack())))
    expect(r.effectiveness('fire', ['grass'])).toBe(2)
    expect(r.effectiveness('grass', ['fire'])).toBe(0.5)
    expect(r.effectiveness('fire', ['grass', 'grass'])).toBe(4)
    // Fehlende Eintraege sind neutral, damit Packs klein bleiben.
    expect(r.effectiveness('fire', ['fire'])).toBe(1)
  })

  it('wirft bei unbekannten Ids statt undefined zurueckzugeben', async () => {
    const r = new Registry(await loadPack(writePack(basePack())))
    expect(() => r.species('phantom')).toThrow(/kennt species "phantom" nicht/)
    expect(r.trySpecies('phantom')).toBeUndefined()
  })

  it('liefert Lernset-Attacken bis zum gegebenen Level, neueste zuerst', async () => {
    const files = basePack()
    ;(files['species.json'] as any[])[0].learnset = [
      { moveId: 'ember', level: 1 }, { moveId: 'vine-whip', level: 10 },
    ]
    const r = new Registry(await loadPack(writePack(files)))
    expect(r.learnableAt('flamon', 5)).toEqual(['ember'])
    expect(r.learnableAt('flamon', 10)).toEqual(['vine-whip', 'ember'])
  })

  it('sortiert Gebiete nach Region, dann nach Reihenfolge', async () => {
    const files = basePack()
    files['regions.json'] = [
      { id: 'erste', order: 1, name: { de: 'Erste' }, tagline: { de: '' } },
      { id: 'zweite', order: 2, name: { de: 'Zweite' }, tagline: { de: '' } },
    ]
    const area = (id: string, regionId: string, order: number) => ({
      id, regionId, order,
      name: { de: id }, description: { de: id },
      icon: '/i.png', background: '/b.png',
      unlock: { previousAreaId: null, minCreaturesAtLevel: null },
      spawns: [{ speciesId: 'flamon', weight: 10, minLevel: 1, maxLevel: 3 }],
    })
    // Absichtlich verschachtelte Reihenfolgen: die zweite Region beginnt
    // wieder bei 1 und darf trotzdem nicht dazwischenrutschen.
    files['areas.json'] = [
      area('a2', 'erste', 2), area('b1', 'zweite', 1),
      area('a1', 'erste', 1), area('b2', 'zweite', 2),
    ]
    files['pack.json'] = { ...(files['pack.json'] as object), startingArea: 'a1' }
    const r = new Registry(await loadPack(writePack(files)))
    expect(r.allAreas.map((a) => a.id)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('faellt bei fehlender Sprache auf die Vorgabe zurueck', async () => {
    const r = new Registry(await loadPack(writePack(basePack())))
    const sp = r.species('flamon')
    expect(r.localized(sp.name, 'fr')).toBe('Flamon')
    expect(r.localized(sp.name, 'de')).toBe('Flamon')
  })
})

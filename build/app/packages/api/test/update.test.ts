import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseInfo, requestUpdate, UPDATE_FLAG } from '../src/services/hub.js'
import { findById } from '../src/repos/trainers.js'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

/**
 * Aktualisierung.
 *
 * Der Verbund *sagt* nur, welcher Stand aktuell ist; angestoßen wird nichts von
 * außen. Und der Knopf baut nicht selbst — er legt eine Marke ab, die ein
 * Wächter auf dem Wirt aufgreift. Genau diese zwei Zusagen werden hier geprüft.
 */
let h: TestApp
let adminId: string
let member: { token: string; id: string }

const setLatest = (sha: string, notes = '') =>
  h.ctx.db.prepare(
    `INSERT INTO hub_cache (key, payload, fetched_at) VALUES ('release', ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload`,
  ).run(JSON.stringify({ sha, notes }), Date.now())

const flagPath = () => join(h.ctx.config.DATA_DIR, UPDATE_FLAG)

beforeEach(async () => {
  h = await makeTestApp({ GIT_SHA: 'aaaaaaa' })
  const a = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  adminId = a.body.trainer.id
  member = await h.addTrainer(222, 'Misty')
})
afterEach(async () => { await h.close() })

describe('Standvergleich', () => {
  it('haelt sich heraus, solange der Verbund nichts gesagt hat', () => {
    const info = releaseInfo(h.ctx)
    expect(info.current).toBe('aaaaaaa')
    expect(info.latest).toBeNull()
    expect(info.outdated).toBe(false)
  })

  it('meldet veraltet, wenn der Verbund etwas anderes nennt', () => {
    setLatest('bbbbbbb', 'Kampfzone')
    const info = releaseInfo(h.ctx)
    expect(info.outdated).toBe(true)
    expect(info.notes).toBe('Kampfzone')
  })

  it('meldet aktuell, wenn der lange Hash mit dem kurzen anfaengt', () => {
    // Der Verbund kennt den vollen Hash, das Image nur die Kurzform.
    setLatest('aaaaaaa1234567890')
    expect(releaseInfo(h.ctx).outdated).toBe(false)
  })

  it('haelt sich ohne Git-Stand ganz heraus', async () => {
    await h.close()
    h = await makeTestApp()
    setLatest('bbbbbbb')
    // "unbekannt" heisst: aus einem Archiv gebaut. Dann waere ein
    // Update-Hinweis geraten statt gewusst.
    expect(releaseInfo(h.ctx).current).toBe('unbekannt')
    expect(releaseInfo(h.ctx).outdated).toBe(false)
  })
})

describe('Auslösen', () => {
  it('legt eine Marke ab und baut nichts selbst', () => {
    setLatest('bbbbbbb')
    const info = requestUpdate(h.ctx, findById(h.ctx.db, adminId)!)
    expect(info.pending).toBe(true)
    expect(existsSync(flagPath())).toBe(true)
    // In der Marke steht, wohin es gehen soll — mehr passiert hier nicht.
    expect(readFileSync(flagPath(), 'utf8').trim()).toBe('bbbbbbb')
  })

  it('laesst nur den Betreiber ausloesen', () => {
    /*
     * Die Routen unter /api/admin sind nicht durch eine Schicht davor
     * geschuetzt, sondern durch `requireAdmin` im Dienst. Ohne diese Zeile
     * koennte jeder Spieler die Installation neu bauen lassen.
     */
    setLatest('bbbbbbb')
    expect(() => requestUpdate(h.ctx, findById(h.ctx.db, member.id)!)).toThrow()
    expect(existsSync(flagPath())).toBe(false)
  })

  it('weist ab, wenn es nichts zu tun gibt', () => {
    expect(() => requestUpdate(h.ctx, findById(h.ctx.db, adminId)!)).toThrow()
    expect(existsSync(flagPath())).toBe(false)
  })

  it('gilt auch ueber die Route', async () => {
    setLatest('bbbbbbb')
    h.resetRateLimits()
    const fremd = await h.post('/api/admin/update', {}, member.token)
    expect(fremd.status).toBe(403)
    expect(existsSync(flagPath())).toBe(false)
  })
})

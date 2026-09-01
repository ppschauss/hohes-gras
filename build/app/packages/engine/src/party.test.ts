import { describe, expect, it } from 'vitest'
import { LEGENDARY_TEAM_LIMIT, splitParty } from './party.js'

interface M { id: string; leg: boolean; kraft: number }
const m = (id: string, leg: boolean, kraft: number): M => ({ id, leg, kraft })
const teile = (team: M[]) => splitParty(team, (x) => x.leg, (x) => x.kraft)

describe('Ein Legendaeres im Kampf', () => {
  it('laesst ein Team ohne Legendaere unangetastet', () => {
    const team = [m('a', false, 500), m('b', false, 400)]
    expect(teile(team)).toEqual({ antreten: team, bank: [] })
  })

  it('laesst genau eines durch', () => {
    const team = [m('a', false, 500), m('mewtu', true, 900)]
    expect(teile(team).bank).toEqual([])
  })

  it('schickt bei mehreren nur das schwaechste ins Feld', () => {
    /*
     * Das *schwaechste*, nicht das staerkste — genau darin liegt die Regel.
     * Wer stapelt, hebt mit dem Durchschnitt die Gegnerstufe und behaelt
     * dafuer sein schwaechstes Legendaeres. Das Stapeln bestraft sich selbst.
     */
    const team = [m('mewtu', true, 900), m('gewoehnlich', false, 400), m('mew', true, 700)]
    const { antreten, bank } = teile(team)

    expect(antreten.map((x) => x.id)).toEqual(['gewoehnlich', 'mew'])
    expect(bank.map((x) => x.id)).toEqual(['mewtu'])
  })

  it('behaelt die Reihenfolge des Teams', () => {
    // Sie entscheidet, wer den Kampf eroeffnet — eine Umsortierung waere eine
    // zweite, unausgesprochene Aenderung am Team.
    const team = [m('mew', true, 700), m('a', false, 400), m('lugia', true, 800), m('b', false, 300)]
    expect(teile(team).antreten.map((x) => x.id)).toEqual(['mew', 'a', 'b'])
  })

  it('behaelt bei Gleichstand das vordere', () => {
    // Eine Regel, die vom Zufall abhinge, koennte der Spieler nicht nachvollziehen.
    const team = [m('erstes', true, 700), m('zweites', true, 700)]
    expect(teile(team).antreten.map((x) => x.id)).toEqual(['erstes'])
  })

  it('laesst notfalls nur ein einziges Mitglied uebrig', () => {
    // Ein Team aus lauter Legendaeren tritt zu eint an. Kein Sonderfall:
    // genau das ist der Preis.
    const team = [m('a', true, 900), m('b', true, 800), m('c', true, 700)]
    const { antreten, bank } = teile(team)
    expect(antreten.map((x) => x.id)).toEqual(['c'])
    expect(bank).toHaveLength(2)
  })

  it('laesst das uebergebene Team unangetastet', () => {
    /*
     * Darauf beruht die halbe Regel.
     *
     * Die Gegner richten sich nach dem Durchschnitt des *ganzen* Teams, auch
     * nach den Zuschauern. Der Aufrufer rechnet ihn deshalb ueber die
     * urspruengliche Liste — und die muss danach noch dieselbe sein. Eine
     * Funktion, die nebenbei sortiert oder loescht, machte das Stapeln
     * unbemerkt wieder billig.
     */
    const team = [m('mewtu', true, 900), m('a', false, 400), m('mew', true, 700)]
    const vorher = team.map((x) => x.id)
    teile(team)
    expect(team.map((x) => x.id)).toEqual(vorher)
    expect(team).toHaveLength(3)
  })

  it('haelt die Grenze bei eins', () => {
    expect(LEGENDARY_TEAM_LIMIT).toBe(1)
  })
})

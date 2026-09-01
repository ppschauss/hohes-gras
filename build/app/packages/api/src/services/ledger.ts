import type { AppContext } from '../context.js'
import type { Herkunft } from '../repos/acquisitions.js'

/**
 * Die Herkunft einer Zuwendung, kurz notiert.
 *
 * `von(ctx, 'safari.catch')` statt `{ source: 'safari.catch', release:
 * ctx.config.GIT_SHA }` an fuenfundfuenfzig Stellen. Der Build kommt immer aus
 * derselben Quelle — ihn je Aufruf hinzuschreiben waere fuenfundfuenfzig
 * Gelegenheiten, ihn zu vergessen oder falsch zu setzen.
 */
export const von = (ctx: AppContext, source: string): Herkunft =>
  ({ source, release: ctx.config.GIT_SHA })

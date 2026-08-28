/** Every rejection the client can meaningfully react to has a code here.
 *  The API never leaks internal messages; it returns one of these plus an
 *  optional detail object the UI can interpolate into a localized string. */
export const ERROR_CODES = [
  'unauthorized',
  'invite_required',
  'invite_invalid',
  'banned',
  'rate_limited',
  'not_found',
  // Bleibt fuer die wenigen echten Kontingente, die es noch gibt (Angriffe je
  // Raid). Pflege, Erkundung und Duelle laufen ueber Energie statt ueber Tage.
  'daily_limit_reached',
  'insufficient_funds',
  'insufficient_energy',
  'insufficient_items',
  'invalid_state',
  'not_owner',
  'validation_failed',
  'content_unavailable',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail: Record<string, unknown> = {},
    readonly httpStatus = 400,
  ) {
    super(code)
    this.name = 'GameError'
  }
}

export const unauthorized = (detail = {}) => new GameError('unauthorized', detail, 401)
export const notFound = (detail = {}) => new GameError('not_found', detail, 404)
export const invalidState = (detail = {}) => new GameError('invalid_state', detail, 409)

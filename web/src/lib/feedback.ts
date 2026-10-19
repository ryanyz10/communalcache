import { ApiError } from './api'

export function transientActionFailure(error: unknown) {
  if (error instanceof ApiError) return error.status >= 500 && !['limit_reached', 'limits_unavailable'].includes(error.code)
  // Unknown errors may be field or capability guidance; only known transport failures move.
  return error instanceof TypeError || error instanceof SyntaxError
}

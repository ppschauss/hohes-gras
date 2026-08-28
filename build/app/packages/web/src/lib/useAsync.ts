import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFailure } from './api'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Re-run the loader. Safe to call from event handlers. */
  reload: () => void
  /** Replace the data without a round trip — for endpoints that already
   *  return the new state after a mutation. */
  set: (value: T) => void
}

/**
 * Load data once and expose a reload.
 *
 * Deliberately not a full query cache: every screen here reads one endpoint,
 * mutations return the new state, and the data is per-player. A cache layer
 * would add invalidation bugs without saving a single request.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Guards against a slow first response overwriting a newer one.
  const generation = useRef(0)

  const run = useCallback(() => {
    const mine = ++generation.current
    setLoading(true)
    setError(null)
    loader()
      .then((value) => { if (mine === generation.current) { setData(value); setLoading(false) } })
      .catch((err: unknown) => {
        if (mine !== generation.current) return
        setError(err instanceof ApiFailure ? err.code : 'network')
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
    return () => { generation.current++ }
  }, [run])

  return { data, loading, error, reload: run, set: setData }
}

/** Wrap a mutation so the button can show a spinner and errors surface once. */
export function useAction(): {
  busy: boolean
  error: string | null
  detail: Record<string, unknown>
  run: <T>(fn: () => Promise<T>, onDone?: (value: T) => void) => Promise<void>
  clearError: () => void
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown>>({})

  const run = useCallback(async <T,>(fn: () => Promise<T>, onDone?: (value: T) => void) => {
    setBusy(true)
    setError(null)
    try {
      const value = await fn()
      onDone?.(value)
    } catch (err) {
      if (err instanceof ApiFailure) { setError(err.code); setDetail(err.detail) }
      else { setError('network'); setDetail({}) }
    } finally {
      setBusy(false)
    }
  }, [])

  return { busy, error, detail, run, clearError: () => setError(null) }
}

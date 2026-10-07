import { GithubError } from './errors'
import type { GithubClock } from './types'

export const systemClock: GithubClock = {
  now: () => Date.now(),
  sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new GithubError('cancelled', 'Cancelled'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        reject(new GithubError('cancelled', 'Cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  },
}

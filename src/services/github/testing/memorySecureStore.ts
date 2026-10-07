import type { GithubSecureStore } from '../types'

export function createMemorySecureStore(): GithubSecureStore & {
  peek(account: string): string | null
  dump(): Record<string, string>
} {
  const values = new Map<string, string>()
  return {
    has: async (account) => values.has(account),
    get: async (account) => values.get(account) ?? null,
    set: async (account, value) => { values.set(account, value) },
    delete: async (account) => { values.delete(account) },
    peek: (account) => values.get(account) ?? null,
    dump: () => Object.fromEntries(values),
  }
}

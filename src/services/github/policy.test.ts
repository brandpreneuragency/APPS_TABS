import { describe, expect, it } from 'vitest'
import { GithubError } from './errors'
import { inspectGithubRequest, inspectGithubUrl, nextLink, readRateLimit } from './policy'
import { createPolicyTransport } from './transport'
import { jsonResponse } from './testing/fixtureTransport'
import { GITHUB_VERIFICATION_URI } from './types'
import { assertVerificationUri } from './policy'

describe('GitHub transport policy', () => {
  it('allows only github.com OAuth posts and api.github.com reads', () => {
    expect(() => inspectGithubUrl('https://github.com/login/device/code', 'POST')).not.toThrow()
    expect(() => inspectGithubUrl('https://api.github.com/user/repos?affiliation=owner&per_page=100&page=1', 'GET')).not.toThrow()
    expect(() => inspectGithubUrl('https://raw.githubusercontent.com/octocat/notes/main/README.md', 'GET')).toThrow(GithubError)
    expect(() => inspectGithubUrl('https://github.example.com/api/v3/user', 'GET')).toThrow(GithubError)
    expect(() => inspectGithubUrl('https://api.github.com/orgs/acme/repos', 'GET')).toThrow(GithubError)
    expect(() => inspectGithubUrl('https://api.github.com/user/repos?access_token=gho_secret', 'GET')).toThrow(GithubError)
  })

  it('allows repository create, exact delete, and receive-pack, and rejects other routes', () => {
    expect(() => inspectGithubUrl('https://api.github.com/repos/octocat/notes', 'DELETE')).not.toThrow()
    expect(() => inspectGithubUrl('https://api.github.com/user/repos', 'POST')).not.toThrow()
    expect(() => inspectGithubUrl('https://github.com/octocat/notes.git/info/refs?service=git-receive-pack', 'GET')).not.toThrow()
    expect(() => inspectGithubUrl('https://github.com/octocat/notes.git/git-receive-pack', 'POST')).not.toThrow()
    expect(() => inspectGithubUrl('https://api.github.com/graphql', 'POST')).toThrow(GithubError)
    expect(() => inspectGithubUrl('https://github.com/octocat/notes/settings', 'GET')).toThrow(GithubError)
    expect(() => inspectGithubUrl('https://api.github.com/repos/octocat/notes/contents/a', 'DELETE')).toThrow(GithubError)
    expect(() => inspectGithubUrl('https://evil.example/git-receive-pack', 'POST')).toThrow(GithubError)
  })

  it('rejects a client secret and caller-supplied authorization', () => {
    expect(() => inspectGithubRequest({
      method: 'POST',
      url: 'https://github.com/login/oauth/access_token',
      headers: {},
      body: 'client_id=abc&client_secret=super',
    })).toThrowError(expect.objectContaining({ code: 'client_secret_forbidden' }))
    expect(() => inspectGithubRequest({
      method: 'GET',
      url: 'https://api.github.com/user',
      headers: { Authorization: 'Bearer gho_secret' },
    })).toThrowError(expect.objectContaining({ code: 'token_leak_rejected' }))
  })

  it('accepts only the fixed device verification URI', () => {
    expect(() => assertVerificationUri(GITHUB_VERIFICATION_URI)).not.toThrow()
    expect(() => assertVerificationUri('https://github.com/login/device?user_code=WDJB-MJHT')).toThrow(GithubError)
    expect(() => assertVerificationUri('https://evil.example/login/device')).toThrow(GithubError)
  })

  it('parses pagination and rate-limit headers without following another host', () => {
    expect(nextLink('<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=3>; rel="last"'))
      .toBe('https://api.github.com/user/repos?page=2')
    expect(readRateLimit(429, { 'retry-after': '2' })).toEqual({ limited: true, retryAfterMs: 2000 })
    expect(readRateLimit(403, { 'x-ratelimit-remaining': '0' }).limited).toBe(true)
    expect(readRateLimit(403, {}).limited).toBe(false)
  })

  it('does not follow a redirect or apply a late response after cancellation', async () => {
    const calls: string[] = []
    const transport = createPolicyTransport({
      request: (input) => {
        calls.push(input.url)
        return Promise.resolve(jsonResponse(302, {}, { location: 'https://evil.example/steal' }))
      },
    }, async () => 'session')
    await expect(transport.request({
      method: 'GET',
      url: 'https://api.github.com/user',
      headers: { Accept: 'application/vnd.github+json' },
      auth: 'bearer',
      timeoutMs: 1000,
    }, new AbortController().signal)).rejects.toMatchObject({ code: 'redirect_rejected' })
    expect(calls).toEqual(['https://api.github.com/user'])

    let release: (value: ReturnType<typeof jsonResponse>) => void = () => undefined
    const held = new Promise<ReturnType<typeof jsonResponse>>((resolve) => { release = resolve })
    const late = createPolicyTransport({ request: () => held }, async () => 'session')
    const controller = new AbortController()
    const pending = late.request({
      method: 'GET',
      url: 'https://api.github.com/user',
      headers: {},
      auth: 'bearer',
      timeoutMs: 5000,
    }, controller.signal)
    controller.abort()
    release(jsonResponse(200, { id: 1 }))
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })
})

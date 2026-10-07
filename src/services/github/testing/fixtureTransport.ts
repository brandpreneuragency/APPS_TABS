import type { GithubTransport, GithubTransportRequest, GithubTransportResponse } from '../types'

export function createFixtureTransport(
  handler: (request: GithubTransportRequest, signal: AbortSignal) => GithubTransportResponse | Promise<GithubTransportResponse>,
): GithubTransport {
  return {
    request(request, signal) {
      return Promise.resolve(handler(request, signal))
    },
  }
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): GithubTransportResponse {
  return { status, headers, bodyText: JSON.stringify(body) }
}

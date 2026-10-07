import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import {
  buildInitialReceivePack,
  emptyRefAdvertisement,
  EMPTY_REPO_REJECTED_ENDPOINTS,
  parseReceivePackResult,
  parseRefAdvertisement,
  receivePackOk,
  ZERO_SHA,
} from './gitPack'

function inflateObject(pack: Uint8Array, offset: number): { type: number; content: Uint8Array; next: number } {
  let cursor = offset
  let byte = pack[cursor]
  cursor += 1
  const type = (byte >> 4) & 7
  let size = byte & 0x0f
  let shift = 4
  while (byte & 0x80) {
    byte = pack[cursor]
    cursor += 1
    size |= (byte & 0x7f) << shift
    shift += 7
  }
  const compressed = pack.subarray(cursor)
  const content = inflateSync(compressed)
  return { type, content: new Uint8Array(content).subarray(0, size), next: cursor + compressed.length }
}

describe('empty repository receive-pack', () => {
  it('does not treat rejected GitHub endpoints as a successful first ref', () => {
    expect(EMPTY_REPO_REJECTED_ENDPOINTS.map((item) => item.method + ' ' + item.path)).toEqual([
      'POST /repos/{owner}/{repo}/git/refs',
      'POST /graphql createCommitOnBranch',
    ])
  })

  it('builds one undeltified pack with a zero old SHA and no force', async () => {
    const body = await buildInitialReceivePack({
      files: [
        { path: 'LEFT.md', bytes: new TextEncoder().encode('left') },
        { path: 'dir/RIGHT.md', bytes: new TextEncoder().encode('right') },
      ],
      message: 'save notes\n\nTABS-Commit-Id: ' + 'f'.repeat(32) + '\n',
      authorName: 'octocat',
      authorEmail: '1001+octocat@users.noreply.github.com',
      authoredAt: 1_000_000,
      ref: 'main',
    })
    const raw = atob(body.bodyBase64)
    expect(raw.includes(`${ZERO_SHA} ${body.commitSha} refs/heads/main`)).toBe(true)
    expect(raw.includes('report-status')).toBe(true)
    expect(raw.includes(' force')).toBe(false)
    expect(raw.includes('+refs/')).toBe(false)
    const packAt = raw.indexOf('PACK')
    expect(packAt).toBeGreaterThan(0)
    const pack = body.body.subarray(packAt)
    expect(String.fromCharCode(...pack.subarray(0, 4))).toBe('PACK')
    expect(pack[7]).toBe(2)
    const count = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11]
    expect(count).toBe(5)
    const trailer = pack.subarray(pack.length - 20)
    const hashed = createHash('sha1').update(pack.subarray(0, pack.length - 20)).digest()
    expect(Buffer.from(trailer).equals(hashed)).toBe(true)
    const first = inflateObject(pack, 12)
    expect([1, 2, 3]).toContain(first.type)
    expect(first.content.length).toBeGreaterThan(0)
  })

  it('parses an empty advertisement and a confirmed report without inventing a ref', () => {
    expect(parseRefAdvertisement(emptyRefAdvertisement())).toEqual({ refs: [], empty: true })
    expect(parseReceivePackResult(receivePackOk('main'), 'main')).toMatchObject({ unpackOk: true, refOk: true })
    expect(parseReceivePackResult('0000')).toMatchObject({ unpackOk: false, refOk: false })
  })
})

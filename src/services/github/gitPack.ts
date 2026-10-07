/**
 * In-memory Git pack and smart-HTTP receive-pack body.
 *
 * Verified 5 October 2026:
 * - docs.github.com REST git/refs: a reference cannot be created in an empty
 *   repository (a repository without branches), even if a commit SHA exists.
 * - GraphQL createCommitOnBranch requires expectedHeadOid and an existing
 *   branch. It does not create the first ref.
 * - Contents PUT creates one commit per file. Several of those would violate
 *   the single-commit rule.
 * - The first multi-file commit is the same upload `git push` uses:
 *   GET https://github.com/{owner}/{repo}.git/info/refs?service=git-receive-pack
 *   POST https://github.com/{owner}/{repo}.git/git-receive-pack
 *   with a zero old SHA, one pack, and no force capability.
 */

import { GithubError } from './errors'
import { safeRef } from './identity'

export const ZERO_SHA = '0'.repeat(40)
export const EMPTY_REPO_REJECTED_ENDPOINTS = [
  {
    method: 'POST',
    path: '/repos/{owner}/{repo}/git/refs',
    reason: 'GitHub rejects creating a reference in an empty repository.',
  },
  {
    method: 'POST',
    path: '/graphql createCommitOnBranch',
    reason: 'createCommitOnBranch requires an existing branch oid and cannot create the first ref.',
  },
] as const

const textEncoder = new TextEncoder()

export interface PackFile {
  path: string
  bytes: Uint8Array
}

export interface InitialCommitInput {
  files: PackFile[]
  message: string
  authorName: string
  authorEmail: string
  authoredAt: number
  ref: string
}

export interface ReceivePackBody {
  commitSha: string
  body: Uint8Array
  bodyBase64: string
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{40}$/.test(hex)) throw new GithubError('validation', 'Git object id is not usable')
  const out = new Uint8Array(20)
  for (let index = 0; index < 20; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  return out
}

async function sha1(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-1', copy.buffer)
  return new Uint8Array(digest)
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

async function rawDeflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'function') {
    throw new GithubError('github_unavailable', 'Browser compression is unavailable')
  }
  const stream = new CompressionStream('deflate-raw')
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  const writing = (async () => {
    await writer.write(copy)
    await writer.close()
  })()
  const reading = (async () => {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      if (next.value) chunks.push(next.value)
    }
  })()
  await Promise.all([writing, reading])
  return concat(chunks)
}

export async function zlibWrap(data: Uint8Array): Promise<Uint8Array> {
  const raw = await rawDeflate(data)
  const checksum = adler32(data)
  const out = new Uint8Array(2 + raw.length + 4)
  out[0] = 0x78
  out[1] = 0x9c
  out.set(raw, 2)
  out[out.length - 4] = (checksum >>> 24) & 0xff
  out[out.length - 3] = (checksum >>> 16) & 0xff
  out[out.length - 2] = (checksum >>> 8) & 0xff
  out[out.length - 1] = checksum & 0xff
  return out
}

async function hashObject(type: 'blob' | 'tree' | 'commit', content: Uint8Array): Promise<{ sha: string; content: Uint8Array }> {
  const header = textEncoder.encode(`${type} ${content.length}\0`)
  const digest = await sha1(concat([header, content]))
  return { sha: bytesToHex(digest), content }
}

function encodePackHeader(type: number, size: number): Uint8Array {
  const bytes: number[] = []
  let first = (type << 4) | (size & 0x0f)
  let rest = size >> 4
  if (rest > 0) first |= 0x80
  bytes.push(first)
  while (rest > 0) {
    let next = rest & 0x7f
    rest >>= 7
    if (rest > 0) next |= 0x80
    bytes.push(next)
  }
  return Uint8Array.from(bytes)
}

function treeEntry(mode: string, name: string, sha: Uint8Array): Uint8Array {
  return concat([textEncoder.encode(`${mode} ${name}\0`), sha])
}

interface TreeNode {
  files: Map<string, Uint8Array>
  dirs: Map<string, TreeNode>
}

function insertFile(root: TreeNode, path: string, bytes: Uint8Array): void {
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new GithubError('validation', 'A commit path is not usable')
  }
  let node = root
  for (const part of parts.slice(0, -1)) {
    const existing = node.files.get(part)
    if (existing) throw new GithubError('validation', 'A file and directory cannot share a path')
    let child = node.dirs.get(part)
    if (!child) {
      child = { files: new Map(), dirs: new Map() }
      node.dirs.set(part, child)
    }
    node = child
  }
  const name = parts[parts.length - 1]
  if (!name || node.dirs.has(name) || node.files.has(name)) {
    throw new GithubError('validation', 'Commit paths overlap')
  }
  node.files.set(name, bytes)
}

function gitCompare(left: { name: string; tree: boolean }, right: { name: string; tree: boolean }): number {
  const a = textEncoder.encode(left.tree ? `${left.name}/` : left.name)
  const b = textEncoder.encode(right.tree ? `${right.name}/` : right.name)
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}

interface PackedObject {
  type: number
  content: Uint8Array
}

async function packTree(node: TreeNode, objects: PackedObject[]): Promise<string> {
  const entries: Array<{ name: string; tree: boolean; mode: string; sha: string }> = []
  for (const [name, child] of node.dirs) {
    entries.push({ name, tree: true, mode: '40000', sha: await packTree(child, objects) })
  }
  for (const [name, bytes] of node.files) {
    const blob = await hashObject('blob', bytes)
    objects.push({ type: 3, content: blob.content })
    entries.push({ name, tree: false, mode: '100644', sha: blob.sha })
  }
  entries.sort(gitCompare)
  const raw = concat(entries.map((entry) => treeEntry(entry.mode, entry.name, hexToBytes(entry.sha))))
  const tree = await hashObject('tree', raw)
  objects.push({ type: 2, content: tree.content })
  return tree.sha
}

function identityField(value: string, label: string): string {
  if (!value || /[<>\r\n\0]/.test(value)) throw new GithubError('validation', `${label} is not usable in a Git commit`)
  return value
}

function commitBytes(treeSha: string, message: string, authorName: string, authorEmail: string, authoredAt: number): Uint8Array {
  const seconds = Math.floor(authoredAt / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) throw new GithubError('validation', 'Commit time is not usable')
  const name = identityField(authorName, 'Author name')
  const email = identityField(authorEmail, 'Author email')
  const text = message.endsWith('\n') ? message : `${message}\n`
  if (text.includes('\0')) throw new GithubError('validation', 'Commit message is not usable')
  return textEncoder.encode(
    `tree ${treeSha}\n` +
    `author ${name} <${email}> ${seconds} +0000\n` +
    `committer ${name} <${email}> ${seconds} +0000\n` +
    `\n${text}`,
  )
}

export function pktLine(payload: string): string {
  const size = textEncoder.encode(payload).length + 4
  if (size > 65520) throw new GithubError('validation', 'Git protocol line is too long')
  return size.toString(16).padStart(4, '0') + payload
}

export function emptyRefAdvertisement(): string {
  return `${pktLine('# service=git-receive-pack\n')}00000000`
}

export function receivePackOk(ref: string): string {
  const name = safeRef(ref)
  return `${pktLine('unpack ok\n')}${pktLine(`ok refs/heads/${name}\n`)}0000`
}

export function advertisedRef(ref: string, sha: string): string {
  return `${pktLine('# service=git-receive-pack\n')}0000${pktLine(`${sha} refs/heads/${safeRef(ref)}\n`)}0000`
}

function readPktLines(bytes: Uint8Array): string[] {
  const lines: string[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw new GithubError('validation', 'Git protocol packet is truncated')
    let sizeHex: string
    try {
      sizeHex = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + 4))
    } catch {
      throw new GithubError('validation', 'Git protocol packet length is malformed')
    }
    if (!/^[0-9a-fA-F]{4}$/.test(sizeHex)) throw new GithubError('validation', 'Git protocol packet length is malformed')
    const size = Number.parseInt(sizeHex, 16)
    if (size === 0) {
      offset += 4
      continue
    }
    if (size < 4 || offset + size > bytes.length) throw new GithubError('validation', 'Git protocol packet is truncated')
    let payload = bytes.subarray(offset + 4, offset + size)
    if (payload.length > 0 && payload[0] >= 1 && payload[0] <= 3) payload = payload.subarray(1)
    const nul = payload.indexOf(0)
    if (nul >= 0) payload = payload.subarray(0, nul)
    if (payload.length > 0 && payload[payload.length - 1] === 0x0a) payload = payload.subarray(0, payload.length - 1)
    try {
      lines.push(new TextDecoder('utf-8', { fatal: true }).decode(payload))
    } catch {
      throw new GithubError('validation', 'Git protocol packet is not valid UTF-8')
    }
    offset += size
  }
  return lines
}

export function parseRefAdvertisementBytes(bytes: Uint8Array): { refs: Array<{ name: string; sha: string }>; empty: boolean } {
  const header = textEncoder.encode('# service=git-receive-pack')
  const found = bytes.some((_, index) => header.every((byte, offset) => bytes[index + offset] === byte))
  if (!found) throw new GithubError('validation', 'GitHub did not return a receive-pack advertisement')
  const refs: Array<{ name: string; sha: string }> = []
  for (const line of readPktLines(bytes)) {
    const match = line.match(/^([0-9a-f]{40}) (refs\/heads\/\S+)$/)
    if (!match) continue
    if (match[1] === ZERO_SHA) continue
    refs.push({ sha: match[1], name: match[2] })
  }
  return { refs, empty: refs.length === 0 }
}

export function parseRefAdvertisement(body: string): { refs: Array<{ name: string; sha: string }>; empty: boolean } {
  return parseRefAdvertisementBytes(textEncoder.encode(body))
}

export function parseReceivePackResult(body: string, expectedRef?: string): { unpackOk: boolean; refOk: boolean; message: string } {
  const lines = readPktLines(textEncoder.encode(body))
  const unpackOk = lines.some((line) => line.trim() === 'unpack ok')
  const target = expectedRef ? `ok refs/heads/${safeRef(expectedRef)}` : null
  const refOk = target
    ? lines.some((line) => line.trim() === target)
    : lines.some((line) => /^ok refs\/heads\/\S+$/.test(line.trim()))
  const otherRef = target
    ? lines.find((line) => line.trim().startsWith('ok refs/heads/') && line.trim() !== target)
    : undefined
  const rejected = lines.find((line) => line.trim().startsWith('ng '))
  return {
    unpackOk,
    refOk: Boolean(refOk) && !otherRef,
    message: rejected?.trim() ?? (otherRef ? 'GitHub confirmed a different ref' : unpackOk && refOk ? 'ok' : 'GitHub did not confirm the receive-pack'),
  }
}

export async function buildInitialReceivePack(input: InitialCommitInput): Promise<ReceivePackBody> {
  const ref = safeRef(input.ref)
  if (input.files.length === 0) throw new GithubError('validation', 'The first commit needs at least one file')
  const root: TreeNode = { files: new Map(), dirs: new Map() }
  for (const file of input.files) insertFile(root, file.path, file.bytes)
  const objects: PackedObject[] = []
  const treeSha = await packTree(root, objects)
  const commit = await hashObject('commit', commitBytes(treeSha, input.message, input.authorName, input.authorEmail, input.authoredAt))
  objects.push({ type: 1, content: commit.content })
  const packed: Uint8Array[] = [textEncoder.encode('PACK'), uint32(2), uint32(objects.length)]
  for (const object of objects) {
    packed.push(encodePackHeader(object.type, object.content.length))
    packed.push(await zlibWrap(object.content))
  }
  const withoutTrailer = concat(packed)
  const trailer = await sha1(withoutTrailer)
  const pack = concat([withoutTrailer, trailer])
  const command = pktLine(`${ZERO_SHA} ${commit.sha} refs/heads/${ref}\0report-status agent=tabs\n`)
  if (command.includes(' force') || command.includes('+refs/')) {
    throw new GithubError('validation', 'The initial push cannot force a ref')
  }
  const body = concat([textEncoder.encode(`${command}0000`), pack])
  return { commitSha: commit.sha, body, bodyBase64: bytesToBase64(body) }
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  out[0] = (value >>> 24) & 0xff
  out[1] = (value >>> 16) & 0xff
  out[2] = (value >>> 8) & 0xff
  out[3] = value & 0xff
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

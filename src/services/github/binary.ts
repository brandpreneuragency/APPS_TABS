/** Byte classification for GitHub blobs. Images and PDFs stay bytes, never text. */

export type GithubMediaKind = 'text' | 'image' | 'pdf' | 'binary'

const TEXT_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'yml', 'yaml', 'xml', 'csv', 'tsv', 'svg',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'html', 'htm',
  'rs', 'py', 'go', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb',
  'php', 'sh', 'bash', 'zsh', 'toml', 'ini', 'env', 'gitignore', 'gitattributes',
  'lock', 'sql', 'graphql', 'vue', 'svelte',
])

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'pdf', 'zip', 'gz', 'tgz',
  '7z', 'rar', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'mp4', 'wav', 'webm',
  'exe', 'dll', 'bin', 'wasm', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
])

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function decodeBase64(value: string): Uint8Array {
  const cleaned = value.replace(/\s/g, '')
  let binary = ''
  try {
    binary = atob(cleaned)
  } catch {
    throw new Error('invalid base64')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function textToBase64(text: string): string {
  return encodeBase64(new TextEncoder().encode(text))
}

export function base64ToText(value: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(decodeBase64(value))
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}

function isStrictUtf8Text(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte === 0 || byte === 0x7f) return false
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return false
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export function classifyBytes(bytes: Uint8Array, path = ''): GithubMediaKind {
  const extension = extensionOf(path)
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) || extension === 'pdf') return 'pdf'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image'
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'].includes(extension)) return 'image'
  if (BINARY_EXTENSIONS.has(extension)) return 'binary'
  if (!isStrictUtf8Text(bytes)) return 'binary'
  if (extension && !TEXT_EXTENSIONS.has(extension) && extension !== 'dat' && extension !== 'bin') {
    return 'text'
  }
  return 'text'
}

export function isTextMedia(kind: GithubMediaKind): boolean {
  return kind === 'text'
}

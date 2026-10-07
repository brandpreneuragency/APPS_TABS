import { GithubError } from './errors'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new GithubError('persistence', 'Secure cache encryption is unavailable')
  return globalThis.crypto.subtle
}

export function createCacheKey(): string {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32))
  return bytesToBase64(raw)
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return subtle().importKey('raw', base64ToBytes(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function sealJson(keyB64: string, value: unknown): Promise<{ iv: string; ciphertext: string }> {
  const key = await importKey(keyB64)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const cipher = await subtle().encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(cipher)) }
}

export async function openJson(keyB64: string, iv: string, ciphertext: string): Promise<unknown> {
  try {
    const key = await importKey(keyB64)
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ciphertext))
    return JSON.parse(new TextDecoder().decode(plain)) as unknown
  } catch (error) {
    if (error instanceof GithubError) throw error
    throw new GithubError('persistence', 'Private cache could not be opened')
  }
}

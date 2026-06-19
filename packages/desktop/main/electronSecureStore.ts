// Electron safeStorage-backed SecureStore (Req 2.1, 2.5).
//
// Encrypts token blobs with the OS keychain/DPAPI via Electron `safeStorage` and
// persists the ciphertext to a JSON file under userData. Values are only ever
// stored encrypted; if encryption is unavailable the store refuses to persist
// rather than writing plaintext.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { SecureStore } from './tokenStore'

interface Blobs {
  [key: string]: string // base64 ciphertext
}

export function createElectronSecureStore(): SecureStore {
  const file = join(app.getPath('userData'), 'secure-tokens.json')

  async function readAll(): Promise<Blobs> {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Blobs
    } catch {
      return {}
    }
  }

  async function writeAll(blobs: Blobs): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(blobs), 'utf8')
  }

  return {
    async get(key) {
      const blobs = await readAll()
      const cipher = blobs[key]
      if (!cipher) return null
      if (!safeStorage.isEncryptionAvailable()) return null
      try {
        return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
      } catch {
        return null
      }
    },
    async set(key, value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS secure storage is unavailable; refusing to store tokens in plaintext')
      }
      const blobs = await readAll()
      blobs[key] = safeStorage.encryptString(value).toString('base64')
      await writeAll(blobs)
    },
    async delete(key) {
      const blobs = await readAll()
      delete blobs[key]
      await writeAll(blobs)
    },
  }
}

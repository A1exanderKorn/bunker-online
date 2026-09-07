import fs from 'fs'
import path from 'path'
import { DATA_DIR } from './config'

/** Читает JSON из DATA_DIR. `relativePath` — например `characteristics/index.json`. */
export function readJson<T>(relativePath: string): T {
  const fullPath = path.join(DATA_DIR, relativePath)
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8')) as T
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Не удалось прочитать ${fullPath}: ${detail}`)
  }
}

import { mkdir, writeFile, readFile } from 'fs/promises'
import path from 'path'
import { config } from './config.js'

const base = path.resolve(config.ASSETS_DIR)

export async function saveAsset(key: string, data: Buffer | string): Promise<string> {
  const fullPath = path.join(base, key)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, data)
  // Return a URL path the Express static server will serve
  return `/assets/${key}`
}

export async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const fullPath = path.join(base, key)
    const raw = await readFile(fullPath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function saveJson(key: string, data: unknown): Promise<void> {
  const fullPath = path.join(base, key)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, JSON.stringify(data, null, 2))
}

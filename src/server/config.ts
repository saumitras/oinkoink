import { z } from 'zod'
import { readFileSync } from 'fs'
import path from 'path'

// Load .env.local manually (no dotenv dep needed)
try {
  const envPath = path.resolve(process.cwd(), '.env.local')
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* .env.local optional in prod */ }

const ConfigSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  TEXT_MODEL: z.string().default('gpt-5.4-mini-2026-03-17'),
  IMAGE_MODEL: z.string().default('gpt-image-2-2026-04-21'),
  IMAGE_MODEL_FAST: z.string().default('gpt-image-2-2026-04-21'),
  TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  MODERATION_MODEL: z.string().default('omni-moderation-latest'),
  ASSETS_DIR: z.string().default('./local-assets'),
  PORT: z.coerce.number().default(3001),
})

const parsed = ConfigSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ Missing required env vars:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data

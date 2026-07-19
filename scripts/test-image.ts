import OpenAI from 'openai'

const key = process.env.OPENAI_API_KEY
if (!key) { console.error('No OPENAI_API_KEY'); process.exit(1) }

const openai = new OpenAI({ apiKey: key })

async function main() {
  console.log('Testing gpt-image-2-2026-04-21...')
  try {
    const r = await openai.images.generate({
      model: 'gpt-image-2-2026-04-21',
      prompt: 'A simple top-down view of a pumpkin farm. Cozy storybook style.',
      size: '1536x1024',
      quality: 'high',
      output_format: 'png',
    } as Parameters<typeof openai.images.generate>[0])
    const item = r.data?.[0]
    console.log('OK! keys:', Object.keys(item ?? {}))
    console.log('url:', item?.url?.slice(0, 60))
    console.log('b64 length:', (item as unknown as {b64_json?: string})?.b64_json?.length)
  } catch (e: unknown) {
    const err = e as { message: string; status?: number; error?: unknown }
    console.error('FAIL:', err.message, 'status:', err.status)
    console.error(JSON.stringify(err.error, null, 2))
  }
}

main()

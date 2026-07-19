export const STYLE_BLOCK = `STYLE: Cozy children's storybook watercolor illustration. Soft pastel palette, warm sunlight, thick clean outlines, chunky rounded shapes, flat colors with gentle texture. Cheerful and bright, absolutely nothing scary or dark. Consistent art style throughout. No text, no letters, no words in the image.`

export const TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const
export const NARRATOR_VOICE = 'nova'

export function npcVoice(index: number): string {
  const voices = ['alloy', 'echo', 'fable'] as const
  return voices[index % voices.length]
}

export const STAGE_COPY: Record<string, string> = {
  bible: '✍️ Writing your story…',
  street: '🎨 Painting your world…',
  outline: '🖊️ Tracing the paths…',
  hotspots: '🗺️ Finding the walkways…',
  character: '🐷 Dressing up Piglet…',
  rooms: '🏠 Decorating the houses…',
  tts: '🎙️ Warming up voices…',
  reunion: '📸 Preparing the reunion…',
}

export const CANNED_IDEAS = [
  'a pumpkin farm in autumn',
  'a cozy space station on the moon',
]

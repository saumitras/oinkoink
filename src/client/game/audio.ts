let ctx: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null
let masterGain: GainNode | null = null
let musicSource: AudioBufferSourceNode | null = null
let musicGain: GainNode | null = null
let musicUrl: string | null = null
let musicLoadVersion = 0
let foregroundVersion = 0
let speechVersion = 0
let foregroundActive = false
let speechActive = false
let muted = false
let backgroundMusicMuted = false
let backgroundMusicLevel = 0.30
const cache = new Map<string, AudioBuffer>()
const MUSIC_MAX_GAIN = 0.12

function updateMusicLevel(fadeSeconds = 0.25) {
  if (!ctx || !musicGain) return
  const baseVolume = backgroundMusicLevel * backgroundMusicLevel * MUSIC_MAX_GAIN
  const target = backgroundMusicMuted
    ? 0
    : foregroundActive || speechActive
      ? baseVolume * 0.25
      : baseVolume
  musicGain.gain.cancelScheduledValues(ctx.currentTime)
  musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime)
  musicGain.gain.linearRampToValueAtTime(target, ctx.currentTime + fadeSeconds)
}

async function loadBuffer(url: string): Promise<AudioBuffer> {
  if (!ctx) throw new Error('Audio is not unlocked')
  let buffer = cache.get(url)
  if (!buffer) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not load audio (${res.status})`)
    buffer = await ctx.decodeAudioData(await res.arrayBuffer())
    cache.set(url, buffer)
  }
  return buffer
}

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext()
    masterGain = ctx.createGain()
    masterGain.gain.value = muted ? 0 : 1
    masterGain.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
}

export async function playAudio(url: string): Promise<void> {
  if (!ctx) return
  const version = ++foregroundVersion
  window.speechSynthesis?.cancel()
  speechVersion += 1
  speechActive = false
  currentSource?.stop()
  currentSource = null
  foregroundActive = true
  updateMusicLevel()

  let buffer: AudioBuffer
  try {
    buffer = await loadBuffer(url)
  } catch (error) {
    if (version === foregroundVersion) {
      foregroundActive = false
      updateMusicLevel()
    }
    throw error
  }
  if (version !== foregroundVersion) return

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(masterGain ?? ctx.destination)
  await new Promise<void>(resolve => {
    source.onended = () => {
      if (version === foregroundVersion && currentSource === source) {
        currentSource = null
        foregroundActive = false
        updateMusicLevel()
      }
      resolve()
    }
    currentSource = source
    source.start()
  })
}

export function stopAudio() {
  foregroundVersion += 1
  speechVersion += 1
  currentSource?.stop()
  currentSource = null
  foregroundActive = false
  speechActive = false
  window.speechSynthesis?.cancel()
  updateMusicLevel()
}

export async function startBackgroundMusic(url: string) {
  if (!ctx) return
  if (musicSource && musicUrl === url) return
  const version = ++musicLoadVersion
  const buffer = await loadBuffer(url)
  if (!ctx || version !== musicLoadVersion) return

  musicSource?.stop()
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  source.buffer = buffer
  source.loop = true
  gain.gain.value = 0
  source.connect(gain)
  gain.connect(ctx.destination)
  musicSource = source
  musicGain = gain
  musicUrl = url
  source.start()
  updateMusicLevel(1)
}

export function stopBackgroundMusic() {
  musicLoadVersion += 1
  if (musicSource && ctx && musicGain) {
    const source = musicSource
    musicGain.gain.cancelScheduledValues(ctx.currentTime)
    musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime)
    musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45)
    source.stop(ctx.currentTime + 0.46)
  }
  musicSource = null
  musicGain = null
  musicUrl = null
}

export function setMuted(value: boolean) {
  muted = value
  if (value) {
    speechVersion += 1
    speechActive = false
    window.speechSynthesis?.cancel()
    updateMusicLevel()
  }
  if (masterGain && ctx) {
    masterGain.gain.setValueAtTime(value ? 0 : 1, ctx.currentTime)
  }
}

export function isMuted() {
  return muted
}

export function setBackgroundMusicMuted(value: boolean) {
  backgroundMusicMuted = value
  updateMusicLevel(0.18)
}

export function isBackgroundMusicMuted() {
  return backgroundMusicMuted
}

export function setBackgroundMusicLevel(value: number) {
  backgroundMusicLevel = Math.max(0, Math.min(1, value))
  updateMusicLevel(0.08)
}

export function getBackgroundMusicLevel() {
  return backgroundMusicLevel
}

// Short, no-cost narration for player-triggered object descriptions. This uses
// the browser's local speech voice, so looking at scenery never calls an API.
export function speakText(text: string): Promise<void> {
  if (muted || !('speechSynthesis' in window)) return Promise.resolve()
  const version = ++speechVersion
  window.speechSynthesis.cancel()
  speechActive = true
  updateMusicLevel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.92
  utterance.pitch = 1.08
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (version === speechVersion) {
        speechActive = false
        updateMusicLevel()
      }
      resolve()
    }
    utterance.onend = finish
    utterance.onerror = finish
    window.setTimeout(finish, Math.max(1200, Math.min(7000, text.length * 75)))
    window.speechSynthesis.speak(utterance)
  })
}

// Soft trotting footstep, synthesized (no asset file needed): a tiny filtered
// noise "pat", alternating pitch like left/right trotters.
let stepParity = false
export function footstep() {
  if (!ctx || ctx.state !== 'running') return
  const dur = 0.07
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) {
    const decay = 1 - i / d.length
    d[i] = (Math.random() * 2 - 1) * decay * decay
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = stepParity ? 950 : 720
  bp.Q.value = 1.4
  const gain = ctx.createGain()
  gain.gain.value = 0.09
  src.connect(bp)
  bp.connect(gain)
  gain.connect(masterGain ?? ctx.destination)
  src.start()
  stepParity = !stepParity
}

// Soft two-note chime, synthesized (no asset file needed)
export function playChime() {
  if (!ctx) return
  const notes = [523.25, 783.99] // C5, G5
  notes.forEach((freq, i) => {
    const osc = ctx!.createOscillator()
    const gain = ctx!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t0 = ctx!.currentTime + i * 0.12
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5)
    osc.connect(gain)
    gain.connect(masterGain ?? ctx!.destination)
    osc.start(t0)
    osc.stop(t0 + 0.55)
  })
}

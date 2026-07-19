// Keyboard movement input. Mobile movement is handled by tap-to-walk.

const keyboard = new Set<string>()

function onKeyDown(e: KeyboardEvent) {
  keyboard.add(e.key.toLowerCase())
}
function onKeyUp(e: KeyboardEvent) {
  keyboard.delete(e.key.toLowerCase())
}

export function attachKeyboard() {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
}

export function detachKeyboard() {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  keyboard.clear()
}

// Debug handle (dev only)
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__oinkInput = { keyboard }
}

export function getAxis(): { vx: number; vy: number } {
  let vx = 0
  let vy = 0
  if (keyboard.has('arrowleft') || keyboard.has('a')) vx -= 1
  if (keyboard.has('arrowright') || keyboard.has('d')) vx += 1
  if (keyboard.has('arrowup') || keyboard.has('w')) vy -= 1
  if (keyboard.has('arrowdown') || keyboard.has('s')) vy += 1
  if (vx !== 0 && vy !== 0) {
    vx *= 0.707
    vy *= 0.707
  }
  return { vx, vy }
}

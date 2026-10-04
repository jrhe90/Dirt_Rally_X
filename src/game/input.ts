export type InputState = {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
  reset: boolean
}

const keys = new Set<string>()

export function initInput(): void {
  window.addEventListener('keydown', (e) => {
    keys.add(e.code)
    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code)
  })
  window.addEventListener('blur', () => keys.clear())
}

export function readInput(): InputState {
  const up = keys.has('KeyW') || keys.has('ArrowUp')
  const down = keys.has('KeyS') || keys.has('ArrowDown')
  const left = keys.has('KeyA') || keys.has('ArrowLeft')
  const right = keys.has('KeyD') || keys.has('ArrowRight')

  return {
    throttle: up ? 1 : 0,
    brake: down ? 1 : 0,
    steer: (left ? -1 : 0) + (right ? 1 : 0),
    handbrake: keys.has('Space'),
    reset: keys.has('KeyR'),
  }
}

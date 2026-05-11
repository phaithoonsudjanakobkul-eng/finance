export interface Frame {
  id: number
  label: string
  tag: string
  hue: string
}

export const FRAMES: readonly Frame[] = [
  { id: 0, label: 'Late afternoon, golden hour stillness.', tag: 'idol · rinka', hue: '15, 60%' },
  { id: 1, label: 'Backstage, quiet between shows.',         tag: 'idol · mei',   hue: '12, 65%' },
  { id: 2, label: 'Saturday, slow morning at home.',         tag: 'self',         hue: '28, 55%' },
  { id: 3, label: 'Stage lights, the second chorus.',        tag: 'idol · aimi',  hue: '18, 70%' },
  { id: 4, label: 'Window seat, train south.',               tag: 'self',         hue: '24, 50%' },
  { id: 5, label: 'Encore, hand to the crowd.',              tag: 'idol · yui',   hue: '20, 65%' },
] as const

const KEY = 'ps_active_frame'

export function loadFrameId(): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(KEY)
  if (raw === null) return 0
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n < FRAMES.length ? n : 0
}

export function saveFrameId(id: number): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, String(id))
}

class FrameStore {
  activeId = $state<number>(loadFrameId())

  get active(): Frame {
    return FRAMES[this.activeId]
  }

  get hue(): string {
    return this.active.hue
  }

  set(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= FRAMES.length) return
    this.activeId = id
    saveFrameId(id)
  }
}

export const frames = new FrameStore()

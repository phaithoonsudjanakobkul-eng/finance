import { describe, it, expect, beforeEach } from 'vitest'
import { FRAMES, loadFrameId, saveFrameId } from './frames.svelte'

describe('frames', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes 6 mock frames in declared order', () => {
    expect(FRAMES.length).toBe(6)
    expect(FRAMES.map(f => f.id)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('every frame has a hsl-compatible hue string', () => {
    for (const f of FRAMES) {
      expect(f.hue).toMatch(/^\d+,\s*\d+%$/)
    }
  })

  it('every frame has a non-empty label and tag', () => {
    for (const f of FRAMES) {
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.tag.length).toBeGreaterThan(0)
    }
  })

  it('loadFrameId defaults to 0 when storage empty', () => {
    expect(loadFrameId()).toBe(0)
  })

  it('saveFrameId + loadFrameId round-trips a valid index', () => {
    saveFrameId(3)
    expect(loadFrameId()).toBe(3)
  })

  it('loadFrameId clamps out-of-range values to 0', () => {
    localStorage.setItem('ps_active_frame', '-1')
    expect(loadFrameId()).toBe(0)
    localStorage.setItem('ps_active_frame', '99')
    expect(loadFrameId()).toBe(0)
  })

  it('loadFrameId falls back to 0 for non-numeric stored value', () => {
    localStorage.setItem('ps_active_frame', 'abc')
    expect(loadFrameId()).toBe(0)
  })
})

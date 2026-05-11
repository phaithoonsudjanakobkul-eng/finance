import { describe, it, expect, beforeEach } from 'vitest'
import { arrowFor, colorFor, loadPinned, savePinned } from './watchlist.svelte'

describe('arrowFor', () => {
  it('returns ▲ for positive', () => {
    expect(arrowFor(0.5)).toBe('▲')
  })
  it('returns ▼ for negative', () => {
    expect(arrowFor(-0.5)).toBe('▼')
  })
  it('returns · for exactly zero (avoid false-positive arrow)', () => {
    expect(arrowFor(0)).toBe('·')
  })
})

describe('colorFor', () => {
  it('positive maps to --positive (soft green)', () => {
    expect(colorFor(1.5)).toBe('var(--positive)')
  })
  it('negative maps to --accent-bright (warm coral, per DESIGN.md negative=coral)', () => {
    expect(colorFor(-1.5)).toBe('var(--accent-bright)')
  })
  it('zero stays muted, never a semantic color', () => {
    expect(colorFor(0)).toBe('var(--text-muted)')
  })
})

describe('pinned persistence', () => {
  beforeEach(() => localStorage.clear())

  it('loadPinned returns empty array on fresh storage', () => {
    expect(loadPinned()).toEqual([])
  })

  it('savePinned + loadPinned round-trips a list', () => {
    savePinned(['TSLA', 'NVDA'])
    expect(loadPinned()).toEqual(['TSLA', 'NVDA'])
  })

  it('loadPinned returns [] on corrupt JSON', () => {
    localStorage.setItem('ps_pinned_wl_v2', '{not json')
    expect(loadPinned()).toEqual([])
  })

  it('loadPinned filters out non-string entries', () => {
    localStorage.setItem('ps_pinned_wl_v2', JSON.stringify(['OK', 42, null, 'GOOD']))
    expect(loadPinned()).toEqual(['OK', 'GOOD'])
  })
})

import { describe, it, expect } from 'vitest'
import { arrowFor, colorFor } from './watchlist.svelte'

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

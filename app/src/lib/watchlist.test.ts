import { describe, it, expect, beforeEach } from 'vitest'
import {
  arrowFor,
  colorFor,
  loadPinned,
  savePinned,
  loadAlerts,
  saveAlerts,
  triggeredAlerts,
  type Quote,
} from './watchlist.svelte'

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

describe('low alerts persistence', () => {
  beforeEach(() => localStorage.clear())

  it('loadAlerts returns empty object on fresh storage', () => {
    expect(loadAlerts()).toEqual({})
  })

  it('saveAlerts + loadAlerts round-trips a dict', () => {
    saveAlerts({ TSLA: 350, NVDA: 180 })
    expect(loadAlerts()).toEqual({ TSLA: 350, NVDA: 180 })
  })

  it('loadAlerts drops non-positive / non-numeric values defensively', () => {
    localStorage.setItem(
      'ps_low_alerts_v2',
      JSON.stringify({ OK: 100, ZERO: 0, NEG: -50, NUL: null, STR: 'abc' })
    )
    expect(loadAlerts()).toEqual({ OK: 100 })
  })

  it('loadAlerts returns {} on corrupt JSON', () => {
    localStorage.setItem('ps_low_alerts_v2', '{not json')
    expect(loadAlerts()).toEqual({})
  })

  it('loadAlerts returns {} when payload is an array (not object)', () => {
    localStorage.setItem('ps_low_alerts_v2', '[1,2,3]')
    expect(loadAlerts()).toEqual({})
  })
})

describe('triggeredAlerts', () => {
  const QUOTES: Quote[] = [
    { sym: 'TSLA',  last: 391.58, pct: 2.61 },
    { sym: 'NVDA',  last: 199.65, pct: 0.05 },
    { sym: 'GOOGL', last: 384.71, pct: -0.07 },
  ]

  it('returns empty when no alerts set', () => {
    expect(triggeredAlerts(QUOTES, {})).toEqual([])
  })

  it('returns empty when LAST is above threshold', () => {
    expect(triggeredAlerts(QUOTES, { TSLA: 300 })).toEqual([])
  })

  it('triggers when LAST drops below threshold and computes belowPct', () => {
    const r = triggeredAlerts(QUOTES, { NVDA: 220 })
    expect(r).toHaveLength(1)
    expect(r[0].sym).toBe('NVDA')
    expect(r[0].threshold).toBe(220)
    expect(r[0].last).toBe(199.65)
    expect(r[0].belowPct).toBeCloseTo(((199.65 - 220) / 220) * 100, 2)
  })

  it('ignores symbols missing from quote list', () => {
    expect(triggeredAlerts(QUOTES, { GHOST: 100 })).toEqual([])
  })

  it('drops non-positive thresholds defensively', () => {
    expect(triggeredAlerts(QUOTES, { TSLA: 0, NVDA: -1 })).toEqual([])
  })
})

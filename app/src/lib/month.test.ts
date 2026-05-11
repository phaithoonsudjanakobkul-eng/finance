import { describe, it, expect } from 'vitest'
import { computeMonthProgress } from './month'

describe('computeMonthProgress', () => {
  it('returns day of month + days in month', () => {
    const r = computeMonthProgress(new Date(2026, 4, 12))
    expect(r.day).toBe(12)
    expect(r.daysInMonth).toBe(31)
  })

  it('handles 30-day months', () => {
    const r = computeMonthProgress(new Date(2026, 3, 15))
    expect(r.daysInMonth).toBe(30)
  })

  it('handles February non-leap year (28 days)', () => {
    const r = computeMonthProgress(new Date(2025, 1, 14))
    expect(r.daysInMonth).toBe(28)
  })

  it('handles February leap year (29 days)', () => {
    const r = computeMonthProgress(new Date(2024, 1, 14))
    expect(r.daysInMonth).toBe(29)
  })

  it('computes percentage rounded', () => {
    expect(computeMonthProgress(new Date(2026, 4, 1)).pct).toBe(3)   // 1/31 = 3.2%
    expect(computeMonthProgress(new Date(2026, 4, 15)).pct).toBe(48) // 15/31 = 48.4%
    expect(computeMonthProgress(new Date(2026, 4, 31)).pct).toBe(100)
  })

  it('returns uppercase "MONTH YEAR" label', () => {
    expect(computeMonthProgress(new Date(2026, 4, 12)).label).toBe('MAY 2026')
    expect(computeMonthProgress(new Date(2026, 0, 1)).label).toBe('JANUARY 2026')
  })
})

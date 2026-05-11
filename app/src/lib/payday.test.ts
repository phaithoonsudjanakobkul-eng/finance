import { describe, it, expect } from 'vitest'
import { computeNextPayday, formatCineDate } from './payday'

describe('computeNextPayday', () => {
  it('returns 27th when today is mid-month (weekday)', () => {
    // 2026-05-12 (Tue) → next payday 2026-05-27 (Wed)
    const r = computeNextPayday(new Date(2026, 4, 12))
    expect(r.date.getFullYear()).toBe(2026)
    expect(r.date.getMonth()).toBe(4)
    expect(r.date.getDate()).toBe(27)
    expect(r.days).toBe(15)
  })

  it('shifts Saturday 27 to Friday 26', () => {
    // 2025-09-27 is a Saturday → payday should be Fri 2025-09-26
    const r = computeNextPayday(new Date(2025, 8, 1))
    expect(r.date.getDate()).toBe(26)
    expect(r.date.getDay()).toBe(5) // Friday
  })

  it('shifts Sunday 27 to Friday 25', () => {
    // 2025-04-27 is a Sunday → payday should be Fri 2025-04-25
    const r = computeNextPayday(new Date(2025, 3, 1))
    expect(r.date.getDate()).toBe(25)
    expect(r.date.getDay()).toBe(5)
  })

  it('rolls to next month after payday passes', () => {
    // 2026-05-28 (Thu) is past May payday → next is 2026-06-26 (Fri, because Jun 27 is Sat)
    const r = computeNextPayday(new Date(2026, 4, 28))
    expect(r.date.getMonth()).toBe(5)
    expect(r.date.getDate()).toBe(26)
  })

  it('returns 0 days when today IS payday', () => {
    // 2026-05-27 is a Wednesday → payday today
    const r = computeNextPayday(new Date(2026, 4, 27))
    expect(r.days).toBe(0)
    expect(r.date.getDate()).toBe(27)
  })

  it('returns 1 day when today is the day before payday', () => {
    const r = computeNextPayday(new Date(2026, 4, 26))
    expect(r.days).toBe(1)
  })

  it('handles year rollover (Dec → next-year Jan)', () => {
    // 2025-12-28 is past Dec payday → next is 2026-01-27 (Tue)
    const r = computeNextPayday(new Date(2025, 11, 28))
    expect(r.date.getFullYear()).toBe(2026)
    expect(r.date.getMonth()).toBe(0)
    expect(r.date.getDate()).toBe(27)
  })
})

describe('formatCineDate', () => {
  it('formats 27 May 2026 as "27 MAY 2026"', () => {
    expect(formatCineDate(new Date(2026, 4, 27))).toBe('27 MAY 2026')
  })

  it('formats single-digit days without padding', () => {
    expect(formatCineDate(new Date(2026, 0, 5))).toBe('5 JAN 2026')
  })

  it('uppercases month abbrev', () => {
    expect(formatCineDate(new Date(2026, 11, 1))).toBe('1 DEC 2026')
  })
})

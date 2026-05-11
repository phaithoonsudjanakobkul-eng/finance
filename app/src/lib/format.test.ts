import { describe, it, expect } from 'vitest'
import { fmtBaht, fmtBahtDecimal } from './format'

describe('fmtBaht', () => {
  it('formats whole numbers with grouping commas', () => {
    expect(fmtBaht(1234567)).toBe('1,234,567')
  })

  it('rounds away decimals', () => {
    expect(fmtBaht(1234.49)).toBe('1,234')
    expect(fmtBaht(1234.50)).toBe('1,235')
  })

  it('returns "0" for NaN / Infinity', () => {
    expect(fmtBaht(NaN)).toBe('0')
    expect(fmtBaht(Infinity)).toBe('0')
  })

  it('handles 0 and negative numbers', () => {
    expect(fmtBaht(0)).toBe('0')
    expect(fmtBaht(-150)).toBe('-150')
  })
})

describe('fmtBahtDecimal', () => {
  it('always shows 2 fraction digits', () => {
    expect(fmtBahtDecimal(100)).toBe('100.00')
    expect(fmtBahtDecimal(99.999)).toBe('100.00')
    expect(fmtBahtDecimal(99.991)).toBe('99.99')
  })
})

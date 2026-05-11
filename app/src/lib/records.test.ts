import { describe, it, expect, beforeEach } from 'vitest'
import {
  makeRecord,
  loadRecords,
  saveRecords,
  sumByType,
  balanceOf,
  newId,
  type FinancialRecord,
} from './records.svelte'

describe('newId', () => {
  it('returns a non-empty string', () => {
    expect(typeof newId()).toBe('string')
    expect(newId().length).toBeGreaterThan(8)
  })

  it('returns unique ids on consecutive calls', () => {
    const a = newId()
    const b = newId()
    expect(a).not.toBe(b)
  })
})

describe('makeRecord', () => {
  it('trims category and clamps negative amounts to 0', () => {
    const r = makeRecord('expense', '  Food  ', -50)
    expect(r.category).toBe('Food')
    expect(r.amount).toBe(0)
    expect(r.type).toBe('expense')
  })

  it('coerces non-numeric amount to 0', () => {
    const r = makeRecord('income', 'Salary', Number('abc'))
    expect(r.amount).toBe(0)
  })
})

describe('loadRecords / saveRecords', () => {
  beforeEach(() => localStorage.clear())

  it('returns [] when storage empty', () => {
    expect(loadRecords()).toEqual([])
  })

  it('round-trips a saved list', () => {
    const list: FinancialRecord[] = [makeRecord('income', 'Salary', 50000)]
    saveRecords(list)
    expect(loadRecords()).toEqual(list)
  })

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem('ps_records_v2', '{not json')
    expect(loadRecords()).toEqual([])
  })

  it('filters out malformed entries', () => {
    const good = makeRecord('income', 'OK', 100)
    const bad = { id: 'x', type: 'income', category: 'no amount' }
    localStorage.setItem('ps_records_v2', JSON.stringify([good, bad]))
    expect(loadRecords()).toEqual([good])
  })
})

describe('totals', () => {
  it('sumByType only sums matching type', () => {
    const list = [
      makeRecord('income',  'Salary',  50000),
      makeRecord('income',  'Bonus',    5000),
      makeRecord('expense', 'Food',     2000),
    ]
    expect(sumByType(list, 'income')).toBe(55000)
    expect(sumByType(list, 'expense')).toBe(2000)
  })

  it('balanceOf = income - expense', () => {
    const list = [
      makeRecord('income',  'Salary', 50000),
      makeRecord('expense', 'Rent',   12000),
      makeRecord('expense', 'Food',    8000),
    ]
    expect(balanceOf(list)).toBe(30000)
  })

  it('totals are 0 on empty list', () => {
    expect(sumByType([], 'income')).toBe(0)
    expect(balanceOf([])).toBe(0)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { loadDark, saveDark, applyDarkClass } from './theme.svelte'

describe('theme persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it('loadDark returns false when key missing', () => {
    expect(loadDark()).toBe(false)
  })

  it('saveDark(true) writes "1" and loadDark reads it', () => {
    saveDark(true)
    expect(localStorage.getItem('ps_dark')).toBe('1')
    expect(loadDark()).toBe(true)
  })

  it('saveDark(false) removes the key', () => {
    saveDark(true)
    saveDark(false)
    expect(localStorage.getItem('ps_dark')).toBe(null)
    expect(loadDark()).toBe(false)
  })

  it('applyDarkClass toggles html.dark class', () => {
    applyDarkClass(true)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    applyDarkClass(false)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

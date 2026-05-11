import { describe, it, expect, beforeEach } from 'vitest'
import { TABS, loadTab, saveTab } from './tabs.svelte'

describe('tabs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes 5 tabs in the expected order', () => {
    expect(TABS.map(t => t.id)).toEqual([
      'dashboard', 'records', 'watchlist', 'news', 'utilities',
    ])
  })

  it('loadTab defaults to dashboard when storage empty', () => {
    expect(loadTab()).toBe('dashboard')
  })

  it('saveTab + loadTab round-trips a valid id', () => {
    saveTab('watchlist')
    expect(loadTab()).toBe('watchlist')
  })

  it('loadTab falls back to dashboard for unknown stored value', () => {
    localStorage.setItem('ps_tab', 'bogus-tab')
    expect(loadTab()).toBe('dashboard')
  })
})

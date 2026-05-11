export type TabId = 'dashboard' | 'records' | 'watchlist' | 'news' | 'utilities'

export interface TabDef {
  id: TabId
  label: string
}

export const TABS: readonly TabDef[] = [
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'records',    label: 'Records' },
  { id: 'watchlist',  label: 'Watchlist' },
  { id: 'news',       label: 'News' },
  { id: 'utilities',  label: 'Utilities' },
] as const

const KEY = 'ps_tab'
const VALID = new Set<string>(TABS.map(t => t.id))

export function loadTab(): TabId {
  if (typeof localStorage === 'undefined') return 'dashboard'
  const v = localStorage.getItem(KEY)
  return v && VALID.has(v) ? (v as TabId) : 'dashboard'
}

export function saveTab(id: TabId): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, id)
}

class TabStore {
  active = $state<TabId>(loadTab())

  set(id: TabId): void {
    this.active = id
    saveTab(id)
  }
}

export const tabs = new TabStore()

export interface Quote {
  sym: string
  last: number
  pct: number
}

const MOCK: readonly Quote[] = [
  { sym: 'TSLA',  last: 391.58, pct:  2.61 },
  { sym: 'MSFT',  last: 414.08, pct:  1.55 },
  { sym: 'AMZN',  last: 269.80, pct:  1.80 },
  { sym: 'NVDA',  last: 199.65, pct:  0.05 },
  { sym: 'GOOGL', last: 384.71, pct: -0.07 },
  { sym: 'AAPL',  last: 230.42, pct:  0.62 },
  { sym: 'META',  last: 575.18, pct: -0.34 },
  { sym: 'IREN',  last:  46.82, pct:  2.92 },
] as const

export function arrowFor(pct: number): '▲' | '▼' | '·' {
  if (pct > 0) return '▲'
  if (pct < 0) return '▼'
  return '·'
}

export function colorFor(pct: number): string {
  if (pct > 0) return 'var(--positive)'
  if (pct < 0) return 'var(--accent-bright)'
  return 'var(--text-muted)'
}

const PIN_KEY = 'ps_pinned_wl_v2'

export function loadPinned(): string[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(PIN_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

export function savePinned(syms: string[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PIN_KEY, JSON.stringify(syms))
}

class WatchlistStore {
  list = $state<Quote[]>([...MOCK])
  pinned = $state<string[]>(loadPinned())

  isPinned(sym: string): boolean {
    return this.pinned.includes(sym)
  }

  togglePin(sym: string): void {
    const idx = this.pinned.indexOf(sym)
    if (idx >= 0) {
      this.pinned = this.pinned.filter(s => s !== sym)
    } else {
      this.pinned = [...this.pinned, sym]
    }
    savePinned(this.pinned)
  }

  get pinnedQuotes(): Quote[] {
    const set = new Set(this.pinned)
    return this.list.filter(q => set.has(q.sym))
  }
}

export const watchlist = new WatchlistStore()

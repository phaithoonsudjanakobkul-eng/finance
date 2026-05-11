export interface Quote {
  sym: string
  last: number
  pct: number
}

export interface LowAlertTrigger {
  sym: string
  last: number
  threshold: number
  belowPct: number
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

const ALERT_KEY = 'ps_low_alerts_v2'

export function loadAlerts(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {}
  const raw = localStorage.getItem(ALERT_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[k] = v
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveAlerts(alerts: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(ALERT_KEY, JSON.stringify(alerts))
}

export function triggeredAlerts(
  quotes: readonly Quote[],
  alerts: Readonly<Record<string, number>>
): LowAlertTrigger[] {
  const out: LowAlertTrigger[] = []
  for (const q of quotes) {
    const threshold = alerts[q.sym]
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) continue
    if (q.last >= threshold) continue
    const belowPct = ((q.last - threshold) / threshold) * 100
    out.push({ sym: q.sym, last: q.last, threshold, belowPct })
  }
  return out
}

class WatchlistStore {
  list = $state<Quote[]>([...MOCK])
  pinned = $state<string[]>(loadPinned())
  alerts = $state<Record<string, number>>(loadAlerts())

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

  alertFor(sym: string): number | null {
    const v = this.alerts[sym]
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
  }

  setAlert(sym: string, threshold: number): void {
    if (!Number.isFinite(threshold) || threshold <= 0) return
    this.alerts = { ...this.alerts, [sym]: threshold }
    saveAlerts(this.alerts)
  }

  clearAlert(sym: string): void {
    if (!(sym in this.alerts)) return
    const next = { ...this.alerts }
    delete next[sym]
    this.alerts = next
    saveAlerts(this.alerts)
  }

  get triggered(): LowAlertTrigger[] {
    return triggeredAlerts(this.list, this.alerts)
  }
}

export const watchlist = new WatchlistStore()

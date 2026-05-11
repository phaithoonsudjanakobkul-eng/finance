export interface MonthProgress {
  day: number
  daysInMonth: number
  pct: number
  label: string
}

const MONTH_LABEL_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })

export function computeMonthProgress(today: Date = new Date()): MonthProgress {
  const day = today.getDate()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const pct = Math.round((day / daysInMonth) * 100)
  const label = MONTH_LABEL_FMT.format(today).toUpperCase()
  return { day, daysInMonth, pct, label }
}

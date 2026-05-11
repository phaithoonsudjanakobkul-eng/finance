export interface PaydayInfo {
  date: Date
  days: number
}

const PAYDAY_DOM = 27

function paydayInMonth(year: number, month: number): Date {
  let d = new Date(year, month, PAYDAY_DOM)
  const dow = d.getDay()
  if (dow === 6) d = new Date(year, month, PAYDAY_DOM - 1)
  else if (dow === 0) d = new Date(year, month, PAYDAY_DOM - 2)
  return d
}

export function computeNextPayday(today: Date = new Date()): PaydayInfo {
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let next = paydayInMonth(today.getFullYear(), today.getMonth())
  if (next.getTime() < todayMidnight.getTime()) {
    next = paydayInMonth(today.getFullYear(), today.getMonth() + 1)
  }
  const days = Math.round((next.getTime() - todayMidnight.getTime()) / 86400000)
  return { date: next, days }
}

const SHORT_MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short' })

export function formatCineDate(date: Date): string {
  return `${date.getDate()} ${SHORT_MONTH_FMT.format(date).toUpperCase()} ${date.getFullYear()}`
}

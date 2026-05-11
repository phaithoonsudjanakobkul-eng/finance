const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function fmtBaht(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return intFmt.format(Math.round(n))
}

export function fmtBahtDecimal(n: number): string {
  if (!Number.isFinite(n)) return '0.00'
  return decFmt.format(n)
}

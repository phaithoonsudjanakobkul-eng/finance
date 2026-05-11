export type RecordType = 'income' | 'expense'

export interface FinancialRecord {
  id: string
  type: RecordType
  category: string
  amount: number
  ts: number
}

const KEY = 'ps_records_v2'

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function makeRecord(type: RecordType, category: string, amount: number): FinancialRecord {
  return {
    id: newId(),
    type,
    category: category.trim(),
    amount: Math.max(0, Number(amount) || 0),
    ts: Date.now(),
  }
}

function isRecord(x: unknown): x is FinancialRecord {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    (r.type === 'income' || r.type === 'expense') &&
    typeof r.category === 'string' &&
    typeof r.amount === 'number' &&
    typeof r.ts === 'number'
  )
}

export function loadRecords(): FinancialRecord[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecord)
  } catch {
    return []
  }
}

export function saveRecords(list: FinancialRecord[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function sumByType(list: readonly FinancialRecord[], type: RecordType): number {
  let total = 0
  for (const r of list) {
    if (r.type === type) total += r.amount
  }
  return total
}

export function balanceOf(list: readonly FinancialRecord[]): number {
  return sumByType(list, 'income') - sumByType(list, 'expense')
}

class RecordsStore {
  list = $state<FinancialRecord[]>(loadRecords())

  get incomeTotal(): number {
    return sumByType(this.list, 'income')
  }

  get expenseTotal(): number {
    return sumByType(this.list, 'expense')
  }

  get balance(): number {
    return balanceOf(this.list)
  }

  add(record: FinancialRecord): void {
    this.list = [...this.list, record]
    saveRecords(this.list)
  }

  remove(id: string): void {
    this.list = this.list.filter(r => r.id !== id)
    saveRecords(this.list)
  }

  clear(): void {
    this.list = []
    saveRecords(this.list)
  }
}

export const records = new RecordsStore()

<script lang="ts">
  import FinanceCard from './FinanceCard.svelte'
  import { records } from '../lib/records.svelte'

  const yearLabel = '2026 YTD'

  // Placeholder monthly sparkline trend (mock).
  // Replaced by real Records month-aggregates in a later session.
  const SPARK_BALANCE: readonly number[] = [12, 18, 15, 22, 19, 25, 23, 28, 24, 30, 27, 32]
  const SPARK_INCOME:  readonly number[] = [50, 50, 52, 55, 55, 58, 60, 62, 65, 68, 70, 75]
  const SPARK_EXPENSE: readonly number[] = [30, 32, 35, 33, 38, 40, 42, 45, 43, 48, 50, 52]

  const savingsRate = $derived(
    records.incomeTotal > 0
      ? Math.round(((records.incomeTotal - records.expenseTotal) / records.incomeTotal) * 100)
      : 0
  )
</script>

<div
  class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
  style="gap:var(--card-gap);"
  data-component="finance-row"
>
  <FinanceCard
    label="Current Balance"
    value={records.balance}
    accent={records.balance >= 0 ? 'var(--positive)' : 'var(--accent-bright)'}
    sparkData={SPARK_BALANCE}
  />
  <FinanceCard
    label="YTD Income"
    ytdLabel={yearLabel}
    value={records.incomeTotal}
    accent="var(--positive)"
    sparkData={SPARK_INCOME}
  />
  <FinanceCard
    label="YTD Expense"
    ytdLabel={yearLabel}
    value={records.expenseTotal}
    accent="var(--accent-bright)"
    sparkData={SPARK_EXPENSE}
  />
  <FinanceCard
    label="Savings Rate"
    ytdLabel={yearLabel}
    value={savingsRate}
    accent="var(--accent)"
    ringPct={savingsRate}
    suffix="%"
  />
</div>

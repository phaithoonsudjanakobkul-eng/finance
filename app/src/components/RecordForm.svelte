<script lang="ts">
  import { records, makeRecord, type RecordType } from '../lib/records.svelte'

  let type = $state<RecordType>('expense')
  let category = $state('')
  let amount = $state('')

  function submit(e: Event) {
    e.preventDefault()
    const n = Number(amount)
    if (!category.trim() || !Number.isFinite(n) || n <= 0) return
    records.add(makeRecord(type, category, n))
    category = ''
    amount = ''
  }

  const inputStyle = 'padding:8px 12px; border-radius:6px; border:0.5px solid var(--border-glass); background:var(--surface-glass); color:var(--text); font-size:14px; outline:none; width:100%;'
</script>

<form class="glass p-4 flex flex-col gap-3" onsubmit={submit} data-component="record-form">
  <div class="label-mono">Add record</div>

  <div class="flex gap-2">
    <button
      type="button"
      class="ff-mono uppercase flex-1 transition cursor-pointer"
      style:padding="7px 12px"
      style:font-size="10px"
      style:letter-spacing="0.1em"
      style:border-radius="6px"
      style:border={type === 'income' ? '0.5px solid var(--positive)' : '0.5px solid var(--border-glass)'}
      style:background={type === 'income' ? 'rgba(124,197,124,0.15)' : 'transparent'}
      style:color={type === 'income' ? 'var(--positive)' : 'var(--text-muted)'}
      data-type-toggle="income"
      aria-pressed={type === 'income'}
      onclick={() => type = 'income'}
    >Income</button>
    <button
      type="button"
      class="ff-mono uppercase flex-1 transition cursor-pointer"
      style:padding="7px 12px"
      style:font-size="10px"
      style:letter-spacing="0.1em"
      style:border-radius="6px"
      style:border={type === 'expense' ? '0.5px solid var(--accent)' : '0.5px solid var(--border-glass)'}
      style:background={type === 'expense' ? 'rgba(232,133,94,0.15)' : 'transparent'}
      style:color={type === 'expense' ? 'var(--accent-bright)' : 'var(--text-muted)'}
      data-type-toggle="expense"
      aria-pressed={type === 'expense'}
      onclick={() => type = 'expense'}
    >Expense</button>
  </div>

  <input
    type="text"
    placeholder="Category (e.g. Food, Salary)"
    bind:value={category}
    class="ff-body"
    style={inputStyle}
    data-field="category"
  />
  <input
    type="number"
    inputmode="decimal"
    min="0"
    step="0.01"
    placeholder="Amount"
    bind:value={amount}
    class="ff-mono"
    style={inputStyle}
    data-field="amount"
  />

  <button
    type="submit"
    class="ff-mono uppercase cursor-pointer"
    style="padding:9px 16px; font-size:11px; letter-spacing:0.1em; background:var(--accent); color:#1A1018; border:0.5px solid var(--accent); border-radius:6px; font-weight:600;"
    data-action="save-record"
  >Save</button>
</form>

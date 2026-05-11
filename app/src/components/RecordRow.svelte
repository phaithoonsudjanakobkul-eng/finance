<script lang="ts">
  import { records, type FinancialRecord } from '../lib/records.svelte'
  import { fmtBaht } from '../lib/format'

  let { record }: { record: FinancialRecord } = $props()
</script>

<div
  class="flex items-center justify-between"
  style="padding:11px 16px; border-top:0.5px solid rgba(245,241,232,0.07);"
  data-record-id={record.id}
  data-record-type={record.type}
>
  <div class="flex-1 min-w-0">
    <div style="font-size:13px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
      {record.category}
    </div>
    <div class="label-mono" style="margin-top:2px;">{record.type}</div>
  </div>
  <div class="flex items-center gap-3 shrink-0">
    <div
      class="ff-mono num"
      style:font-size="14px"
      style:font-weight="500"
      style:color={record.type === 'income' ? 'var(--positive)' : 'var(--accent-bright)'}
      data-amount
    >
      <span style="color:var(--text-ghost);">{record.type === 'income' ? '+' : '−'}฿</span>{fmtBaht(record.amount)}
    </div>
    <button
      type="button"
      class="ff-mono cursor-pointer transition"
      style="padding:4px 9px; font-size:11px; line-height:1; background:transparent; color:var(--text-faint); border:0.5px solid var(--border-glass); border-radius:4px;"
      data-action="delete-record"
      aria-label="Delete record"
      onclick={() => records.remove(record.id)}
    >×</button>
  </div>
</div>

<script lang="ts">
  import { fmtBaht } from '../lib/format'

  let {
    label,
    value,
    accent = 'var(--text)',
    showSign = false,
  }: {
    label: string
    value: number
    accent?: string
    showSign?: boolean
  } = $props()

  const sign = $derived(showSign && value < 0 ? '−' : '')
  const display = $derived(fmtBaht(Math.abs(value)))
</script>

<div class="glass p-4" data-component="stat-glass" data-label={label}>
  <div class="label-mono">{label}</div>
  <div
    class="ff-display mt-2"
    style:font-size="26px"
    style:font-weight="600"
    style:letter-spacing="-0.02em"
    style:color={accent}
    data-value
  >
    <span style="color:var(--text-ghost); font-size:18px;">{sign}฿</span>{display}
  </div>
</div>

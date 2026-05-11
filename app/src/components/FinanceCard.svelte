<script lang="ts">
  import { fmtBaht } from '../lib/format'
  import MiniSpark from './MiniSpark.svelte'
  import DonutRing from './DonutRing.svelte'

  let {
    label,
    value,
    accent = 'var(--text)',
    ytdLabel = '',
    sparkData,
    ringPct,
    suffix,
  }: {
    label: string
    value: number
    accent?: string
    ytdLabel?: string
    sparkData?: readonly number[]
    ringPct?: number
    suffix?: string
  } = $props()

  const isRing = $derived(typeof ringPct === 'number')
  const displayVal = $derived(fmtBaht(value))
</script>

<div
  class="glass cq-card"
  style="padding:var(--card-pad-y) var(--card-pad-x);"
  data-component="finance-card"
  data-label={label}
>
  <div class="flex items-center justify-between" style="margin-bottom:6px;">
    <div class="label-mono">{label}</div>
    {#if ytdLabel}
      <div
        class="ff-mono"
        style="font-size:var(--text-xs); color:var(--text-faint); letter-spacing:0.1em;"
      >
        {ytdLabel}
      </div>
    {/if}
  </div>

  <div class="flex items-center justify-between" style="gap:var(--space-3);">
    <div
      class="ff-display"
      style="font-size:var(--text-2xl); font-weight:600; letter-spacing:-0.02em; color:{accent}; line-height:1.05;"
      data-value
    >
      {#if !suffix}<span style="color:var(--text-ghost); font-size:0.65em;">฿</span>{/if}{displayVal}{#if suffix}<span style="color:var(--text-ghost); font-size:0.65em; margin-left:1px;">{suffix}</span>{/if}
    </div>
    {#if isRing && typeof ringPct === 'number'}
      <DonutRing pct={ringPct} color={accent} />
    {:else if sparkData}
      <MiniSpark data={sparkData} color={accent} />
    {/if}
  </div>
</div>

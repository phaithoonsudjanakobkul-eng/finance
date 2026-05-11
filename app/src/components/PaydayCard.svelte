<script lang="ts">
  import { computeNextPayday, formatCineDate } from '../lib/payday'

  const now = new Date()
  const payday = computeNextPayday(now)
  const dateLabel = formatCineDate(payday.date)
  const isToday = payday.days === 0
</script>

<div
  class="glass flex flex-col"
  style="padding:16px 18px; min-height:160px; justify-content:space-between;"
  data-component="payday-card"
>
  <div class="label-mono">Next Payday</div>

  <div class="flex flex-col items-start" data-payday-mid>
    {#if isToday}
      <div
        class="ff-display"
        style="font-size:32px; font-weight:600; letter-spacing:-0.02em; color:var(--accent-bright); line-height:1;"
        data-payday-num
      >TODAY</div>
    {:else}
      <div class="flex items-baseline gap-2">
        <span
          class="ff-display"
          style="font-size:42px; font-weight:600; letter-spacing:-0.02em; color:var(--text); line-height:1;"
          data-payday-num
        >{payday.days}</span>
        <span
          class="ff-mono uppercase"
          style="font-size:10px; letter-spacing:0.15em; color:var(--text-faint);"
          data-payday-sublabel
        >{payday.days === 1 ? 'Day' : 'Days'}</span>
      </div>
    {/if}
  </div>

  <div
    class="ff-mono uppercase"
    style="font-size:10px; letter-spacing:0.15em; color:var(--text-muted); padding-top:8px; border-top:0.5px solid rgba(245,241,232,0.07);"
    data-payday-date
  >{dateLabel}</div>
</div>

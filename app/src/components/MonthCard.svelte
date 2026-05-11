<script lang="ts">
  import { computeMonthProgress } from '../lib/month'

  const now = new Date()
  const m = computeMonthProgress(now)
</script>

<div
  class="glass flex flex-col"
  style="padding:var(--card-pad-y) var(--card-pad-x); min-height:160px; justify-content:space-between;"
  data-component="month-card"
>
  <div class="label-mono">This Month</div>

  <div class="flex items-baseline gap-2" data-month-mid>
    <span
      class="ff-display"
      style="font-size:var(--text-hero); font-weight:600; letter-spacing:-0.02em; color:var(--text); line-height:1;"
      data-month-num
    >{m.day}</span>
    <span
      class="ff-mono uppercase"
      style="font-size:var(--text-xs); letter-spacing:0.15em; color:var(--text-faint);"
      data-month-sublabel
    >of {m.daysInMonth}</span>
  </div>

  <div style="padding-top:8px; border-top:0.5px solid rgba(245,241,232,0.07);">
    <div class="flex items-center justify-between" style="margin-bottom:6px;">
      <span
        class="ff-mono uppercase"
        style="font-size:var(--text-xs); letter-spacing:0.15em; color:var(--text-muted);"
        data-month-label
      >{m.label}</span>
      <span
        class="ff-mono"
        style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);"
        data-month-pct
      >{m.pct}%</span>
    </div>
    <div
      style="height:4px; background:var(--surface-glass); border-radius:2px; overflow:hidden;"
      data-month-bar
    >
      <div
        style:width="{m.pct}%"
        style:height="100%"
        style:background="var(--accent)"
        style:border-radius="2px"
        style:transition="width 0.6s ease"
        data-month-bar-fill
      ></div>
    </div>
  </div>
</div>

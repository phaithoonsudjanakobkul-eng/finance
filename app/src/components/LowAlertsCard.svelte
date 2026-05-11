<script lang="ts">
  import { watchlist } from '../lib/watchlist.svelte'
  import { fmtBahtDecimal } from '../lib/format'
  import { tabs } from '../lib/tabs.svelte'
  import { withViewTransition } from '../lib/view-transition'

  const triggered = $derived(watchlist.triggered)
  const totalSet = $derived(Object.keys(watchlist.alerts).length)
</script>

<div class="glass cq-card" data-component="low-alerts">
  <div
    class="flex items-center justify-between"
    style="padding:var(--card-pad-y) var(--card-pad-x) 8px;"
  >
    <div class="flex items-center" style="gap:var(--space-2);">
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:{triggered.length > 0 ? 'var(--accent-bright)' : 'var(--text-faint)'}; opacity:0.85;">
        <polyline points="1,3 5,8 8,5 13,11"/>
        <polyline points="10,11 13,11 13,8"/>
      </svg>
      <span class="label-mono">Low Alerts</span>
    </div>
    <div class="ff-mono" style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);">
      {triggered.length} / {totalSet}
    </div>
  </div>

  {#if totalSet === 0}
    <div
      style="padding:var(--space-6) var(--card-pad-x); text-align:center;"
      data-empty
    >
      <p style="color:var(--text-faint); font-size:var(--text-base); margin-bottom:8px;">
        ยังไม่ตั้ง alert
      </p>
      <button
        type="button"
        class="ff-mono uppercase cursor-pointer"
        style="padding:6px 12px; font-size:var(--text-xs); letter-spacing:0.1em; background:var(--surface-glass); color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm);"
        data-action="goto-market-alerts"
        onclick={() => withViewTransition(() => tabs.set('watchlist'))}
      >Set in Market →</button>
    </div>
  {:else if triggered.length === 0}
    <div
      style="padding:var(--space-5) var(--card-pad-x); text-align:center;"
      data-quiet
    >
      <p style="color:var(--text-faint); font-size:var(--text-base);">
        Quiet · ทุก symbol อยู่เหนือ threshold
      </p>
    </div>
  {:else}
    <div data-triggered-list>
      {#each triggered as t (t.sym)}
        <div
          class="grid items-center"
          style="grid-template-columns: 1fr auto auto; gap:var(--space-3); padding:var(--space-3) var(--card-pad-x); border-top:0.5px solid rgba(245,241,232,0.07);"
          data-alert-row
          data-symbol={t.sym}
        >
          <div class="ff-mono" style="font-size:var(--text-base); font-weight:500; color:var(--text); letter-spacing:0.04em;">
            {t.sym}
          </div>
          <div class="flex flex-col items-end" style="line-height:1.1;">
            <span class="ff-mono num" style="font-size:var(--text-base); color:var(--accent-bright); font-weight:500;">
              {fmtBahtDecimal(t.last)}
            </span>
            <span class="ff-mono" style="font-size:var(--text-xs); color:var(--text-faint); letter-spacing:0.05em;">
              ↘ {fmtBahtDecimal(t.threshold)}
            </span>
          </div>
          <div
            class="ff-mono num text-right"
            style="font-size:var(--text-base); font-weight:500; color:var(--accent-bright); min-width:64px;"
            data-below-pct
          >
            {t.belowPct.toFixed(2)}%
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

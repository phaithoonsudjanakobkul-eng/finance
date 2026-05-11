<script lang="ts">
  import { arrowFor, colorFor, watchlist } from '../lib/watchlist.svelte'
  import { fmtBahtDecimal } from '../lib/format'
  import { tabs } from '../lib/tabs.svelte'
  import { withViewTransition } from '../lib/view-transition'

  const pinned = $derived(watchlist.pinnedQuotes)
</script>

<div class="glass cq-card" data-component="pinned-watchlist">
  <div
    class="flex items-center justify-between"
    style="padding:var(--card-pad-y) var(--card-pad-x) 8px;"
  >
    <div class="flex items-center" style="gap:var(--space-2);">
      <svg width="9" height="11" viewBox="0 0 10 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" style="color:var(--text-faint); opacity:0.85;">
        <path d="M1 1h8v8L5 12 1 9V1z" fill="color-mix(in srgb, currentColor 15%, transparent)"/>
        <line x1="5" y1="5" x2="5" y2="3" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      <span class="label-mono">Pinned</span>
    </div>
    <div class="ff-mono" style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);">
      {pinned.length} {pinned.length === 1 ? 'SYMBOL' : 'SYMBOLS'}
    </div>
  </div>

  {#if pinned.length === 0}
    <div
      style="padding:var(--space-6) var(--card-pad-x); text-align:center;"
      data-empty
    >
      <p style="color:var(--text-faint); font-size:var(--text-base); margin-bottom:8px;">
        ยังไม่มี symbol ที่ pin
      </p>
      <button
        type="button"
        class="ff-mono uppercase cursor-pointer"
        style="padding:6px 12px; font-size:var(--text-xs); letter-spacing:0.1em; background:var(--surface-glass); color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm);"
        data-action="goto-market"
        onclick={() => withViewTransition(() => tabs.set('watchlist'))}
      >Pin from Market →</button>
    </div>
  {:else}
    <div data-pinned-list>
      {#each pinned as q (q.sym)}
        {@const arrow = arrowFor(q.pct)}
        {@const color = colorFor(q.pct)}
        {@const pctText = `${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}%`}
        <div
          class="grid items-center"
          style="grid-template-columns: 1fr auto auto; gap:var(--space-3); padding:var(--space-3) var(--card-pad-x); border-top:0.5px solid rgba(245,241,232,0.07);"
          data-pinned-row
          data-symbol={q.sym}
        >
          <div class="ff-mono" style="font-size:var(--text-base); font-weight:500; color:var(--text); letter-spacing:0.04em;">
            {q.sym}
          </div>
          <div class="ff-mono num text-right" style="font-size:var(--text-base); color:var(--text-muted);">
            {fmtBahtDecimal(q.last)}
          </div>
          <div
            class="ff-mono num text-right"
            style:font-size="var(--text-base)"
            style:font-weight="500"
            style:color={color}
            style:min-width="72px"
          >
            {arrow} {pctText}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

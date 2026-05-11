<script lang="ts">
  import WatchlistRow from '../components/WatchlistRow.svelte'
  import { watchlist } from '../lib/watchlist.svelte'
</script>

<section data-tab-content="watchlist" class="flex flex-col" style="gap:var(--card-gap);">
  <div class="glass" data-watchlist-panel>
    <div
      class="flex items-center justify-between"
      style="padding:var(--card-pad-y) var(--card-pad-x) 8px;"
    >
      <div class="flex items-center gap-2">
        <span class="pulse-dot inline-block" style="width:6px; height:6px; border-radius:50%; background:var(--positive); color:var(--positive);"></span>
        <div class="label-mono">Market · Watchlist</div>
      </div>
      <div class="ff-mono" style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);">
        {watchlist.list.length} SYMBOLS · {watchlist.pinned.length} PINNED · MOCK
      </div>
    </div>

    <div
      class="grid"
      style="grid-template-columns: auto 1fr 1fr 1fr; gap:var(--space-3); padding:6px var(--card-pad-x);"
    >
      <div class="label-mono" style="width:22px;">Pin</div>
      <div class="label-mono">Sym</div>
      <div class="label-mono text-right">Last</div>
      <div class="label-mono text-right">Chg</div>
    </div>

    <div data-watchlist-list>
      {#each watchlist.list as q (q.sym)}
        <WatchlistRow quote={q} showPin />
      {/each}
    </div>
  </div>

  <div
    class="glass"
    style="padding:var(--card-pad-y) var(--card-pad-x); color:var(--text-muted); font-size:var(--text-base);"
  >
    <div class="label-mono">Note</div>
    <p class="mt-2">Mock data only — live Alpaca / Finnhub WebSocket ticks land R-later. Pin/unpin a symbol with the pin icon — pinned symbols show on Dashboard.</p>
  </div>
</section>

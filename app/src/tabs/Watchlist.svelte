<script lang="ts">
  import WatchlistRow from '../components/WatchlistRow.svelte'
  import { watchlist } from '../lib/watchlist.svelte'
</script>

<section data-tab-content="watchlist" class="flex flex-col gap-3.5">
  <div class="glass" data-watchlist-panel>
    <div class="flex items-center justify-between" style="padding:14px 16px 8px;">
      <div class="flex items-center gap-2">
        <span class="pulse-dot inline-block" style="width:6px; height:6px; border-radius:50%; background:var(--positive); color:var(--positive);"></span>
        <div class="label-mono">Market · Watchlist</div>
      </div>
      <div class="ff-mono" style="font-size:9px; letter-spacing:0.12em; color:var(--text-faint);">
        {watchlist.list.length} SYMBOLS · MOCK
      </div>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; padding:6px 16px;">
      <div class="label-mono">Sym</div>
      <div class="label-mono text-right">Last</div>
      <div class="label-mono text-right">Chg</div>
    </div>

    <div data-watchlist-list>
      {#each watchlist.list as q (q.sym)}
        <WatchlistRow quote={q} />
      {/each}
    </div>
  </div>

  <div class="glass p-4" style="color:var(--text-muted); font-size:12px;">
    <div class="label-mono">Note</div>
    <p class="mt-2">Mock data only — live Alpaca / Finnhub WebSocket ticks land R7+. Sparklines, scanner, quick chart, AI panel come after that.</p>
  </div>
</section>

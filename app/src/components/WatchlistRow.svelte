<script lang="ts">
  import { arrowFor, colorFor, watchlist, type Quote } from '../lib/watchlist.svelte'
  import { fmtBahtDecimal } from '../lib/format'

  let { quote, showPin = false }: { quote: Quote; showPin?: boolean } = $props()

  const arrow = $derived(arrowFor(quote.pct))
  const color = $derived(colorFor(quote.pct))
  const pctText = $derived(`${quote.pct >= 0 ? '+' : ''}${quote.pct.toFixed(2)}%`)
  const pinned = $derived(watchlist.isPinned(quote.sym))
</script>

<div
  class="grid items-center"
  style="grid-template-columns: {showPin ? 'auto 1fr 1fr 1fr' : '1fr 1fr 1fr'}; gap:var(--space-3); padding:var(--space-4) var(--card-pad-x); border-top:0.5px solid rgba(245,241,232,0.07);"
  data-watchlist-row
  data-symbol={quote.sym}
>
  {#if showPin}
    <button
      type="button"
      class="cursor-pointer flex items-center justify-center"
      style:width="22px"
      style:height="22px"
      style:padding="0"
      style:border="0.5px solid var(--border-glass)"
      style:border-radius="var(--radius-xs)"
      style:background={pinned ? 'var(--accent-glow)' : 'transparent'}
      style:color={pinned ? 'var(--accent-bright)' : 'var(--text-faint)'}
      aria-label={pinned ? `Unpin ${quote.sym}` : `Pin ${quote.sym}`}
      aria-pressed={pinned}
      data-action="toggle-pin"
      onclick={() => watchlist.togglePin(quote.sym)}
    >
      <svg width="10" height="11" viewBox="0 0 10 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
        <path d="M1 1h8v8L5 12 1 9V1z" fill={pinned ? 'color-mix(in srgb, currentColor 25%, transparent)' : 'none'}/>
        <line x1="5" y1="5" x2="5" y2="3" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    </button>
  {/if}

  <div class="ff-mono" style="font-size:var(--text-base); font-weight:500; color:var(--text); letter-spacing:0.04em;">
    {quote.sym}
  </div>
  <div class="ff-mono num text-right" style="font-size:var(--text-base); color:var(--text-muted);">
    {fmtBahtDecimal(quote.last)}
  </div>
  <div
    class="ff-mono num text-right"
    style:font-size="var(--text-base)"
    style:font-weight="500"
    style:color={color}
    data-pct
  >
    {arrow} {pctText}
  </div>
</div>

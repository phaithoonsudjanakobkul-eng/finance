<script lang="ts">
  import { arrowFor, colorFor, type Quote } from '../lib/watchlist.svelte'
  import { fmtBahtDecimal } from '../lib/format'

  let { quote }: { quote: Quote } = $props()

  const arrow = $derived(arrowFor(quote.pct))
  const color = $derived(colorFor(quote.pct))
  const pctText = $derived(`${quote.pct >= 0 ? '+' : ''}${quote.pct.toFixed(2)}%`)
</script>

<div
  class="grid items-center"
  style="grid-template-columns: 1fr 1fr 1fr; padding:11px 16px; border-top:0.5px solid rgba(245,241,232,0.07);"
  data-watchlist-row
  data-symbol={quote.sym}
>
  <div class="ff-mono" style="font-size:12px; font-weight:500; color:var(--text); letter-spacing:0.04em;">
    {quote.sym}
  </div>
  <div class="ff-mono num text-right" style="font-size:12px; color:var(--text-muted);">
    {fmtBahtDecimal(quote.last)}
  </div>
  <div class="ff-mono num text-right" style:font-size="12px" style:font-weight="500" style:color={color} data-pct>
    {arrow} {pctText}
  </div>
</div>

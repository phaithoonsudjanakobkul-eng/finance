<script lang="ts">
  import { arrowFor, colorFor, watchlist, type Quote } from '../lib/watchlist.svelte'
  import { fmtBahtDecimal } from '../lib/format'

  let {
    quote,
    showPin = false,
    showAlert = false,
  }: {
    quote: Quote
    showPin?: boolean
    showAlert?: boolean
  } = $props()

  const arrow = $derived(arrowFor(quote.pct))
  const color = $derived(colorFor(quote.pct))
  const pctText = $derived(`${quote.pct >= 0 ? '+' : ''}${quote.pct.toFixed(2)}%`)
  const pinned = $derived(watchlist.isPinned(quote.sym))
  const alertVal = $derived(watchlist.alertFor(quote.sym))
  const triggered = $derived(alertVal !== null && quote.last < alertVal)

  let editingAlert = $state(false)
  let draftAlert = $state('')

  function startAlertEdit() {
    draftAlert = alertVal !== null ? String(alertVal) : ''
    editingAlert = true
  }
  function cancelAlertEdit() {
    editingAlert = false
  }
  function saveAlert() {
    const n = Number(draftAlert)
    if (Number.isFinite(n) && n > 0) {
      watchlist.setAlert(quote.sym, n)
    } else if (draftAlert.trim() === '') {
      watchlist.clearAlert(quote.sym)
    }
    editingAlert = false
  }
  function onAlertKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveAlert()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelAlertEdit()
    }
  }
  function clearAlert() {
    watchlist.clearAlert(quote.sym)
    editingAlert = false
  }

  const cols = $derived(
    [
      showPin ? 'auto' : null,
      showAlert ? 'auto' : null,
      '1fr', '1fr', '1fr',
    ].filter(Boolean).join(' ')
  )
</script>

<div data-watchlist-row data-symbol={quote.sym} data-triggered={triggered ? 'true' : 'false'}>
  <div
    class="grid items-center"
    style="grid-template-columns: {cols}; gap:var(--space-3); padding:var(--space-4) var(--card-pad-x); border-top:0.5px solid rgba(245,241,232,0.07);"
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

    {#if showAlert}
      <button
        type="button"
        class="cursor-pointer flex items-center justify-center"
        style:width="22px"
        style:height="22px"
        style:padding="0"
        style:border="0.5px solid {triggered ? 'var(--accent)' : 'var(--border-glass)'}"
        style:border-radius="var(--radius-xs)"
        style:background={triggered ? 'rgba(232,133,94,0.18)' : alertVal !== null ? 'var(--accent-glow)' : 'transparent'}
        style:color={triggered ? 'var(--accent-bright)' : alertVal !== null ? 'var(--accent-bright)' : 'var(--text-faint)'}
        aria-label={alertVal !== null ? `Edit LOW alert for ${quote.sym} (current ${alertVal})` : `Set LOW alert for ${quote.sym}`}
        aria-pressed={alertVal !== null}
        data-action="toggle-alert"
        onclick={startAlertEdit}
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1,3 5,8 8,5 13,11"/>
          <polyline points="10,11 13,11 13,8"/>
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

  {#if showAlert && editingAlert}
    <div
      class="flex items-center"
      style="gap:var(--space-2); padding:var(--space-3) var(--card-pad-x); background:rgba(232,133,94,0.04); border-top:0.5px solid var(--border-glass);"
      data-alert-editor
    >
      <span class="label-mono">LOW</span>
      <input
        type="number"
        inputmode="decimal"
        min="0"
        step="0.01"
        bind:value={draftAlert}
        onkeydown={onAlertKey}
        class="ff-mono num"
        style="flex:1; padding:5px 8px; font-size:var(--text-base); background:var(--surface-glass); color:var(--text); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm); outline:none;"
        data-field="alert-threshold"
        aria-label={`LOW threshold for ${quote.sym}`}
      />
      <button
        type="button"
        class="ff-mono uppercase cursor-pointer"
        style="padding:5px 10px; font-size:var(--text-xs); letter-spacing:0.1em; background:var(--accent); color:#1A1018; border:0.5px solid var(--accent); border-radius:var(--radius-sm); font-weight:600;"
        data-action="save-alert"
        onclick={saveAlert}
      >Save</button>
      {#if alertVal !== null}
        <button
          type="button"
          class="ff-mono uppercase cursor-pointer"
          style="padding:5px 10px; font-size:var(--text-xs); letter-spacing:0.1em; background:transparent; color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm);"
          data-action="clear-alert"
          onclick={clearAlert}
        >Clear</button>
      {/if}
      <button
        type="button"
        class="ff-mono uppercase cursor-pointer"
        style="padding:5px 10px; font-size:var(--text-xs); letter-spacing:0.1em; background:transparent; color:var(--text-faint); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm);"
        data-action="cancel-alert"
        onclick={cancelAlertEdit}
      >Cancel</button>
    </div>
  {/if}
</div>

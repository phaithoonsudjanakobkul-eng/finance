<script lang="ts">
  import { tabs, TABS, type TabId } from '../lib/tabs.svelte'
  import { withViewTransition } from '../lib/view-transition'
</script>

<header class="flex items-center justify-between flex-wrap gap-3" style="margin-bottom:var(--space-7);">
  <div class="flex items-center gap-x-6 gap-y-2 flex-wrap min-w-0">
    <div class="min-w-0">
      <div
        class="ff-display leading-none"
        style="font-size:var(--text-lg); font-weight:600; letter-spacing:-0.02em;"
      >
        PSLink<span style="color:var(--accent);">.</span>
      </div>
      <div
        class="ff-mono"
        style="margin-top:4px; font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);"
      >
        AUTO-SAVED · 21:59
      </div>
    </div>

    <div role="tablist" class="flex flex-wrap gap-0.5" aria-label="App sections">
      {#each TABS as t, i (t.id)}
        {@const isActive = tabs.active === t.id}
        <button
          type="button"
          role="tab"
          id="tab-{t.id}"
          aria-selected={isActive}
          aria-controls="panel-{t.id}"
          tabindex={isActive ? 0 : -1}
          class="ff-body uppercase transition cursor-pointer"
          style:padding="6px 12px"
          style:font-size="var(--text-xs)"
          style:font-weight="500"
          style:letter-spacing="0.04em"
          style:border="none"
          style:border-radius="var(--radius-sm)"
          style:background={isActive ? 'var(--accent-glow)' : 'transparent'}
          style:color={isActive ? 'var(--accent-bright)' : 'var(--text-muted)'}
          data-tab={t.id}
          aria-current={isActive ? 'page' : undefined}
          title="Press {i + 1} to switch"
          onclick={() => withViewTransition(() => tabs.set(t.id as TabId))}
        >
          {t.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="flex items-center gap-2">
    <button
      type="button"
      class="ff-mono uppercase"
      style="padding:6px 12px; font-size:var(--text-xs); letter-spacing:0.1em; background:var(--surface-glass); color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:var(--radius-sm); cursor:pointer;"
      data-action="sync"
    >SYNC</button>
    <button
      type="button"
      class="ff-mono uppercase"
      style="padding:6px 12px; font-size:var(--text-xs); letter-spacing:0.1em; background:var(--accent); color:#1A1018; border:0.5px solid var(--accent); border-radius:var(--radius-sm); cursor:pointer; font-weight:600;"
      data-action="save"
    >SAVE</button>
    <span class="pulse-dot inline-block" style="width:8px; height:8px; border-radius:50%; background:var(--positive); color:var(--positive); margin-left:6px;"></span>
  </div>
</header>

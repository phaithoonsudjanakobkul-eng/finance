<script lang="ts">
  import { tabs, TABS, type TabId } from '../lib/tabs.svelte'
</script>

<header class="flex items-center justify-between mb-6 px-1">
  <div class="flex items-center gap-6">
    <div>
      <div class="ff-display leading-none" style="font-size:22px; font-weight:600; letter-spacing:-0.02em;">
        PSLink<span style="color:var(--accent);">.</span>
      </div>
      <div class="ff-mono mt-1" style="font-size:9px; letter-spacing:0.12em; color:var(--text-faint);">
        AUTO-SAVED · 21:59
      </div>
    </div>

    <nav class="flex gap-0.5">
      {#each TABS as t (t.id)}
        {@const isActive = tabs.active === t.id}
        <button
          type="button"
          class="ff-body uppercase transition"
          style:padding="7px 13px"
          style:font-size="11px"
          style:font-weight="500"
          style:letter-spacing="0.04em"
          style:border="none"
          style:border-radius="6px"
          style:cursor="pointer"
          style:background={isActive ? 'var(--accent-glow)' : 'transparent'}
          style:color={isActive ? 'var(--accent-bright)' : 'var(--text-muted)'}
          data-tab={t.id}
          aria-current={isActive ? 'page' : undefined}
          onclick={() => tabs.set(t.id as TabId)}
        >
          {t.label}
        </button>
      {/each}
    </nav>
  </div>

  <div class="flex items-center gap-2">
    <button type="button" class="ff-mono uppercase" style="padding:6px 12px; font-size:10px; letter-spacing:0.1em; background:var(--surface-glass); color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:6px; cursor:pointer;" data-action="sync">SYNC</button>
    <button type="button" class="ff-mono uppercase" style="padding:6px 12px; font-size:10px; letter-spacing:0.1em; background:var(--accent); color:#1A1018; border:0.5px solid var(--accent); border-radius:6px; cursor:pointer; font-weight:600;" data-action="save">SAVE</button>
    <span class="pulse-dot inline-block" style="width:8px; height:8px; border-radius:50%; background:var(--positive); color:var(--positive); margin-left:6px;"></span>
  </div>
</header>

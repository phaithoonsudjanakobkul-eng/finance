<script lang="ts">
  import { theme } from '../lib/theme.svelte'
  import { tabs, TABS, type TabId } from '../lib/tabs.svelte'
</script>

<nav
  class="sticky top-0 z-50 flex items-center gap-4 px-4 h-14 border-b backdrop-blur"
  style="background:color-mix(in srgb, var(--bg-surface) 80%, transparent); border-color:var(--border);"
>
  <span class="font-semibold tracking-tight" style="color:var(--text-primary);">PSLink</span>

  <div class="flex gap-1 flex-1">
    {#each TABS as t (t.id)}
      {@const isActive = tabs.active === t.id}
      <button
        type="button"
        class="px-3 py-1.5 rounded-full text-sm font-medium transition"
        style={isActive
          ? `background:var(--accent); color:white;`
          : `color:var(--text-secondary);`}
        data-tab={t.id}
        aria-current={isActive ? 'page' : undefined}
        onclick={() => tabs.set(t.id as TabId)}
      >
        {t.label}
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="px-3 py-1.5 rounded-md text-sm border transition"
    style="border-color:var(--border); color:var(--text-secondary);"
    data-action="toggle-theme"
    aria-label="Toggle theme"
    onclick={() => theme.toggle()}
  >
    {theme.dark ? 'Onyx' : 'Slate'}
  </button>
</nav>

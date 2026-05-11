<script lang="ts">
  import TopNav from './components/TopNav.svelte'
  import Dashboard from './tabs/Dashboard.svelte'
  import Records from './tabs/Records.svelte'
  import Watchlist from './tabs/Watchlist.svelte'
  import News from './tabs/News.svelte'
  import Utilities from './tabs/Utilities.svelte'
  import { tabs, TABS, type TabId } from './lib/tabs.svelte'
  import { frames } from './lib/frames.svelte'
  import { withViewTransition } from './lib/view-transition'

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (target.isContentEditable) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return

      const idx = ['1', '2', '3', '4', '5'].indexOf(e.key)
      if (idx >= 0 && TABS[idx]) {
        e.preventDefault()
        const id = TABS[idx].id as TabId
        withViewTransition(() => tabs.set(id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
</script>

<a href="#main" class="skip-link">Skip to main</a>

<div class="app-shell" style:--hero-hue={frames.hue} data-hero-hue={frames.hue}>
  <div class="app-grain"></div>
  <div class="app-shell-inner">
    <TopNav />

    <main id="main" tabindex="-1" aria-label="Main content">
      {#if tabs.active === 'dashboard'}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <section role="tabpanel" id="panel-dashboard" aria-labelledby="tab-dashboard" tabindex="0">
          <Dashboard />
        </section>
      {:else if tabs.active === 'records'}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <section role="tabpanel" id="panel-records" aria-labelledby="tab-records" tabindex="0">
          <Records />
        </section>
      {:else if tabs.active === 'watchlist'}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <section role="tabpanel" id="panel-watchlist" aria-labelledby="tab-watchlist" tabindex="0">
          <Watchlist />
        </section>
      {:else if tabs.active === 'news'}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <section role="tabpanel" id="panel-news" aria-labelledby="tab-news" tabindex="0">
          <News />
        </section>
      {:else if tabs.active === 'utilities'}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <section role="tabpanel" id="panel-utilities" aria-labelledby="tab-utilities" tabindex="0">
          <Utilities />
        </section>
      {/if}
    </main>
  </div>
</div>

<script lang="ts">
  import TopNav from './components/TopNav.svelte'
  import Dashboard from './tabs/Dashboard.svelte'
  import Records from './tabs/Records.svelte'
  import Watchlist from './tabs/Watchlist.svelte'
  import News from './tabs/News.svelte'
  import Utilities from './tabs/Utilities.svelte'
  import { tabs } from './lib/tabs.svelte'
  import { frames } from './lib/frames.svelte'
</script>

<div class="app-shell" style:--hero-hue={frames.hue} data-hero-hue={frames.hue}>
  <div class="app-grain"></div>
  <div class="app-shell-inner">
    <TopNav />

    <main>
      {#if tabs.active === 'dashboard'}
        <Dashboard />
      {:else if tabs.active === 'records'}
        <Records />
      {:else if tabs.active === 'watchlist'}
        <Watchlist />
      {:else if tabs.active === 'news'}
        <News />
      {:else if tabs.active === 'utilities'}
        <Utilities />
      {/if}
    </main>
  </div>
</div>

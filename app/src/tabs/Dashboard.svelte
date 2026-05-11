<script lang="ts">
  import HeroPhoto from '../components/HeroPhoto.svelte'
  import ProfileCard from '../components/ProfileCard.svelte'
  import PaydayCard from '../components/PaydayCard.svelte'
  import MonthCard from '../components/MonthCard.svelte'
  import PinnedWatchlist from '../components/PinnedWatchlist.svelte'
  import LowAlertsCard from '../components/LowAlertsCard.svelte'
  import MiniFrameStrip from '../components/MiniFrameStrip.svelte'
</script>

<section
  data-tab-content="dashboard"
  class="grid grid-cols-1 md:grid-cols-[clamp(300px,24vw,400px)_1fr]"
  style="gap:var(--card-gap);"
>
  <div class="flex flex-col" style="gap:var(--card-gap);">
    <HeroPhoto />
  </div>

  <div class="flex flex-col" style="gap:var(--card-gap);">
    <div class="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] md:grid-cols-1 lg:grid-cols-[1fr_1.5fr]" style="gap:var(--card-gap);">
      <LowAlertsCard />
      <PinnedWatchlist />
    </div>

    <ProfileCard />

    <div class="grid grid-cols-2" style="gap:var(--card-gap);">
      <PaydayCard />
      <MonthCard />
    </div>

    <MiniFrameStrip />
  </div>
</section>

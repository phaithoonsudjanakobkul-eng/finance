<script lang="ts">
  import HeroPhoto from '../components/HeroPhoto.svelte'
  import MiniFrameStrip from '../components/MiniFrameStrip.svelte'
  import ProfileCard from '../components/ProfileCard.svelte'
  import PaydayCard from '../components/PaydayCard.svelte'
  import MonthCard from '../components/MonthCard.svelte'
  import PinnedWatchlist from '../components/PinnedWatchlist.svelte'
  import LowAlertsCard from '../components/LowAlertsCard.svelte'
  import FinanceRow from '../components/FinanceRow.svelte'
  import ChartsRow from '../components/ChartsRow.svelte'
</script>

<section data-tab-content="dashboard" class="dash-grid">
  <div class="dash-area-hero flex flex-col" style="gap:var(--card-gap);">
    <HeroPhoto />
    <MiniFrameStrip />
  </div>

  <div class="dash-area-right">
    <div
      class="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr] md:grid-cols-1 lg:grid-cols-[1fr_1.5fr]"
      style="gap:var(--card-gap);"
    >
      <LowAlertsCard />
      <PinnedWatchlist />
    </div>

    <ProfileCard />

    <div class="grid grid-cols-2" style="gap:var(--card-gap);">
      <PaydayCard />
      <MonthCard />
    </div>
  </div>

  <div class="dash-area-finance"><FinanceRow /></div>
  <div class="dash-area-charts"><ChartsRow /></div>
</section>

<style>
  /* Monolith-style 4-row Dashboard grid. Top row is 2-col (Hero + Right
     stack) at md+; finance + charts rows span FULL WIDTH below — these
     bottom rows anchor the grid so column-height imbalance in row 1
     becomes intentional breathing room, not awkward asymmetry. */
  .dash-grid {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas:
      "hero"
      "right"
      "finance"
      "charts";
    gap: var(--card-gap);
  }

  @media (min-width: 1024px) {
    .dash-grid {
      grid-template-columns: clamp(300px, 24vw, 400px) 1fr;
      grid-template-areas:
        "hero    right"
        "finance finance"
        "charts  charts";
    }
  }

  .dash-area-hero    { grid-area: hero; }
  .dash-area-right   {
    grid-area: right;
    /* Inner grid: Alerts/Pinned (auto) · Profile (grows to fill) ·
       Payday/Month (auto). When row 1's height is driven by the tall
       Hero column, Profile expands to consume the slack so the right
       column doesn't trail off with empty space above Finance row. */
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--card-gap);
  }
  .dash-area-finance { grid-area: finance; }
  .dash-area-charts  { grid-area: charts; }
</style>

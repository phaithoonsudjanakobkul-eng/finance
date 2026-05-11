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
  <div class="dash-area-hero"><HeroPhoto /></div>
  <div class="dash-area-mini"><MiniFrameStrip /></div>

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
  /* MONOLITHIC 4-col grid — every row uses the same 4 column tracks.
     Hero col-1 left edge = Finance card-1 left edge = Trend chart
     left edge = ONE vertical line. Same for col boundaries 1|2, 2|3,
     3|4 across all rows. Inner row grids (FinanceRow 4-col, ChartsRow
     2-col) inherit `minmax(0, 1fr)` ratio + same gap, so their cells
     match parent col widths exactly. */
  .dash-grid {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-areas:
      "hero"
      "right"
      "mini"
      "finance"
      "charts";
    gap: var(--card-gap);
  }

  @media (min-width: 640px) {
    .dash-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      grid-template-areas:
        "hero    right right right"
        "mini    right right right"
        "finance finance finance finance"
        "charts  charts  charts  charts";
    }
  }

  .dash-area-hero { grid-area: hero; }
  .dash-area-mini { grid-area: mini; }
  .dash-area-right {
    grid-area: right;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: var(--card-gap);
  }
  .dash-area-finance { grid-area: finance; }
  .dash-area-charts  { grid-area: charts; }
</style>

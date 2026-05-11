<script lang="ts">
  import ChartCard from './ChartCard.svelte'
</script>

<div
  class="grid grid-cols-1 lg:grid-cols-2"
  style="gap:var(--card-gap);"
  data-component="charts-row"
>
  <ChartCard title="Trend Comparison" type="trend" />
  <ChartCard title="Distribution" type="distribution" />
</div>

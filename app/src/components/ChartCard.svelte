<script lang="ts">
  let {
    title,
    type,
  }: {
    title: string
    type: 'trend' | 'distribution'
  } = $props()

  const DIST_SLICES = [
    { name: 'Investment',    pct: 38, color: 'var(--accent)' },
    { name: 'Living',        pct: 28, color: 'var(--positive)' },
    { name: 'Subscriptions', pct: 14, color: '#A89D8A' },
    { name: 'Food',          pct: 12, color: '#6B6155' },
    { name: 'Other',         pct:  8, color: '#453E36' },
  ] as const

  // Pre-compute donut segment offsets (circumference 2πr where r=36 → ~226.2)
  const CIRC = 2 * Math.PI * 36
  let acc = 0
  const slices = DIST_SLICES.map(s => {
    const len = (s.pct / 100) * CIRC
    const offset = -acc
    acc += len
    return { ...s, len, offset, gap: CIRC - len }
  })
</script>

<div
  class="glass"
  style="padding:var(--card-pad-y) var(--card-pad-x);"
  data-component="chart-card"
  data-chart-type={type}
>
  <div class="flex items-center justify-between" style="margin-bottom:12px;">
    <span class="label-mono">{title}</span>
    <span
      class="ff-mono"
      style="font-size:var(--text-xs); color:var(--text-faint); letter-spacing:0.12em;"
    >Preview · Mock</span>
  </div>

  {#if type === 'trend'}
    <svg
      viewBox="0 0 400 160"
      style="width:100%; height:auto; aspect-ratio:400/160;"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M 0 110 L 50 88 L 100 96 L 150 72 L 200 64 L 250 62 L 300 48 L 350 38 L 400 30 L 400 160 L 0 160 Z"
        fill="var(--positive)"
        opacity="0.14"
      />
      <path
        d="M 0 110 L 50 88 L 100 96 L 150 72 L 200 64 L 250 62 L 300 48 L 350 38 L 400 30"
        fill="none"
        stroke="var(--positive)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <path
        d="M 0 132 L 50 122 L 100 126 L 150 116 L 200 110 L 250 104 L 300 100 L 350 92 L 400 88"
        fill="none"
        stroke="var(--accent-bright)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-dasharray="5 5"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div
      class="flex items-center"
      style="gap:var(--space-5); margin-top:10px; font-size:var(--text-xs); color:var(--text-faint); letter-spacing:0.06em;"
    >
      <span class="flex items-center" style="gap:6px;">
        <span style="display:inline-block;width:14px;height:2px;background:var(--positive);"></span>Income
      </span>
      <span class="flex items-center" style="gap:6px;">
        <span style="display:inline-block;width:14px;height:0;border-top:2px dashed var(--accent-bright);"></span>Expense
      </span>
    </div>
  {:else}
    <div class="flex items-center" style="gap:var(--space-6);">
      <svg
        viewBox="0 0 100 100"
        style="width:120px; height:120px; flex-shrink:0;"
        aria-hidden="true"
      >
        {#each slices as s (s.name)}
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke={s.color}
            stroke-width="14"
            stroke-dasharray="{s.len} {s.gap}"
            stroke-dashoffset={s.offset}
            transform="rotate(-90 50 50)"
          />
        {/each}
      </svg>
      <ul
        class="flex flex-col"
        style="gap:6px; font-size:var(--text-xs); color:var(--text-muted); list-style:none; padding:0; margin:0;"
      >
        {#each DIST_SLICES as s (s.name)}
          <li class="flex items-center" style="gap:8px;">
            <span
              style="display:inline-block;width:9px;height:9px;border-radius:2px;background:{s.color};"
            ></span>
            <span style="flex:1;">{s.name}</span>
            <span class="ff-mono num" style="color:var(--text-faint); letter-spacing:0.05em;">{s.pct}%</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

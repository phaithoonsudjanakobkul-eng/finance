<script lang="ts">
  let {
    pct,
    size = 44,
    color = 'var(--accent)',
    bgColor = 'color-mix(in srgb, var(--accent) 14%, var(--border-glass))',
    strokeWidth = 3,
  }: {
    pct: number
    size?: number
    color?: string
    bgColor?: string
    strokeWidth?: number
  } = $props()

  const r = $derived((size - strokeWidth) / 2)
  const c = $derived(2 * Math.PI * r)
  const cx = $derived(size / 2)
  const cy = $derived(size / 2)
  const clamped = $derived(Math.max(0, Math.min(100, pct)))
  const offset = $derived(c * (1 - clamped / 100))
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  aria-hidden="true"
  data-donut-ring
  data-pct={Math.round(clamped)}
>
  <circle {cx} {cy} r={r} fill="none" stroke={bgColor} stroke-width={strokeWidth} />
  <circle
    class="ring-fg"
    {cx} {cy} r={r} fill="none"
    stroke={color}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-dasharray={c}
    stroke-dashoffset={offset}
    transform="rotate(-90 {cx} {cy})"
  />
</svg>

<style>
  .ring-fg {
    transition: stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .ring-fg { transition: none; }
  }
</style>

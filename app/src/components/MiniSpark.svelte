<script lang="ts">
  let {
    data,
    width = 56,
    height = 22,
    color = 'var(--positive)',
  }: {
    data: readonly number[]
    width?: number
    height?: number
    color?: string
  } = $props()

  function pathFor(d: readonly number[], w: number, h: number): string {
    if (d.length < 2) return ''
    let min = d[0], max = d[0]
    for (const v of d) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const range = max - min || 1
    const stepX = w / (d.length - 1)
    let out = ''
    for (let i = 0; i < d.length; i++) {
      const x = i * stepX
      const y = h - ((d[i] - min) / range) * h
      out += (i === 0 ? 'M' : 'L') + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' '
    }
    return out.trim()
  }

  const linePath = $derived(pathFor(data, width, height))
  const areaPath = $derived(linePath ? `${linePath} L ${width} ${height} L 0 ${height} Z` : '')
</script>

<svg
  viewBox="0 0 {width} {height}"
  style:width="{width}px"
  style:height="{height}px"
  aria-hidden="true"
  data-mini-spark
>
  {#if areaPath}
    <path d={areaPath} fill={color} opacity="0.15" />
  {/if}
  {#if linePath}
    <path
      d={linePath}
      fill="none"
      stroke={color}
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {/if}
</svg>

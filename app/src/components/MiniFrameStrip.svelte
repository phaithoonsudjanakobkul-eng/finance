<script lang="ts">
  import { frames, FRAMES } from '../lib/frames.svelte'
  import { withViewTransition } from '../lib/view-transition'
</script>

<div
  class="glass cq-card"
  style="padding:var(--card-pad-y) var(--card-pad-x);"
  data-component="mini-frames"
>
  <div class="flex items-center justify-between" style="margin-bottom:12px;">
    <div class="label-mono">Frame Picker</div>
    <div class="ff-mono" style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);">
      {frames.activeId + 1} / {FRAMES.length}
    </div>
  </div>

  <div
    class="mini-strip-row"
    role="tablist"
    aria-label="Frame picker"
    data-component="frame-strip"
  >
    {#each FRAMES as f (f.id)}
      {@const isActive = frames.activeId === f.id}
      <button
        type="button"
        role="tab"
        class="mini-thumb cursor-pointer"
        style:background={`linear-gradient(135deg, hsl(${f.hue}, 78%) 0%, hsl(${f.hue}, 35%) 100%)`}
        style:border={isActive ? '1.5px solid var(--accent)' : '0.5px solid var(--border-glass)'}
        style:opacity={isActive ? '1' : '0.6'}
        data-frame={f.id}
        aria-selected={isActive}
        aria-label={`Frame ${f.id + 1}: ${f.tag}`}
        onclick={() => withViewTransition(() => frames.set(f.id))}
      ></button>
    {/each}
  </div>
</div>

<style>
  .mini-strip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .mini-thumb {
    flex: 0 0 auto;
    /* Container-query-driven width: 14% of card width, clamped 64-150px.
       Card on right column (large viewport): ~14cqi ≈ 100-150px → clamp 150.
       Card on narrow column: 14cqi shrinks → clamp 64.
       9:16 aspect: height = width × 16/9. At 150px → 267px tall. */
    width: clamp(64px, 14cqi, 150px);
    aspect-ratio: 9 / 16;
    border-radius: 8px;
    padding: 0;
    transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  }

  .mini-thumb:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  @media (prefers-reduced-motion: reduce) {
    .mini-thumb:hover:not(:disabled) {
      transform: none;
    }
  }
</style>

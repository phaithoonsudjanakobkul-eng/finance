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
    gap: 8px;
  }

  .mini-thumb {
    flex: 0 0 auto;
    /* Container-query-driven width clamp(40, 14cqi, 120).
       In the left column under Hero (card width ~280-380px): each
       thumb 40-53px → 6 fit in one row with 8-12px gap.
       In wider containers (if ever reused on right col / Settings):
       caps at 120px so they stay "preview-sized" not "poster-sized". */
    width: clamp(40px, 14cqi, 120px);
    aspect-ratio: 9 / 16;
    border-radius: 6px;
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

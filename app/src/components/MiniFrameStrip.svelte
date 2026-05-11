<script lang="ts">
  import { frames, FRAMES } from '../lib/frames.svelte'
  import { withViewTransition } from '../lib/view-transition'
</script>

<div
  class="glass cq-card"
  style="padding:var(--card-pad-y) var(--card-pad-x);"
  data-component="mini-frames"
>
  <div class="flex items-center justify-between" style="margin-bottom:10px;">
    <div class="label-mono">Frame Picker</div>
    <div class="ff-mono" style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);">
      {frames.activeId + 1} / {FRAMES.length}
    </div>
  </div>

  <div
    class="flex flex-wrap"
    style="gap:8px;"
    role="tablist"
    aria-label="Frame picker"
    data-component="frame-strip"
  >
    {#each FRAMES as f (f.id)}
      {@const isActive = frames.activeId === f.id}
      <button
        type="button"
        role="tab"
        class="cursor-pointer"
        style:width="44px"
        style:aspect-ratio="9/16"
        style:border-radius="5px"
        style:background={`linear-gradient(135deg, hsl(${f.hue}, 78%) 0%, hsl(${f.hue}, 35%) 100%)`}
        style:border={isActive ? '1.5px solid var(--accent)' : '0.5px solid var(--border-glass)'}
        style:opacity={isActive ? '1' : '0.6'}
        style:transition="opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease"
        style:padding="0"
        style:flex-shrink="0"
        data-frame={f.id}
        aria-selected={isActive}
        aria-label={`Frame ${f.id + 1}: ${f.tag}`}
        onclick={() => withViewTransition(() => frames.set(f.id))}
      ></button>
    {/each}
  </div>
</div>

<script lang="ts">
  import { frames, FRAMES } from '../lib/frames.svelte'
  import { withViewTransition } from '../lib/view-transition'
</script>

<div class="grid gap-2" style="grid-template-columns:repeat(6, 1fr);" data-component="frame-strip">
  {#each FRAMES as f (f.id)}
    {@const isActive = frames.activeId === f.id}
    <button
      type="button"
      class="transition cursor-pointer"
      style:aspect-ratio="1/1"
      style:border-radius="8px"
      style:background={`linear-gradient(135deg, hsl(${f.hue}, 78%) 0%, hsl(${f.hue}, 35%) 100%)`}
      style:border={isActive ? '1.5px solid var(--accent)' : '0.5px solid var(--border-glass)'}
      style:opacity={isActive ? '1' : '0.65'}
      data-frame={f.id}
      aria-current={isActive ? 'true' : undefined}
      aria-label={`Frame ${f.id + 1}: ${f.tag}`}
      onclick={() => withViewTransition(() => frames.set(f.id))}
    ></button>
  {/each}
</div>

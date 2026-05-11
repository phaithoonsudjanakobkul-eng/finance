<script lang="ts">
  import { frames, FRAMES } from '../lib/frames.svelte'
  import { withViewTransition } from '../lib/view-transition'
</script>

<div
  class="relative overflow-hidden"
  style:aspect-ratio="9/16"
  style:border-radius="16px"
  style:background={`linear-gradient(135deg, hsl(${frames.hue}, 78%) 0%, hsl(${frames.hue}, 55%) 50%, hsl(${frames.hue}, 35%) 100%)`}
  style:border="0.5px solid var(--border-glass)"
  style:transition="background 0.6s ease"
  data-component="hero-photo"
>
  <div
    class="absolute inset-0 pointer-events-none"
    style="background:linear-gradient(180deg, rgba(0,0,0,0.15) 0%, transparent 30%, rgba(0,0,0,0.55) 90%);"
  ></div>

  <div class="absolute" style="top:14px; left:14px;">
    <div
      class="glass-strong ff-mono"
      style="font-size:9px; letter-spacing:0.15em; padding:5px 10px; border-radius:4px; color:var(--accent-bright); display:inline-block;"
    >
      ★ FRAME OF THE DAY
    </div>
  </div>

  <div
    class="ff-mono absolute"
    style="top:14px; right:14px; font-size:9px; letter-spacing:0.1em; color:rgba(255,255,255,0.65); text-shadow:0 1px 2px rgba(0,0,0,0.4);"
  >
    {frames.active.tag.toUpperCase()}
  </div>

  <div
    class="glass-strong absolute flex"
    style="bottom:108px; right:12px; padding:6px; gap:5px; border-radius:8px; z-index:5;"
    data-component="frame-strip"
    role="tablist"
    aria-label="Frame picker"
  >
    {#each FRAMES as f (f.id)}
      {@const isActive = frames.activeId === f.id}
      <button
        type="button"
        role="tab"
        class="cursor-pointer"
        style:width="30px"
        style:aspect-ratio="9/16"
        style:border-radius="3px"
        style:background={`linear-gradient(135deg, hsl(${f.hue}, 78%) 0%, hsl(${f.hue}, 35%) 100%)`}
        style:border={isActive ? '1.5px solid var(--accent)' : '0.5px solid var(--border-glass)'}
        style:opacity={isActive ? '1' : '0.6'}
        style:transition="opacity 0.2s ease, border-color 0.2s ease"
        style:padding="0"
        data-frame={f.id}
        aria-selected={isActive}
        aria-label={`Frame ${f.id + 1}: ${f.tag}`}
        onclick={() => withViewTransition(() => frames.set(f.id))}
      ></button>
    {/each}
  </div>

  <div
    class="glass-strong absolute"
    style="bottom:16px; left:16px; right:16px; padding:14px 16px;"
  >
    <div
      class="ff-display"
      style="font-size:17px; font-weight:600; line-height:1.2; letter-spacing:-0.01em;"
      data-hero-caption
    >
      {frames.active.label}
    </div>
    <div
      class="flex justify-between items-center"
      style="margin-top:10px; padding-top:10px; border-top:0.5px solid rgba(245,241,232,0.15);"
    >
      <span
        class="ff-mono"
        style="font-size:9px; letter-spacing:0.12em; color:rgba(245,241,232,0.55);"
      >FRAME {frames.activeId + 1} / {FRAMES.length}</span>
      <span
        class="ff-mono"
        style="font-size:9px; letter-spacing:0.12em; color:var(--accent-bright);"
      >★</span>
    </div>
  </div>
</div>

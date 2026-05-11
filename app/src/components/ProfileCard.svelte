<script lang="ts">
  let {
    name = 'Pi-keng',
    caption = 'AUTO-SAVED · 21:59',
  }: {
    name?: string
    caption?: string
  } = $props()
</script>

<div class="glass p-4 flex items-center gap-4" data-component="profile-card">
  <div
    class="shrink-0 flex items-center justify-center ff-display"
    style:width="52px"
    style:height="52px"
    style:border-radius="50%"
    style:background={`linear-gradient(135deg, hsl(var(--hero-hue), 65%) 0%, hsl(var(--hero-hue), 35%) 100%)`}
    style:font-size="20px"
    style:font-weight="600"
    style:color="rgba(255,255,255,0.9)"
    style:border="0.5px solid var(--border-glass-strong)"
    aria-hidden="true"
  >
    {name.charAt(0)}
  </div>

  <div class="flex-1 min-w-0">
    <div
      class="ff-display"
      style="font-size:18px; font-weight:600; letter-spacing:-0.01em; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
      data-profile-name
    >
      {name}
    </div>
    <div class="ff-mono mt-1" style="font-size:9px; letter-spacing:0.12em; color:var(--text-faint);">
      {caption}
    </div>
  </div>

  <button
    type="button"
    class="ff-mono uppercase cursor-pointer shrink-0"
    style="padding:5px 10px; font-size:9px; letter-spacing:0.12em; background:var(--surface-glass); color:var(--text-muted); border:0.5px solid var(--border-glass); border-radius:4px;"
    data-action="edit-profile"
    aria-label="Edit profile"
  >EDIT</button>
</div>

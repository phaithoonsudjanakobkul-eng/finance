<script lang="ts">
  import HeroPhoto from '../components/HeroPhoto.svelte'
  import FrameStrip from '../components/FrameStrip.svelte'
</script>

<section data-tab-content="dashboard" class="grid gap-3.5" style="grid-template-columns: 1.4fr 1fr;">
  <div class="flex flex-col gap-3">
    <HeroPhoto />
    <FrameStrip />
  </div>

  <div class="flex flex-col gap-3">
    <div class="glass p-4">
      <div class="label-mono">Profile</div>
      <div class="ff-display mt-2" style="font-size:22px; font-weight:600; letter-spacing:-0.02em;">Pi-keng</div>
      <p class="mt-1" style="color:var(--text-muted); font-size:12px;">Hero photo drives ambient bg — pick a frame to see it transition</p>
    </div>

    <div class="glass p-4 flex-1">
      <div class="label-mono">Payday · Month</div>
      <div class="ff-display mt-2" style="font-size:26px; font-weight:600; letter-spacing:-0.02em;">
        <span style="color:var(--text-ghost); font-size:18px;">฿</span>203,518
      </div>
      <p class="mt-1" style="color:var(--text-muted); font-size:12px;">Data widgets — coming R4+</p>
    </div>
  </div>
</section>

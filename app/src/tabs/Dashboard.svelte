<script lang="ts">
  import HeroPhoto from '../components/HeroPhoto.svelte'
  import FrameStrip from '../components/FrameStrip.svelte'
  import ProfileCard from '../components/ProfileCard.svelte'
  import StatGlass from '../components/StatGlass.svelte'
  import { records } from '../lib/records.svelte'
</script>

<section data-tab-content="dashboard" class="grid gap-3.5" style="grid-template-columns: 1.4fr 1fr;">
  <div class="flex flex-col gap-3">
    <HeroPhoto />
    <FrameStrip />
  </div>

  <div class="flex flex-col gap-3">
    <ProfileCard />
    <StatGlass label="Income" value={records.incomeTotal} accent="var(--positive)" />
    <StatGlass label="Expense" value={records.expenseTotal} accent="var(--accent-bright)" />
    <StatGlass
      label="Balance"
      value={records.balance}
      accent={records.balance >= 0 ? 'var(--positive)' : 'var(--accent-bright)'}
      showSign
    />
  </div>
</section>

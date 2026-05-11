<script lang="ts">
  import StatGlass from '../components/StatGlass.svelte'
  import RecordForm from '../components/RecordForm.svelte'
  import RecordRow from '../components/RecordRow.svelte'
  import { records } from '../lib/records.svelte'

  const sorted = $derived([...records.list].sort((a, b) => b.ts - a.ts))
</script>

<section data-tab-content="records" class="flex flex-col" style="gap:var(--card-gap);">
  <div class="grid grid-cols-1 sm:grid-cols-3" style="gap:var(--card-gap);">
    <StatGlass label="Income"  value={records.incomeTotal}  accent="var(--positive)" />
    <StatGlass label="Expense" value={records.expenseTotal} accent="var(--accent-bright)" />
    <StatGlass
      label="Balance"
      value={records.balance}
      accent={records.balance >= 0 ? 'var(--positive)' : 'var(--accent-bright)'}
      showSign
    />
  </div>

  <div class="grid grid-cols-1 md:grid-cols-[1fr_2fr]" style="gap:var(--card-gap);">
    <RecordForm />

    <div class="glass" data-records-panel>
      <div
        class="flex items-center justify-between"
        style="padding:var(--card-pad-y) var(--card-pad-x) 8px;"
      >
        <div class="label-mono">All records</div>
        <div class="ff-mono" style="font-size:var(--text-xs); letter-spacing:0.12em; color:var(--text-faint);">
          {records.list.length} ENTRIES
        </div>
      </div>

      {#if sorted.length === 0}
        <div
          style="padding:var(--space-7) var(--card-pad-x); color:var(--text-faint); font-size:var(--text-base); text-align:center;"
          data-empty
        >
          No records yet — add your first one with the form on the left.
        </div>
      {:else}
        <div data-records-list>
          {#each sorted as r (r.id)}
            <RecordRow record={r} />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>

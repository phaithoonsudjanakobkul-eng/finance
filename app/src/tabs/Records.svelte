<script lang="ts">
  import StatGlass from '../components/StatGlass.svelte'
  import RecordForm from '../components/RecordForm.svelte'
  import RecordRow from '../components/RecordRow.svelte'
  import { records } from '../lib/records.svelte'

  const sorted = $derived([...records.list].sort((a, b) => b.ts - a.ts))
</script>

<section data-tab-content="records" class="flex flex-col gap-3.5">
  <div class="grid gap-3" style="grid-template-columns: repeat(3, 1fr);">
    <StatGlass label="Income"  value={records.incomeTotal}  accent="var(--positive)" />
    <StatGlass label="Expense" value={records.expenseTotal} accent="var(--accent-bright)" />
    <StatGlass
      label="Balance"
      value={records.balance}
      accent={records.balance >= 0 ? 'var(--positive)' : 'var(--accent-bright)'}
      showSign
    />
  </div>

  <div class="grid gap-3" style="grid-template-columns: 1fr 2fr;">
    <RecordForm />

    <div class="glass" data-records-panel>
      <div class="flex items-center justify-between" style="padding:14px 16px 8px;">
        <div class="label-mono">All records</div>
        <div class="ff-mono" style="font-size:9px; letter-spacing:0.12em; color:var(--text-faint);">
          {records.list.length} ENTRIES
        </div>
      </div>

      {#if sorted.length === 0}
        <div
          style="padding:32px 16px; color:var(--text-faint); font-size:12px; text-align:center;"
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

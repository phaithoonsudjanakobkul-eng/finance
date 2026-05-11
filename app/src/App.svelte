<script lang="ts">
  let count = $state(0)
</script>

<main class="min-h-screen flex flex-col items-center justify-center gap-6 p-8 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
  <h1 class="text-4xl font-semibold tracking-tight">PSLink v2</h1>
  <p class="text-sm text-neutral-500">Svelte 5 + TypeScript + Tailwind v4 — R0 scaffold</p>
  <button
    type="button"
    class="px-4 py-2 rounded border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
    onclick={() => count++}
  >
    count = {count}
  </button>
</main>

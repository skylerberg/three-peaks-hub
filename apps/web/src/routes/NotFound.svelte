<script lang="ts">
  import { link } from '../lib/router.svelte.ts';
</script>

<div class="mx-auto flex max-w-md flex-col gap-4 px-4 py-24 text-center" use:link>
  <h1 class="text-2xl font-semibold">Page not found</h1>
  <p class="text-muted">That page does not exist.</p>
  <a class="focus-ring rounded underline" href="/">Back to projects</a>
</div>

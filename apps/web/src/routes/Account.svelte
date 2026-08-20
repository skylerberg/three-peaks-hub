<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';

  async function signOut() {
    await session.logout();
    router.redirect('/login');
  }
</script>

<div class="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8" use:link>
  <h1 class="text-2xl font-semibold">Account</h1>

  <dl class="rounded-md border border-edge bg-surface p-4 text-sm">
    <div class="flex justify-between gap-4 py-1">
      <dt class="text-muted">Name</dt>
      <dd>{session.user?.name}</dd>
    </div>
    <div class="flex justify-between gap-4 py-1">
      <dt class="text-muted">Email</dt>
      <dd>{session.user?.email}</dd>
    </div>
  </dl>

  <div><Button variant="secondary" onclick={signOut}>Sign out</Button></div>
</div>

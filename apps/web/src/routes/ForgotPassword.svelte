<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { api } from '../api/client.ts';
  import { link } from '../lib/router.svelte.ts';

  let email = $state('');
  let error = $state<string | null>(null);
  let sent = $state(false);
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    busy = true;

    try {
      const result = await api.POST('/api/auth/forgot-password', { body: { email: email.trim() } });
      if (result.response.ok) {
        sent = true;
        return;
      }
      // Deliberately informative: signup already answers 409 for an address in
      // use, unauthenticated, so hiding this buys nothing and costs every
      // mistyped address a silent wait.
      error =
        result.response.status === 404
          ? 'No account with that email.'
          : result.response.status === 429
            ? 'Too many requests. Try again later.'
            : 'Could not send the reset email.';
    } catch (caught) {
      error = apiMessage(caught);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16" use:link>
  <h1 class="text-2xl font-semibold">Reset your password</h1>

  {#if sent}
    <p role="status" class="rounded-md border border-edge bg-surface p-3 text-sm">
      Check your email for a link to choose a new password. It expires in 15 minutes.
    </p>
  {:else}
    <form class="flex flex-col gap-4" onsubmit={submit} novalidate>
      {#if error}
        <p role="alert" class="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      {/if}
      <Input label="Email" type="email" autocomplete="email" bind:value={email} />
      <Button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</Button>
    </form>
  {/if}

  <a class="focus-ring rounded text-sm text-muted underline" href="/login">Back to sign in</a>
</div>

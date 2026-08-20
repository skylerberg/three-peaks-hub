<script lang="ts">
  import { PASSWORD_MIN_LENGTH } from '@three-peaks/shared';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import { api } from '../api/client.ts';
  import { apiMessage } from '../lib/session.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';

  interface Props {
    token: string;
  }
  let { token }: Props = $props();

  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (password.length < PASSWORD_MIN_LENGTH) {
      error = `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`;
      return;
    }

    busy = true;
    try {
      const result = await api.POST('/api/auth/reset-password', { body: { token, password } });
      if (result.response.ok) {
        router.redirect('/login');
        return;
      }
      error =
        result.response.status === 401
          ? 'That reset link is invalid or has expired. Request a new one.'
          : 'Could not reset your password.';
    } catch (caught) {
      error = apiMessage(caught);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16" use:link>
  <h1 class="text-2xl font-semibold">Choose a new password</h1>

  {#if !token}
    <p role="alert" class="rounded-md border border-danger px-3 py-2 text-sm text-danger">
      This link is missing its token. Request a new reset email.
    </p>
    <a class="focus-ring rounded text-sm underline" href="/forgot-password">Request a new link</a>
  {:else}
    <form class="flex flex-col gap-4" onsubmit={submit} novalidate>
      {#if error}
        <p role="alert" class="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {error}
        </p>
      {/if}
      <Input
        label="New password"
        type="password"
        autocomplete="new-password"
        bind:value={password}
      />
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</Button>
    </form>
  {/if}
</div>

<script lang="ts">
  import { PASSWORD_MIN_LENGTH } from '@three-peaks/shared';
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import { ApiError } from '../api/client.ts';
  import { apiMessage, session } from '../lib/session.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!name.trim()) {
      error = 'Enter your name.';
      return;
    }
    // Checked against the same constant the server enforces, so the two cannot
    // disagree about what is long enough.
    if (password.length < PASSWORD_MIN_LENGTH) {
      error = `Passwords must be at least ${PASSWORD_MIN_LENGTH} characters.`;
      return;
    }

    busy = true;
    try {
      await session.signup(email.trim(), password, name.trim());
      router.redirect(session.consumeIntendedPath());
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : undefined;
      error =
        status === 409
          ? 'An account with that email already exists.'
          : status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : apiMessage(caught);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16" use:link>
  <h1 class="text-2xl font-semibold">Create an account</h1>

  <form class="flex flex-col gap-4" onsubmit={submit} novalidate>
    {#if error}
      <p role="alert" class="rounded-md border border-danger px-3 py-2 text-sm text-danger">
        {error}
      </p>
    {/if}

    <Input label="Name" autocomplete="name" bind:value={name} />
    <Input label="Email" type="email" autocomplete="email" bind:value={email} />
    <Input label="Password" type="password" autocomplete="new-password" bind:value={password} />

    <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
  </form>

  <p class="text-sm text-muted">
    Already have an account? <a class="focus-ring rounded underline" href="/login">Sign in</a>
  </p>
</div>

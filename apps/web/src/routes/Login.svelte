<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import Input from '../components/ui/Input.svelte';
  import { ApiError } from '../api/client.ts';
  import { apiMessage, session } from '../lib/session.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!email.trim() || !password) {
      error = 'Enter your email and password.';
      return;
    }

    busy = true;
    try {
      await session.login(email.trim(), password);
      router.redirect(session.consumeIntendedPath());
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : undefined;
      // Mapped rather than passed through: the server's wording is for an API
      // client, and 429 in particular needs to say what to do about it.
      error =
        status === 401
          ? 'Invalid email or password'
          : status === 429
            ? 'Too many attempts. Wait a minute and try again.'
            : apiMessage(caught);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-16" use:link>
  <h1 class="text-2xl font-semibold">Sign in</h1>

  <form class="flex flex-col gap-4" onsubmit={submit} novalidate>
    {#if error}
      <p role="alert" class="rounded-md border border-danger px-3 py-2 text-sm text-danger">
        {error}
      </p>
    {/if}

    <Input label="Email" type="email" autocomplete="email" bind:value={email} />
    <Input label="Password" type="password" autocomplete="current-password" bind:value={password} />

    <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
  </form>

  <div class="flex justify-between text-sm text-muted">
    <a class="focus-ring rounded underline" href="/signup">Create an account</a>
    <a class="focus-ring rounded underline" href="/forgot-password">Forgot password?</a>
  </div>
</div>

<script lang="ts">
  import Button from '../components/ui/Button.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { api, assertOk } from '../api/client.ts';
  import { apiMessage, session } from '../lib/session.svelte.ts';
  import { link, router } from '../lib/router.svelte.ts';
  import { toasts } from '../lib/toasts.svelte.ts';

  interface CanvaLink {
    id: string;
    canva_brand_id: string | null;
    created_at: string;
    last_used_at: string | null;
  }

  let links = $state<CanvaLink[] | null>(null);
  let code = $state('');
  let busy = $state(false);

  async function signOut() {
    await session.logout();
    router.redirect('/login');
  }

  async function loadLinks() {
    try {
      links = assertOk(await api.GET('/api/canva-app/links')).links;
    } catch (error) {
      toasts.error(apiMessage(error));
    }
  }

  $effect(() => {
    void loadLinks();
  });

  async function pair(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    try {
      assertOk(await api.POST('/api/canva-app/pair', { body: { code } }));
      code = '';
      toasts.success('Canva is connected');
      await loadLinks();
    } catch (error) {
      toasts.error(apiMessage(error));
    } finally {
      busy = false;
    }
  }

  async function revoke(id: string) {
    busy = true;
    try {
      assertOk(
        await api.DELETE('/api/canva-app/links/{linkId}', { params: { path: { linkId: id } } })
      );
      toasts.success('Canva is disconnected');
      await loadLinks();
    } catch (error) {
      toasts.error(apiMessage(error));
    } finally {
      busy = false;
    }
  }

  function when(timestamp: string): string {
    return new Date(timestamp).toLocaleDateString();
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

  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">Canva</h2>
    <p class="text-sm text-muted">
      Open the Three Peaks app in Canva and it will show you a code. Enter it here once, and it will
      import into this account from then on.
    </p>

    <form class="flex flex-wrap items-end gap-2" onsubmit={pair}>
      <label class="flex flex-1 flex-col gap-1 text-sm">
        <span class="text-muted">Code from Canva</span>
        <input
          class="min-h-11 rounded-md border border-edge bg-canvas px-3 font-mono tracking-widest uppercase"
          bind:value={code}
          placeholder="ABCD-2345"
          autocomplete="off"
          spellcheck="false"
          required
        />
      </label>
      <Button type="submit" disabled={busy || code.trim().length === 0}>Connect</Button>
    </form>

    {#if links === null}
      <Spinner />
    {:else if links.length === 0}
      <p class="text-sm text-muted">No Canva account is connected.</p>
    {:else}
      <ul class="flex flex-col divide-y divide-edge rounded-md border border-edge bg-surface">
        {#each links as canvaLink (canvaLink.id)}
          <li class="flex flex-wrap items-center justify-between gap-3 p-3">
            <div class="text-sm">
              <p>Connected {when(canvaLink.created_at)}</p>
              <p class="text-muted">
                {canvaLink.last_used_at === null
                  ? 'Not used yet'
                  : `Last used ${when(canvaLink.last_used_at)}`}
              </p>
            </div>
            <Button variant="secondary" disabled={busy} onclick={() => revoke(canvaLink.id)}>
              Disconnect
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <div><Button variant="secondary" onclick={signOut}>Sign out</Button></div>
</div>

<script lang="ts">
  import { toasts } from '../../lib/toasts.svelte.ts';

  const styles = {
    info: 'border-edge bg-surface-raised text-ink',
    success: 'border-success bg-surface-raised text-ink',
    error: 'border-danger bg-surface-raised text-ink',
  };
</script>

<!-- assertive for errors, polite otherwise: an error that a screen reader
     announces after the user has moved on is not much of an error message. -->
<div
  class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
>
  {#each toasts.toasts as toast (toast.id)}
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      class="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-md border p-3
             text-sm shadow-lg {styles[toast.variant]}"
    >
      <span class="flex-1">{toast.message}</span>
      <button
        type="button"
        class="focus-ring rounded px-1 text-muted hover:text-ink"
        onclick={() => toasts.dismiss(toast.id)}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  {/each}
</div>

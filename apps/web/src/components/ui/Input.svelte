<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends HTMLInputAttributes {
    label: string;
    error?: string | null;
    value?: string;
  }

  let {
    label,
    error = null,
    value = $bindable(''),
    class: className = '',
    ...rest
  }: Props = $props();

  // May be called only once per component; a second call is a compile error
  // rather than a second id, so suffix from here.
  const uid = $props.id();
</script>

<div class="flex flex-col gap-1">
  <label class="text-sm font-medium text-ink" for="{uid}-input">{label}</label>
  <input
    id="{uid}-input"
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${uid}-error` : undefined}
    class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-3 text-sm text-ink
           placeholder:text-muted {className}"
    {...rest}
  />
  {#if error}
    <p id="{uid}-error" class="text-sm text-danger">{error}</p>
  {/if}
</div>

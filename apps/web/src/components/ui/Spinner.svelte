<script lang="ts">
  interface Props {
    label?: string;
  }
  let { label = 'Loading' }: Props = $props();
</script>

<span class="inline-flex items-center gap-2 text-sm text-muted" role="status">
  <span
    class="size-4 animate-spin rounded-full border-2 border-edge border-t-accent"
    aria-hidden="true"
  ></span>
  {label}
</span>

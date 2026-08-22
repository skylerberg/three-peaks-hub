<script lang="ts">
  interface Props {
    label: string;
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  let { label, value, disabled = false, onchange }: Props = $props();

  const id = $props.id();
</script>

<div class="flex items-center justify-between gap-2">
  <label class="text-sm" for={id}>{label}</label>
  <input
    {id}
    class="focus-ring h-11 w-16 rounded-md border border-edge bg-surface p-1"
    type="color"
    {value}
    {disabled}
    oninput={(event) => onchange((event.currentTarget as HTMLInputElement).value)}
  />
</div>

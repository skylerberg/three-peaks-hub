<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    suffix?: string;
    disabled?: boolean;
    onchange: (value: number) => void;
  }

  let { label, value, min, max, step, suffix = '', disabled = false, onchange }: Props = $props();

  const id = $props.id();

  function commit(event: Event) {
    const next = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(next)) onchange(Math.min(max, Math.max(min, next)));
  }
</script>

<div class="flex flex-col gap-1">
  <label class="flex items-baseline justify-between text-sm" for={id}>
    <span>{label}</span>
    <span class="text-xs text-muted">{value}{suffix}</span>
  </label>
  <div class="flex items-center gap-2">
    <input
      {id}
      class="focus-ring h-11 flex-1 accent-accent"
      type="range"
      {min}
      {max}
      {step}
      {value}
      {disabled}
      oninput={commit}
    />
    <input
      class="focus-ring h-11 w-20 rounded-md border border-edge bg-surface px-2 text-sm"
      type="number"
      aria-label="{label} value"
      {min}
      {max}
      {step}
      {value}
      {disabled}
      onchange={commit}
    />
  </div>
</div>

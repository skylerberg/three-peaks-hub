<script lang="ts">
  interface Props {
    // The three fields a picker draws, rather than SceneTemplate itself: the
    // rest of that type is the build() the exporter calls, which a control
    // offering a choice has no business holding.
    templates: readonly { id: string; name: string; description: string }[];
    templateId: string;
    onpick: (id: string) => void;
  }

  let { templates, templateId, onpick }: Props = $props();

  const uid = $props.id();
  const chosen = $derived(templates.find((template) => template.id === templateId) ?? null);
</script>

<div class="flex flex-col gap-1">
  <label class="text-sm font-medium" for="{uid}-template">Shot</label>
  <select
    id="{uid}-template"
    class="focus-ring min-h-11 rounded-md border border-edge bg-surface px-2 text-sm text-ink"
    value={templateId}
    disabled={templates.length === 0}
    onchange={(event) => onpick(event.currentTarget.value)}
  >
    {#each templates as template (template.id)}
      <option value={template.id}>{template.name}</option>
    {/each}
  </select>
  <p class="max-w-2xl text-sm text-muted">
    {chosen ? chosen.description : 'Reading the shot templates…'}
  </p>
</div>

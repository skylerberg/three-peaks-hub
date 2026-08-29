import type { components } from '@three-peaks/shared/api';
import { DEFAULT_CARD_SETTINGS, type ModelSettings } from '@three-peaks/shared';
import { ApiError, api, assertOk } from '../api/client.ts';
import { SAVE_DELAY_MS } from './autosave.ts';

type File = components['schemas']['File'];

class ModelStore {
  file = $state<File | null>(null);
  settings = $state<ModelSettings>({ ...DEFAULT_CARD_SETTINGS });
  loading = $state(false);
  saving = $state(false);
  #timer: ReturnType<typeof setTimeout> | null = null;

  // Two loads are routinely in flight at once when a screen opens and a
  // realtime event lands. Only the newest may assign.
  #generation = 0;

  // Settings saved elsewhere. The file row is untouched by this event, because
  // the image itself did not change.
  applySettings(settings: ModelSettings): void {
    this.settings = settings;
  }

  async load(fileId: string): Promise<void> {
    this.#generation += 1;
    const generation = this.#generation;
    this.loading = true;

    try {
      const [row, settings] = await Promise.all([
        api.GET('/api/files/{id}', { params: { path: { id: fileId } } }),
        this.#fetchSettings(fileId),
      ]);
      const file = assertOk(row);

      if (generation !== this.#generation) return;
      this.file = file;
      this.settings = settings;
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }

  async #fetchSettings(fileId: string): Promise<ModelSettings> {
    try {
      const saved = assertOk(
        await api.GET('/api/models/{fileId}', { params: { path: { fileId } } })
      );
      return saved.settings as ModelSettings;
    } catch (error) {
      // 404 is the normal answer for an image nobody has dialled in yet, and
      // the defaults are what the studio is supposed to open on.
      if (error instanceof ApiError && error.status === 404) return { ...DEFAULT_CARD_SETTINGS };
      throw error;
    }
  }

  update(patch: Partial<ModelSettings>): void {
    this.settings = { ...this.settings, ...patch } as ModelSettings;
  }

  // Debounced rather than fired per keystroke, and the pending timer is cleared
  // first so the last edit wins rather than the first.
  scheduleSave(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.save();
    }, SAVE_DELAY_MS);
  }

  async save(): Promise<void> {
    const file = this.file;
    if (!file) return;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    this.saving = true;
    try {
      assertOk(
        await api.PUT('/api/models/{fileId}', {
          params: { path: { fileId: file.id } },
          // $state hands back a proxy, and structured-cloning one through fetch
          // throws. This is also the read-back the settings actually sent.
          body: { settings: $state.snapshot(this.settings) as ModelSettings },
        })
      );
    } finally {
      this.saving = false;
    }
  }

  reset(): void {
    // Generation first, for the reason files.svelte.ts spells out.
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.file = null;
    this.settings = { ...DEFAULT_CARD_SETTINGS };
    this.loading = false;
    this.saving = false;
  }
}

export const models = new ModelStore();

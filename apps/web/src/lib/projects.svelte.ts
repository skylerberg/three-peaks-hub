import type { components } from '@three-peaks/shared/api';
import { api, assertOk } from '../api/client.ts';
import { newId } from './ids.ts';
import { toasts } from './toasts.svelte.ts';

export type Project = components['schemas']['Project'];
// Only ever appears nested in the list response, so it has no named
// component of its own; derived rather than restated.
export type ProjectMember = components['schemas']['ProjectMemberList']['members'][number];

class ProjectStore {
  projects = $state<Project[]>([]);
  loading = $state(false);
  loaded = $state(false);

  async load(): Promise<void> {
    this.loading = true;
    try {
      const data = assertOk(await api.GET('/api/projects'));
      this.projects = data.projects;
      this.loaded = true;
    } finally {
      this.loading = false;
    }
  }

  async create(name: string, description?: string): Promise<Project> {
    // The client picks the id, so the row it draws already has the identity the
    // server will store.
    const id = newId();
    const created = assertOk(await api.POST('/api/projects', { body: { id, name, description } }));
    this.projects = [created, ...this.projects];
    return created;
  }

  async rename(id: string, name: string): Promise<void> {
    const previous = this.projects;
    // Optimistic: apply, then send. On failure refetch to resync rather than
    // restoring a snapshot -- the snapshot can be older than a change that
    // arrived in between.
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, name } : p));
    try {
      await api.PATCH('/api/projects/{id}', { params: { path: { id } }, body: { name } });
    } catch (error) {
      this.projects = previous;
      toasts.error('Could not rename the project.');
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const result = await api.DELETE('/api/projects/{id}', { params: { path: { id } } });
    assertOk(result);
    this.projects = this.projects.filter((p) => p.id !== id);
  }

  byId(id: string): Project | undefined {
    return this.projects.find((project) => project.id === id);
  }

  reset(): void {
    this.projects = [];
    this.loaded = false;
    this.loading = false;
  }
}

export const projects = new ProjectStore();

type ToastVariant = 'info' | 'error' | 'success';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

class ToastStore {
  toasts = $state<Toast[]>([]);
  #timers = new Map<string, ReturnType<typeof setTimeout>>();

  show(message: string, variant: ToastVariant = 'info', durationMs = 5000): string {
    const id = crypto.randomUUID();
    this.toasts = [...this.toasts, { id, message, variant }];
    this.#timers.set(
      id,
      setTimeout(() => this.dismiss(id), durationMs)
    );
    return id;
  }

  error(message: string, durationMs = 8000): string {
    return this.show(message, 'error', durationMs);
  }

  success(message: string, durationMs = 4000): string {
    return this.show(message, 'success', durationMs);
  }

  dismiss(id: string): void {
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.toasts = [];
  }
}

export const toasts = new ToastStore();

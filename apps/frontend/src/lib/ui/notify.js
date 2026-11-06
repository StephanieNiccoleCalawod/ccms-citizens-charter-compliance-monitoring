// The one notification (toast) store of CCMS. A page calls notify.success(...) or notify.error(...) when a save has really finished
// (success only after the server confirmed it), and the single <Toaster /> in the app shell shows it. No provider is needed: this is a
// small module-level store read with useSyncExternalStore.

export const SUCCESS_MS = 5000;
export const ERROR_MS = 8000;
export const MAX_TOASTS = 3;

let toasts = [];
let nextId = 1;
const listeners = new Set();
const timers = new Map();

function emit() {
  for (const listener of listeners) listener();
}

export function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

function push(kind, message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return null;
  // The same message twice in a row is one notification (a double trigger never shows two).
  const last = toasts.at(-1);
  if (last && last.kind === kind && last.message === text) return last.id;
  const id = nextId++;
  toasts = [...toasts, { id, kind, message: text }].slice(-MAX_TOASTS);
  emit();
  timers.set(id, setTimeout(() => dismiss(id), kind === 'error' ? ERROR_MS : SUCCESS_MS));
  return id;
}

export const notify = {
  success: (message) => push('success', message),
  error: (message) => push('error', message),
  dismiss,
};

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getToasts = () => toasts;
export const getServerToasts = () => [];

/** For tests only: forget every notification and timer. */
export function resetNotifications() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts = [];
  nextId = 1;
  emit();
}

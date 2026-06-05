// Frontend cache of attachment bytes keyed by workspace path. Attachments are
// stored as files (not inline in the session), so the thread fetches them lazily
// over ws_read_image. Just-sent images are pre-seeded so they render instantly.

const cache = new Map<string, string>();
const waiters = new Map<string, Array<(url: string | null) => void>>();
let requestFn: ((path: string) => void) | null = null;

export function configureImageCache(request: (path: string) => void): void {
  requestFn = request;
}

export function seedImage(path: string, dataUrl: string): void {
  cache.set(path, dataUrl);
}

export function resolveImage(path: string, dataUrl: string): void {
  cache.set(path, dataUrl);
  const w = waiters.get(path);
  if (w) { waiters.delete(path); for (const f of w) f(dataUrl); }
}

export function failImage(path: string): void {
  const w = waiters.get(path);
  if (w) { waiters.delete(path); for (const f of w) f(null); }
}

// Resolve a path to a data URL, fetching it once if not cached. The callback
// fires synchronously on a cache hit, else when ws_read_image returns.
export function loadImage(path: string, cb: (url: string | null) => void): void {
  const hit = cache.get(path);
  if (hit !== undefined) { cb(hit); return; }
  const arr = waiters.get(path) ?? [];
  arr.push(cb);
  waiters.set(path, arr);
  if (arr.length === 1) requestFn?.(path);
}
